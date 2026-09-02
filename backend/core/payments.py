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
import hmac
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
        # An add-on: paid for, but credits are not what was bought. The
        # product it unlocks is confirmed by its own module, which owns what
        # "unlocked" means for it.
        logger.info(
            f"💳 [{source}] Payment {moyasar_id} paid for {reference!r} "
            f"({product.amount_sar} SAR). No credits apply to this product."
        )
        unlocked = _unlock_addon(reference, metadata, moyasar_id, expected)
        return {
            "ok": True, "paid": True, "reference": reference,
            "credits_granted": None, "already_processed": False,
            **({"addon": unlocked} if unlocked else {}),
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


def _unlock_addon(reference: str, metadata: dict, moyasar_id: str, paid_halalas: int) -> Optional[str]:
    """
    Hand a paid add-on to the module that owns it.

    Only LinkedIn Premium today. Kept as a dispatch rather than an inline
    call so a second add-on does not turn record_and_grant() into a chain of
    special cases — and imported inside the function because core/linkedin.py
    imports from this module's neighbours.

    Never raises into the payment path: the money is taken and the payments
    row is already written, so a failure here is a fulfilment problem to fix
    by hand, not a reason to tell Moyasar the webhook failed and have it
    redeliver forever.
    """
    if reference != "linkedin_premium":
        return None

    purchase_id = str(metadata.get("purchase_id") or "").strip()
    if not purchase_id:
        logger.error(
            f"🚨 Payment {moyasar_id} paid for LinkedIn Premium but carries no purchase_id in its "
            "metadata, so no purchase can be unlocked. Resolve by hand."
        )
        return "no_purchase_id"

    try:
        from core.linkedin import confirm_premium_purchase
        result = confirm_premium_purchase(
            purchase_id, moyasar_id, paid_halalas, pricing.CURRENCY
        )
    except Exception as e:
        logger.error(
            f"🚨 Could not unlock LinkedIn purchase {purchase_id} for paid payment "
            f"{moyasar_id}: {e}. The money is taken; resolve by hand."
        )
        return "unlock_failed"

    if result.get("amount_mismatch"):
        return "amount_mismatch"
    if not result.get("matched"):
        return "no_such_purchase"
    return "already_paid" if result.get("already_paid") else "unlocked"


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


# ─── WEBHOOKS (§4) ──────────────────────────────────────────────────────────
#
# Moyasar's own callback, and the AUTHORITATIVE path. The callback page in §3
# is a courtesy for the buyer who comes back; this is what fires whether or
# not they do, and it is what makes a payment on a phone that got lost in a
# 3-D Secure redirect still deliver its credits.
#
# ANSWER 200 FOR ANYTHING AUTHENTIC. Moyasar retries on a non-2xx, so a 4xx or
# 5xx for an event we simply don't act on turns into an indefinite retry loop.
# Non-2xx is reserved for two cases: the request could not be proven to come
# from Moyasar (403), and a genuine transient failure on our side that a
# retry could fix (503) — those we WANT retried.

# Event types this backend acts on. Anything else is recorded and acknowledged.
_EVENT_PAID = "payment_paid"
_EVENT_FAILED = "payment_failed"


def _webhook_event_id(payload: dict) -> str:
    """
    The idempotency key for a delivery.

    Moyasar's documented webhook envelope carries a top-level `id`, and that
    is what this uses. It falls back to a composite of type + data.id +
    created_at when `id` is absent, because the brief for this work flagged
    that their payload does not guarantee a clean event id in every case, and
    an idempotency key that can be empty is not an idempotency key — two
    unrelated deliveries would collide on "" and the second would be silently
    dropped as a duplicate.

    ⚠️ NEEDS CONFIRMING AGAINST A REAL TEST-MODE DELIVERY. This shape comes
    from Moyasar's published webhook reference, not from a captured payload —
    nobody has been able to fire one yet, because payments are not switched on
    (PAYMENT_GATEWAY is unset). `_log_envelope_shape` below prints the actual
    top-level keys of the first deliveries precisely so this can be checked
    against reality rather than left as an assumption.
    """
    event_id = str(payload.get("id") or "").strip()
    if event_id:
        return event_id

    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    composite = ":".join([
        str(payload.get("type") or "unknown"),
        str(data.get("id") or "no-payment-id"),
        str(payload.get("created_at") or ""),
    ])
    logger.warning(
        f"⚠️ Moyasar webhook had no top-level 'id'; falling back to the composite key "
        f"{composite!r}. Confirm the real envelope shape and simplify this."
    )
    return composite


def _log_envelope_shape(payload: dict) -> None:
    """Records the envelope's top-level keys, so the first real delivery
    settles what the payload actually looks like without anyone having to
    catch it live. Keys only — the values carry the secret and the card
    details."""
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    logger.info(
        f"📨 Moyasar webhook envelope keys: {sorted(payload.keys())} "
        f"| data keys: {sorted(data.keys())}"
    )


def _secret_matches(payload: dict) -> bool:
    """
    Proves the delivery came from Moyasar.

    Moyasar authenticates webhooks with a shared secret echoed in the body's
    `secret_token`, not an HMAC over the raw bytes — so there is no need to
    preserve the exact request bytes here, unlike a signature scheme.

    compare_digest, not ==, so a wrong secret cannot be recovered a character
    at a time from response timing. Fails closed when the secret is unset: an
    unverifiable webhook is an unauthenticated request to hand out credits.
    """
    configured = moyasar_client.webhook_secret()
    if not configured:
        logger.error("🚫 MOYASAR_WEBHOOK_SECRET is not set — refusing every webhook.")
        return False
    presented = str(payload.get("secret_token") or "")
    return bool(presented) and hmac.compare_digest(presented, configured)


def _claim_event(admin, event_id: str, event_type: str, payload: dict) -> str:
    """
    Record the delivery and decide whether it still needs work.

    Returns "new" (process it), "in_flight" (a previous attempt recorded it
    but never finished — process it again), or "done" (already processed,
    acknowledge and stop).

    THE DISTINCTION BETWEEN in_flight AND done IS THE WHOLE POINT. Recording
    the event first is what makes a retry safe, but if "already recorded"
    alone meant "already handled", then a delivery that crashed midway — or
    one whose payment lookup timed out and returned 503 on purpose — would be
    acknowledged as complete on Moyasar's retry and never processed at all.
    `processed_at` is what separates the two.
    """
    existing = (
        admin.table("webhook_events")
        .select("id, processed_at")
        .eq("moyasar_event_id", event_id)
        .maybe_single()
        .execute()
        .data
    )
    if existing:
        return "done" if existing.get("processed_at") else "in_flight"

    try:
        admin.table("webhook_events").insert({
            "moyasar_event_id": event_id,
            "event_type": event_type,
            "payload": payload,
        }).execute()
        return "new"
    except Exception as e:
        # A UNIQUE violation here means a concurrent delivery of the same
        # event won the race — which is exactly what the constraint is for.
        # Treat it as in-flight rather than failing: the loser re-reads state
        # from Moyasar anyway, and record_and_grant() grants only once.
        logger.info(f"↩️ webhook_events insert for {event_id} conflicted ({e}); treating as in-flight.")
        return "in_flight"


def _mark_processed(admin, event_id: str) -> None:
    try:
        admin.table("webhook_events").update(
            {"processed_at": _utcnow_iso()}
        ).eq("moyasar_event_id", event_id).execute()
    except Exception as e:
        # Not fatal. The work is done; the worst case is that a retry redoes
        # it, and record_and_grant() is idempotent by design.
        logger.error(f"❌ Could not mark webhook {event_id} processed: {e}")


def _utcnow_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _handle_subscription_event(admin, payment: dict, product) -> dict:
    """
    A plan payment: the first one, or a renewal.

    Both go through record_and_grant() for the money and the credits, so the
    grant is claimed exactly once no matter whether the renewal job or this
    webhook gets there first. What is different is that a FIRST payment also
    has to create the subscription — the card token, the period, the tier.

    Told apart by whether a live subscription already exists, not by the
    event: Moyasar sends the same payment_paid either way, and a renewal that
    re-ran activation would reset the period and re-claim a founding-member
    slot.
    """
    metadata = _extract_metadata(payment)
    user_id = str(metadata.get("user_id") or "").strip()
    result = record_and_grant(payment, source="webhook")

    if not (result.get("ok") and result.get("paid")):
        return result
    if not user_id:
        logger.error(
            f"🚨 Plan payment {payment.get('id')} is paid but carries no user_id — "
            "no subscription can be started. Resolve by hand."
        )
        return {**result, "subscription": "no_user_id"}

    # Imported here rather than at module scope: core.billing imports
    # record_and_grant from this module, so a top-level import would be
    # circular.
    from core import billing

    existing = (
        admin.table("subscriptions").select("id, status")
        .eq("user_id", user_id).neq("status", "canceled")
        .maybe_single().execute().data
    )
    if existing:
        # A renewal. The job already advanced the period when it charged;
        # this delivery is the reconciliation, and the grant above is the
        # only thing it needed to do.
        logger.info(
            f"🔁 Renewal payment {payment.get('id')} reconciled for subscription {existing['id']}."
        )
        return {**result, "subscription": "renewed"}

    started = billing.start_subscription(user_id, product.reference, payment)
    return {**result, "subscription": "started" if started else "start_failed"}


@router.post("/api/v1/webhooks/moyasar", tags=["Payments"])
async def moyasar_webhook(request: Request) -> dict:
    """
    Moyasar's payment callback.

    NOT JWT-authenticated — Moyasar has no Supabase session. Authenticity is
    the shared secret in the body, checked in constant time.

    THE BODY IS NOT TRUSTED FOR ANYTHING BUT ROUTING. Knowing the secret
    proves the delivery is Moyasar's; it does not make the amounts in it true.
    Every figure that decides whether credits are granted is re-read from
    GET /payments/{id}, so a replayed or edited body cannot grant anything
    that Moyasar's own record does not support.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Webhook body was not JSON.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Webhook body was not a JSON object.")

    if not _secret_matches(payload):
        # 403 and no detail: an unverified caller learns nothing about why.
        logger.error("🚫 Rejected a Moyasar webhook: secret_token did not match.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Webhook could not be verified.")

    _log_envelope_shape(payload)
    event_type = str(payload.get("type") or "").strip() or "unknown"
    event_id = _webhook_event_id(payload)
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    payment_id = str(data.get("id") or "").strip()

    admin = get_admin_client()
    state = _claim_event(admin, event_id, event_type, payload)
    if state == "done":
        logger.info(f"↩️ Moyasar webhook {event_id} ({event_type}) already processed, acknowledging.")
        return {"ok": True, "idempotent": True}

    logger.info(
        f"📨 Moyasar webhook {event_id} type={event_type} payment={payment_id or '-'} "
        f"({'retry of an unfinished delivery' if state == 'in_flight' else 'new'})"
    )

    # ── Events we don't act on ──────────────────────────────────────────
    if event_type not in (_EVENT_PAID, _EVENT_FAILED):
        logger.info(f"📨 Moyasar webhook {event_id}: '{event_type}' needs no action here.")
        _mark_processed(admin, event_id)
        return {"ok": True, "ignored": True, "event_type": event_type}

    if not payment_id:
        logger.error(f"🚫 Moyasar webhook {event_id} ({event_type}) carries no data.id — nothing to look up.")
        _mark_processed(admin, event_id)
        return {"ok": True, "ignored": True, "reason": "no_payment_id"}

    # ── Re-read the payment from Moyasar ────────────────────────────────
    try:
        payment = moyasar_client.get_payment(payment_id)
    except moyasar_client.MoyasarUnreachable as e:
        # DELIBERATELY a 5xx: we could not establish what happened, and
        # Moyasar's retry is the recovery mechanism. The event row stays
        # unprocessed so that retry does real work instead of being
        # acknowledged as a duplicate.
        logger.warning(f"⏳ Could not reach Moyasar to verify {payment_id} for webhook {event_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "verification_unavailable",
                    "message": "Could not verify the payment; please retry."},
        )
    except (moyasar_client.MoyasarError, moyasar_client.MoyasarConfigError) as e:
        # A definite refusal (unknown id, bad key). Retrying will not change
        # it, so acknowledge and leave it logged rather than looping forever.
        logger.error(f"🚫 Moyasar rejected a lookup of {payment_id} for webhook {event_id}: {e}")
        _mark_processed(admin, event_id)
        return {"ok": True, "ignored": True, "reason": "lookup_failed"}

    # ── Route on what was bought ────────────────────────────────────────
    reference = str(_extract_metadata(payment).get("reference") or "").strip()
    product = pricing.get_product(reference)

    if product is not None and product.kind == "plan":
        result = _handle_subscription_event(admin, payment, product)
    else:
        result = record_and_grant(payment, source="webhook")

    _mark_processed(admin, event_id)
    logger.info(
        f"📨 Moyasar webhook {event_id} handled: type={event_type} payment={payment_id} "
        f"reference={reference or '-'} outcome={result.get('code') or ('paid' if result.get('paid') else 'recorded')}"
    )
    # 200 even when we refused to grant. The delivery was authentic and fully
    # handled; the refusal is ours and is already logged at ERROR. A non-2xx
    # would make Moyasar redeliver something that will be refused identically
    # every time.
    return {"ok": True, "event_type": event_type, "result": result}


@router.post("/api/v1/billing/run-renewals", tags=["Payments"])
async def run_renewals(request: Request) -> dict:
    """
    The daily renewal run (§5), triggered by the scheduled workflow in
    .github/workflows/billing-renewals.yml.

    NOT A USER ROUTE. Authenticated by a shared secret in the
    X-Cron-Secret header, compared in constant time, failing closed when
    CRON_SECRET is unset — an unprotected endpoint that charges saved cards
    is the worst possible thing to leave open.

    WHY AN HTTP ENDPOINT AND NOT A SCHEDULER IN THE PROCESS. This backend
    runs on Render's free tier and spins down when idle, so an in-process
    scheduler (APScheduler and friends) simply is not running most of the
    time and would miss most renewals. Render's own Cron Jobs are a paid
    service type. GitHub Actions is already this repository's automation
    (two workflows, with secrets), costs nothing, and its request is what
    wakes the service — so the trigger and the wake-up are the same action.
    """
    from core import billing

    configured = billing.cron_secret()
    if not configured:
        logger.error("🚫 CRON_SECRET is not set — refusing to run renewals.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "cron_not_configured"})

    presented = request.headers.get("x-cron-secret") or ""
    if not presented or not hmac.compare_digest(presented, configured):
        logger.error("🚫 Rejected a renewal run: X-Cron-Secret did not match.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Not authorised.")

    return billing.run_due_renewals()


# ─── THE SAVED CARD (§5) ────────────────────────────────────────────────────


@router.get("/api/v1/payments/card", tags=["Payments"])
def get_saved_card(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    The card on file, for display. Brand, last four and expiry — never a
    token id, which is a bearer credential for charging that card and has no
    business in a browser.
    """
    admin = get_admin_client()
    row = (admin.table("payment_tokens")
           .select("id, card_brand, card_last_four, card_expiry_month, card_expiry_year, status")
           .eq("user_id", user_id).eq("is_default", True)
           .maybe_single().execute().data)
    if not row:
        return {"card": None, "removable": True}

    live = (admin.table("subscriptions").select("id, status, plan")
            .eq("user_id", user_id).neq("status", "canceled")
            .maybe_single().execute().data)

    return {
        "card": {
            "brand": row.get("card_brand"),
            "last_four": row.get("card_last_four"),
            "expiry_month": row.get("card_expiry_month"),
            "expiry_year": row.get("card_expiry_year"),
            "status": row.get("status"),
        },
        # The guard, reported rather than only enforced — a button that
        # explains why it is disabled beats one that fails when pressed.
        "removable": live is None,
        "in_use_by": ({"plan": live.get("plan"), "status": live.get("status")} if live else None),
    }


@router.delete("/api/v1/payments/card", tags=["Payments"])
def remove_saved_card(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Forget the saved card.

    REFUSED WHILE A SUBSCRIPTION DEPENDS ON IT. Removing the only card under
    a live subscription does not stop the subscription — it makes the next
    renewal fail, walks the customer through the whole dunning schedule, and
    downgrades them for non-payment they never chose. Cancelling first is the
    honest path, and the 409 says so.

    The row is deleted rather than marked inactive: the point of the action
    is that we stop holding it.
    """
    admin = get_admin_client()
    live = (admin.table("subscriptions").select("id, plan, status")
            .eq("user_id", user_id).neq("status", "canceled")
            .maybe_single().execute().data)
    if live:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "card_in_use",
                "message": "This card is paying for your subscription. Cancel the subscription "
                           "first, then the card can be removed.",
                "plan": live.get("plan"),
            },
        )

    removed = (admin.table("payment_tokens").delete()
               .eq("user_id", user_id).execute().data or [])
    logger.info(f"🗑️ Removed {len(removed)} saved card(s) for user {user_id}.")
    return {"removed": len(removed)}
