# core/payments.py
#
# One-time payments: credit packs and the LinkedIn premium add-on (§3).
# Subscriptions are §5 and live alongside this, not inside it.
#
# ─── THE ONE RULE ───────────────────────────────────────────────────────────
#
# NOTHING THE BROWSER SAYS ABOUT MONEY IS BELIEVED. The client picks a
# `reference` slug ("starter_pack"); the server looks the price up in
# core/pricing.py and compares it against what Moyasar reports was actually
# paid. The client never sends an amount, and if it did, it would be ignored.
#
# ─── WHY record_and_grant() IS SHARED ───────────────────────────────────────
#
# Two things can tell us a payment succeeded, and BOTH will, for the same
# payment, in an order nobody controls:
#
#   1. The buyer's browser returning to /payment/callback, which calls the
#      verify route below. Fast, but only happens if they come back — close
#      the tab and it never fires.
#   2. Moyasar's webhook (§4). Always fires, retries on non-2xx, and can
#      deliver the same event more than once.
#
# So the same payment can arrive here twice, in either order, from two
# processes at once. All of those must land on the same end state with the
# credits granted exactly once. That is why there is ONE function both call,
# rather than two implementations that agree until they don't.
#
# THE WEBHOOK IS THE SOURCE OF TRUTH, not the callback page. The callback
# route exists so the buyer sees an answer immediately; if it never runs,
# the webhook still grants the credits.
import threading
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from core import moyasar_client
from core import pricing
from core.auth import get_current_user_id
from core.credits import get_admin_client, grant_credits
from core.rate_limit import RateLimit, enforce

router = APIRouter()

# Verification is cheap and idempotent, but it is an unauthenticated-ish
# trigger for an outbound API call, so it gets a ceiling. Generous enough that
# a buyer refreshing the callback page a few times is never blocked.
PAYMENT_VERIFY = RateLimit("payment_verify", max_calls=40, window_seconds=3600)

# Moyasar payment statuses that mean money actually moved.
_PAID_STATUSES = ("paid", "captured")


def _extract_metadata(payment: dict) -> dict:
    """Moyasar echoes back the metadata the form sent. Always a dict, even
    when they send null."""
    meta = payment.get("metadata")
    return meta if isinstance(meta, dict) else {}


def record_and_grant(payment: dict, *, source: str) -> dict:
    """
    Record a Moyasar payment and grant whatever it bought. THE shared entry
    point — the verify route below and the §4 webhook both call this and
    nothing else.

    `payment` is a Moyasar payment object as returned by GET /payments/{id}.
    CALLERS MUST FETCH IT FROM THE API, not take it from a webhook body: a
    webhook body proves only that someone knew the shared secret, whereas a
    fetched payment is Moyasar's own answer. (§4 does exactly this.)

    `source` is "callback" or "webhook", for the log line only.

    Idempotency has two layers, and both are needed:

      1. `payments.moyasar_payment_id` is UNIQUE, so the row is upserted and
         a second delivery updates rather than duplicates.
      2. The credit grant is CLAIMED with a conditional update
         (`credits_granted IS NULL`) before the credits are added. Exactly one
         caller can win that update, so two simultaneous deliveries cannot
         both grant.

    Returns a dict the callers turn into their own response shape. Never
    raises for an ordinary "this payment failed" — that is a result, not an
    error.
    """
    admin = get_admin_client()

    moyasar_id = str(payment.get("id") or "").strip()
    if not moyasar_id:
        logger.error(f"🚫 [{source}] Moyasar payment object has no id — refusing to process.")
        return {"ok": False, "code": "no_payment_id"}

    raw_status = str(payment.get("status") or "").lower()
    metadata = _extract_metadata(payment)
    reference = str(metadata.get("reference") or "").strip()
    user_id = str(metadata.get("user_id") or "").strip() or None

    amount = payment.get("amount")
    currency = str(payment.get("currency") or "").upper()

    product = pricing.get_product(reference)

    # ── Unknown reference ───────────────────────────────────────────────
    # Somebody paid us for something that is not on the price list. Do not
    # guess, do not grant. Record it so it is visible and refundable.
    if product is None:
        logger.error(
            f"🚫 [{source}] Payment {moyasar_id} carries reference {reference!r}, which is not a "
            f"product we sell. Recording it, granting nothing. Amount={amount} {currency}."
        )
        _upsert_payment_row(
            admin,
            moyasar_id=moyasar_id,
            user_id=user_id,
            payment_type=pricing.TYPE_ADDON,
            reference=reference or "unknown",
            amount=int(amount) if isinstance(amount, int) else 0,
            currency=currency or pricing.CURRENCY,
            payment_status=raw_status or "initiated",
            raw=payment,
        )
        return {"ok": False, "code": "unknown_reference", "reference": reference}

    # ── Amount / currency check ─────────────────────────────────────────
    # Before anything is granted, and loudly. An exact integer comparison:
    # halalas are integers, so there is no rounding to tolerate and any
    # difference at all is either a bug or an attempt.
    expected = product.amount_halalas
    amount_ok = isinstance(amount, int) and not isinstance(amount, bool) and amount == expected
    currency_ok = currency == pricing.CURRENCY

    if not amount_ok or not currency_ok:
        logger.error(
            f"🚫 [{source}] SUSPICIOUS PAYMENT {moyasar_id}: expected {expected} "
            f"{pricing.CURRENCY} for {reference!r}, Moyasar reports {amount!r} {currency!r}. "
            f"Granting nothing. user_id={user_id}"
        )
        _upsert_payment_row(
            admin,
            moyasar_id=moyasar_id,
            user_id=user_id,
            payment_type=product.payment_type,
            reference=reference,
            # Store what was actually paid, not what we wanted — the row has
            # to reflect reality for a refund to be worked out from it.
            amount=amount if isinstance(amount, int) and amount > 0 else expected,
            currency=currency or pricing.CURRENCY,
            payment_status=raw_status or "initiated",
            raw=payment,
        )
        return {
            "ok": False,
            "code": "amount_mismatch",
            "reference": reference,
            "expected_halalas": expected,
        }

    # ── Record the attempt, whatever its outcome ────────────────────────
    row = _upsert_payment_row(
        admin,
        moyasar_id=moyasar_id,
        user_id=user_id,
        payment_type=product.payment_type,
        reference=reference,
        amount=expected,
        currency=pricing.CURRENCY,
        payment_status=raw_status or "initiated",
        raw=payment,
    )

    if raw_status not in _PAID_STATUSES:
        logger.info(
            f"↩️ [{source}] Payment {moyasar_id} for {reference!r} is '{raw_status}', "
            "not paid. Nothing granted."
        )
        return {
            "ok": True,
            "paid": False,
            "code": raw_status or "unknown",
            "reference": reference,
            "credits_granted": None,
        }

    # ── Paid. Grant whatever it bought. ─────────────────────────────────
    if product.credits is None:
        # The LinkedIn add-on: paid for, but credits are not what was bought.
        # §7's admin view and the LinkedIn feature read the payments row.
        logger.info(
            f"💳 [{source}] Payment {moyasar_id} paid for {reference!r} "
            f"({product.amount_sar} SAR). No credits apply to this product."
        )
        return {
            "ok": True, "paid": True, "reference": reference,
            "credits_granted": None, "already_processed": False,
        }

    if not user_id:
        # Paid, for a credit pack, with nobody to give the credits to. Refuse
        # to guess — this needs a human, and the row is the evidence.
        logger.error(
            f"🚨 [{source}] Payment {moyasar_id} paid {expected} for {reference!r} but carries NO "
            "user_id in its metadata. Credits cannot be granted — resolve by hand."
        )
        return {"ok": False, "code": "no_user_id", "reference": reference}

    # THE CLAIM. Exactly one caller can flip credits_granted from NULL, so two
    # simultaneous deliveries cannot both reach the grant below.
    claimed = (
        admin.table("payments")
        .update({"credits_granted": product.credits})
        .eq("moyasar_payment_id", moyasar_id)
        .is_("credits_granted", "null")
        .execute()
        .data
        or []
    )
    if not claimed:
        logger.info(
            f"↩️ [{source}] Payment {moyasar_id} was already granted "
            f"({reference!r}); ignoring duplicate."
        )
        return {
            "ok": True, "paid": True, "reference": reference,
            "credits_granted": (row or {}).get("credits_granted"),
            "already_processed": True,
        }

    try:
        grant_credits(user_id, product.credits, reason=f"{reference} ({moyasar_id})")
    except Exception as e:
        # The claim is already recorded, so a retry will NOT re-grant. That is
        # the deliberate trade: double-granting is unrecoverable, this is not.
        # Everything needed to fix it by hand is on this line.
        logger.error(
            f"🚨 [{source}] CREDITS NOT GRANTED for paid payment {moyasar_id}: {e}. "
            f"user_id={user_id} reference={reference} credits={product.credits}. "
            "The payments row is marked granted, so this will NOT self-heal — "
            "add the credits manually."
        )
        return {
            "ok": False, "code": "grant_failed", "reference": reference,
            "credits_granted": None,
        }

    logger.info(
        f"✅ [{source}] Payment {moyasar_id} paid {product.amount_sar} SAR for {reference!r}; "
        f"granted {product.credits} credit(s) to user {user_id}."
    )
    return {
        "ok": True, "paid": True, "reference": reference,
        "credits_granted": product.credits, "already_processed": False,
    }


def _upsert_payment_row(
    admin,
    *,
    moyasar_id: str,
    user_id: Optional[str],
    payment_type: str,
    reference: str,
    amount: int,
    currency: str,
    payment_status: str,
    raw: dict,
) -> Optional[dict]:
    """
    Insert-or-update the payments row for this Moyasar payment.

    on_conflict on the UNIQUE moyasar_payment_id is what makes a second
    delivery update rather than duplicate. `credits_granted` is deliberately
    NOT written here — it is set only by the claim in record_and_grant(), so
    an upsert can never undo a grant.
    """
    # Statuses outside the CHECK constraint would fail the insert. Anything
    # unrecognised is stored as 'initiated', which grants nothing.
    allowed = ("initiated", "paid", "failed", "authorized", "captured", "refunded", "voided")
    safe_status = payment_status if payment_status in allowed else "initiated"

    payload: dict[str, Any] = {
        "moyasar_payment_id": moyasar_id,
        "user_id": user_id,
        "type": payment_type,
        "reference": reference,
        "amount": amount,
        "currency": currency,
        "status": safe_status,
        "raw_response": raw,
    }
    try:
        result = (
            admin.table("payments")
            .upsert(payload, on_conflict="moyasar_payment_id")
            .execute()
        )
        return (result.data or [None])[0]
    except Exception as e:
        # Never fatal: failing to write the audit row must not stop a paid
        # customer being served, and the log carries enough to reconstruct it.
        logger.error(
            f"❌ Could not record payment {moyasar_id} ({reference}, {amount} {currency}, "
            f"{safe_status}, user={user_id}): {e}"
        )
        return None


# ─── ROUTES ─────────────────────────────────────────────────────────────────


@router.get("/api/v1/payments/catalog", tags=["Payments"])
def get_catalog() -> dict:
    """
    The price list the checkout form builds itself from.

    Public and unauthenticated: these are the same prices the pricing page
    already shows. Serving them from the module that ENFORCES them means the
    form and the server-side check cannot quote different numbers.
    """
    return {
        "currency": pricing.CURRENCY,
        "products": pricing.public_catalog(),
        "mode": moyasar_client.mode(),
    }


@router.post("/api/v1/payments/verify/{payment_id}", tags=["Payments"])
def verify_payment(
    payment_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Called by /payment/callback when the buyer returns from Moyasar.

    UX, NOT AUTHORITY. It exists so the buyer gets an answer in the second
    after they pay instead of waiting on a webhook. If it never runs — they
    closed the tab, their connection dropped — the §4 webhook grants the
    credits anyway, and if both run, record_and_grant() makes sure only one
    grant happens.

    The payment is RE-FETCHED from Moyasar rather than trusted from the query
    string, because `id` arrives in a URL the buyer can edit.
    """
    enforce(PAYMENT_VERIFY, user_id)

    try:
        payment = moyasar_client.get_payment(payment_id)
    except moyasar_client.MoyasarUnreachable as e:
        # NOT a failure. The charge may well have succeeded; we simply do not
        # know yet, and the webhook will settle it. Saying "payment failed"
        # here to someone whose card was charged is the worst answer available.
        logger.warning(f"⏳ Could not reach Moyasar to verify {payment_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "verification_unavailable",
                "message": "We couldn't confirm your payment just yet. If it went through, "
                           "your credits will appear shortly — no need to pay again.",
            },
        )
    except moyasar_client.MoyasarConfigError as e:
        logger.error(f"❌ Moyasar is not configured, cannot verify {payment_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "payments_unavailable",
                    "message": "Online payment isn't available right now."},
        )
    except moyasar_client.MoyasarError as e:
        # A 404 from Moyasar means this id isn't a payment. Answer 404 rather
        # than echoing their error, matching how the rest of this codebase
        # responds to an id that isn't yours or isn't real.
        logger.warning(f"🚫 Moyasar rejected a lookup of {payment_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "payment_not_found", "message": "We couldn't find that payment."},
        )

    # OWNERSHIP. The payment id comes from a URL the caller controls, so
    # without this any logged-in user could verify anyone else's payment and
    # read back what they bought. 404 rather than 403, matching the rest of
    # the codebase: a wrong id must not confirm that a payment exists.
    metadata = _extract_metadata(payment)
    owner = str(metadata.get("user_id") or "").strip()
    if owner and owner != user_id:
        logger.warning(
            f"🚫 User {user_id} tried to verify payment {payment_id}, which belongs to {owner}."
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "payment_not_found", "message": "We couldn't find that payment."},
        )

    result = record_and_grant(payment, source="callback")

    # Shape chosen for the callback page: one status it can switch on, plus
    # enough to name what was bought.
    if result.get("ok") and result.get("paid"):
        return {
            "status": "paid",
            "reference": result.get("reference"),
            "credits_granted": result.get("credits_granted"),
            "already_processed": bool(result.get("already_processed")),
        }
    if result.get("ok"):
        return {
            "status": "pending" if result.get("code") in ("initiated", "authorized") else "failed",
            "reference": result.get("reference"),
            "credits_granted": None,
        }
    return {
        "status": "failed",
        "reference": result.get("reference"),
        "code": result.get("code"),
        "credits_granted": None,
    }
