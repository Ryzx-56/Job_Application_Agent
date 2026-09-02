# core/billing.py
#
# Recurring billing for the Pro and Elite monthly plans (§5).
#
# ─── WHY THIS EXISTS AS A JOB AT ALL ────────────────────────────────────────
#
# Moyasar has no subscription object. There is nothing on their side that
# remembers "charge this person 29 SAR every month". A subscription here is
# therefore three of our own things kept in step:
#
#   payment_tokens   a card Moyasar agreed to remember, referenced by a token
#                    id. No card number ever reaches us.
#   subscriptions    which plan, which card, which period, how many failed
#                    charges so far.
#   profiles.tier    what the app actually lets the person do. Unchanged and
#                    still authoritative — see the note in the migration.
#
# and a job that walks the due ones once a day and charges the saved card.
#
# ─── THE TWO CLOCKS PROBLEM ─────────────────────────────────────────────────
#
# Credits are granted by reset_credits_if_due() off profiles.credits_reset_at.
# Billing runs off subscriptions.next_billing_date. Those are two independent
# timers over the same month, and if they drift apart a subscriber gets their
# credits on a different day from when they pay for them — or keeps getting
# them after a failed charge.
#
# Every place below that moves a billing period moves credits_reset_at with
# it, deliberately, so the two stay on the same date. That is the whole fix;
# there is no third mechanism reconciling them.
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from loguru import logger

from core import moyasar_client, pricing
from core.credits import get_admin_client
from core.payments import record_and_grant

# ─── DUNNING SCHEDULE ───────────────────────────────────────────────────────
#
# Days after the ORIGINAL due date, not after the previous attempt — so a
# retry that gets delayed cannot push the whole schedule out indefinitely.
#
#   D+0   the renewal falls due, first charge attempt
#   D+1   retry 1
#   D+3   retry 2
#   D+5   retry 3, and the last one. Four attempts total.
#   D+5   status -> past_due once that fourth attempt fails
#   D+10  grace ends: status -> canceled, and the account drops to Free
#
# ACCESS CONTINUES THROUGHOUT. Ten days is deliberately generous: the single
# most common cause of a declined renewal is an expired or replaced card, not
# an unwillingness to pay, and cutting a paying customer off on the first
# decline costs more than ten days of usage does.
DUNNING_RETRY_DAYS = (1, 3, 5)
MAX_CHARGE_ATTEMPTS = 1 + len(DUNNING_RETRY_DAYS)   # 4
GRACE_DAYS_AFTER_PAST_DUE = 5                        # D+5 -> D+10

# A renewal that Moyasar reports as anything other than these has not been
# paid, whatever else it says.
_PAID_STATUSES = ("paid", "captured")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def add_month(dt: datetime) -> datetime:
    """
    One CALENDAR month forward, clamped to the end of a short month.

    Not `+ 30 days`, which is what the credit reset uses. Thirty-day periods
    drift: 12.17 of them fit in a year, so a "monthly" plan on a 30-day cycle
    bills thirteen times some years. Someone paying 29 SAR a month should be
    charged twelve times a year, on the same date.

    The 31st of a month clamps to the last day of a shorter one (31 Jan ->
    28 Feb), which is the ordinary convention and never skips a month.
    """
    year, month = dt.year, dt.month + 1
    if month > 12:
        year, month = year + 1, 1
    day = dt.day
    while day > 0:
        try:
            return dt.replace(year=year, month=month, day=day)
        except ValueError:
            day -= 1
    raise ValueError(f"could not add a month to {dt!r}")


# ─── STARTING A SUBSCRIPTION ────────────────────────────────────────────────


def start_subscription(user_id: str, reference: str, payment: dict) -> Optional[dict]:
    """
    Turn a successful FIRST payment into a live subscription.

    Called once, from the webhook, on a `subscription_initial` payment that
    Moyasar reports as paid. Everything it needs is on the payment object:
    the plan comes from metadata.reference, the saved card from source.token.

    NO TOKEN MEANS NO SUBSCRIPTION. A first payment that did not save a card
    cannot renew, and pretending otherwise creates a subscription that
    silently lapses in a month. That is recorded as an error and left for a
    human, because the money has already been taken.
    """
    product = pricing.get_product(reference)
    if product is None or product.kind != "plan" or not product.tier:
        logger.error(f"🚫 start_subscription called with {reference!r}, which is not a plan.")
        return None

    source = payment.get("source") if isinstance(payment.get("source"), dict) else {}
    token_id = str(source.get("token") or "").strip()
    if not token_id:
        logger.error(
            f"🚨 Payment {payment.get('id')} paid for {reference!r} but carries NO saved card token, "
            "so nothing can renew it. The money has been taken and the plan is NOT active. "
            "Resolve by hand — most likely the checkout did not set credit_card.save_card."
        )
        return None

    admin = get_admin_client()
    token_row = _upsert_token(admin, user_id, token_id, source)

    now = _now()
    period_end = add_month(now)
    existing = _live_subscription(admin, user_id)

    values = {
        "user_id": user_id,
        "plan": product.tier,
        "status": "active",
        "payment_token_id": (token_row or {}).get("id"),
        "current_period_start": _iso(now),
        "current_period_end": _iso(period_end),
        "next_billing_date": _iso(period_end),
        "failed_charge_count": 0,
        "canceled_at": None,
    }

    if existing:
        # Resubscribing, or upgrading into a row that already exists. One live
        # subscription per user is enforced by a partial unique index, so this
        # updates rather than inserting a second.
        row = (admin.table("subscriptions").update(values)
               .eq("id", existing["id"]).execute().data or [None])[0]
    else:
        row = (admin.table("subscriptions").insert(values).execute().data or [None])[0]

    # The tier, the credits and the founding-member slot, in the one function
    # that owns all three. Credits for the first period come from the payment
    # itself via record_and_grant, not from here.
    from core.subscription import activate_paid_subscription
    activate_paid_subscription(
        user_id, product.tier,
        provider="moyasar",
        subscription_id=(row or {}).get("id"),
        locked_price=None,
    )
    _align_credit_clock(admin, user_id, period_end)

    logger.info(
        f"🎟️ Subscription started for {user_id}: {product.tier} until {period_end.date()}, "
        f"card {token_row.get('card_brand') if token_row else '?'} "
        f"••••{token_row.get('card_last_four') if token_row else '????'}"
    )
    return row


def _upsert_token(admin, user_id: str, token_id: str, source: dict) -> Optional[dict]:
    """Store the saved card for display and for charging. Holds no card
    number — a token id and the four fields needed to render
    "Visa •••• 4242"."""
    payload = {
        "user_id": user_id,
        "moyasar_token_id": token_id,
        "status": "active",
        "card_brand": (source.get("company") or source.get("brand") or None),
        "card_last_four": (source.get("last_four") or source.get("number") or "")[-4:] or None,
        "card_expiry_month": str(source.get("month") or "") or None,
        "card_expiry_year": str(source.get("year") or "") or None,
        "is_default": True,
    }
    try:
        # Clear any previous default first: the partial unique index allows
        # exactly one default card per user, so setting a new one without
        # clearing the old would be rejected.
        admin.table("payment_tokens").update({"is_default": False}).eq(
            "user_id", user_id).eq("is_default", True).execute()
        return (admin.table("payment_tokens")
                .upsert(payload, on_conflict="moyasar_token_id")
                .execute().data or [None])[0]
    except Exception as e:
        logger.error(f"❌ Could not store card token {token_id} for {user_id}: {e}")
        return None


def _live_subscription(admin, user_id: str) -> Optional[dict]:
    return (admin.table("subscriptions").select("*")
            .eq("user_id", user_id).neq("status", "canceled")
            .maybe_single().execute().data)


def _align_credit_clock(admin, user_id: str, period_end: datetime) -> None:
    """Keep the credit reset on the same date as the billing period. See the
    two-clocks note at the top of this file."""
    try:
        admin.table("profiles").update(
            {"credits_reset_at": _iso(period_end)}).eq("id", user_id).execute()
    except Exception as e:
        logger.error(f"❌ Could not align credits_reset_at for {user_id}: {e}")


# ─── THE RENEWAL JOB ────────────────────────────────────────────────────────


def run_due_renewals(limit: int = 200) -> dict:
    """
    Charge every subscription whose next billing date has arrived.

    IDEMPOTENT ACROSS RUNS, three ways over:

      1. Advancing next_billing_date takes the row out of the query, so a
         second run the same day finds nothing.
      2. Every charge carries a `given_id` derived from the subscription and
         the period it pays for. That is Moyasar's own idempotency key, so
         even two runs racing each other cannot bill the same period twice —
         the second is answered with the first one's payment.
      3. Credits are granted through record_and_grant(), which claims the
         grant on the payments row before adding anything.

    (1) alone would not be enough: a run that crashes after charging but
    before advancing would recharge on the next run. (2) is what actually
    makes that safe.
    """
    admin = get_admin_client()
    now = _now()

    # BOTH active AND past_due. A past_due subscription still has a grace
    # window with an end date on it, and that end is what finally cancels it
    # and drops the account to Free. Selecting only 'active' would make
    # past_due a terminal state the job can never see again — grace would
    # never expire and a card that never works would buy indefinite access.
    due = (admin.table("subscriptions").select("*")
           .in_("status", ["active", "past_due"])
           .lte("next_billing_date", _iso(now))
           .limit(limit).execute().data or [])

    logger.info(f"🔁 Renewal run: {len(due)} subscription(s) due at {now.isoformat()}")
    summary = {"due": len(due), "charged": 0, "failed": 0, "skipped": 0, "past_due": 0, "canceled": 0}

    for sub in due:
        try:
            outcome = _renew_one(admin, sub, now)
            summary[outcome] = summary.get(outcome, 0) + 1
        except Exception as e:
            # One bad subscription must not stop the rest of the run.
            summary["failed"] += 1
            logger.error(f"❌ Renewal failed for subscription {sub.get('id')}: {e}")

    logger.info(f"🔁 Renewal run finished: {summary}")
    return summary


def _renew_one(admin, sub: dict, now: datetime) -> str:
    user_id = sub["user_id"]

    # A scheduled plan change is applied HERE, at the renewal, which is what
    # "takes effect at the next billing date" actually means. profiles
    # .pending_tier is the existing field for "what this account moves to next
    # cycle" — reset_credits_if_due() already applies it to the tier and the
    # credit allowance, so this only has to make sure the CHARGE matches.
    # Reading it at charge time rather than storing a second copy on the
    # subscription is what stops the two disagreeing.
    plan = _pending_plan(admin, user_id) or sub["plan"]
    if plan == "free":
        # Downgrading to Free is a cancellation, not a charge.
        return _end_subscription_at_period_end(admin, sub, now)

    reference = pricing.plan_reference_for_tier(plan)
    product = pricing.get_product(reference or "")
    if product is None:
        logger.error(f"🚫 Subscription {sub['id']} is on plan {sub['plan']!r}, which is not sold.")
        return "skipped"

    token = _token_for(admin, sub)
    if not token:
        logger.error(
            f"🚨 Subscription {sub['id']} ({user_id}) is due but has no usable saved card. "
            "Treating as a failed charge so dunning runs rather than silently stalling."
        )
        return _handle_failure(admin, sub, now, reason="no_card")

    # Derived from the period being paid for, so a retry of the SAME period
    # reuses it while next month's charge gets a new one.
    given_id = f"sub-{sub['id']}-{str(sub.get('current_period_end') or '')[:10]}"

    try:
        payment = moyasar_client.charge_token(
            token["moyasar_token_id"],
            product.amount_halalas,
            currency=pricing.CURRENCY,
            description=product.label_en,
            metadata={"user_id": user_id, "reference": reference,
                      "subscription_id": str(sub["id"])},
            given_id=given_id,
        )
    except moyasar_client.MoyasarUnreachable as e:
        # THE OUTCOME IS UNKNOWN, NOT FAILED. Do not count this as a dunning
        # failure and do not retry the charge — the card may well have been
        # billed. Leave the row due; the next run re-reads it, and the same
        # given_id means Moyasar returns the original payment rather than
        # making a second one.
        logger.warning(
            f"⏳ Could not reach Moyasar renewing subscription {sub['id']}: {e}. "
            "Left due; the next run resolves it under the same given_id."
        )
        return "skipped"
    except (moyasar_client.MoyasarError, moyasar_client.MoyasarConfigError) as e:
        logger.error(f"🚫 Moyasar refused the renewal charge for subscription {sub['id']}: {e}")
        return _handle_failure(admin, sub, now, reason=str(e))

    status = str(payment.get("status") or "").lower()
    if status not in _PAID_STATUSES:
        logger.info(f"↩️ Renewal charge for subscription {sub['id']} came back '{status}'.")
        return _handle_failure(admin, sub, now, reason=f"status={status}")

    return _handle_success(admin, sub, payment, now, plan)


def _token_for(admin, sub: dict) -> Optional[dict]:
    """The card to charge. Only an ACTIVE token is usable — a token stored
    months ago can have been deactivated, and assuming otherwise turns a
    recoverable dunning case into an unhandled exception."""
    token_id = sub.get("payment_token_id")
    if not token_id:
        return None
    row = (admin.table("payment_tokens").select("*")
           .eq("id", token_id).maybe_single().execute().data)
    if not row or row.get("status") != "active":
        return None
    return row


def _handle_success(admin, sub: dict, payment: dict, now: datetime, plan: str) -> str:
    """
    Advance the period on Moyasar's SYNCHRONOUS answer, and let the webhook
    reconcile.

    The alternative — wait for payment_paid before advancing — was rejected
    deliberately. The synchronous response IS Moyasar's answer, from the same
    API the webhook reports on; holding a paid subscription in limbo until a
    webhook arrives means a lost or delayed delivery costs a paying customer
    their access. The webhook still arrives and still runs record_and_grant(),
    which is idempotent, so it reconciles without granting twice.

    Only a definitively paid status gets here. Anything ambiguous went to
    _handle_failure or was left due, precisely so this path never advances a
    period on a maybe.
    """
    period_start = now
    period_end = add_month(now)

    admin.table("subscriptions").update({
        "current_period_start": _iso(period_start),
        "current_period_end": _iso(period_end),
        "next_billing_date": _iso(period_end),
        "failed_charge_count": 0,
        "status": "active",
        # The plan actually charged for. On a scheduled upgrade or downgrade
        # this is the new one, so the row stops describing the old plan the
        # moment the new price is taken.
        "plan": plan,
    }).eq("id", sub["id"]).execute()

    _align_credit_clock(admin, sub["user_id"], period_end)

    # Records the payments row AND grants the period's credits. Routed through
    # the same function the webhook uses so whichever arrives second finds the
    # grant already claimed.
    record_and_grant(payment, source="renewal")

    logger.info(
        f"✅ Renewed subscription {sub['id']} ({sub['user_id']}, {sub['plan']}) "
        f"through {period_end.date()}."
    )
    return "charged"


def _handle_failure(admin, sub: dict, now: datetime, reason: str) -> str:
    """
    Apply the dunning schedule. THE PERIOD IS NEVER ADVANCED HERE — an unpaid
    month must stay due, or a card that never works still buys a year.
    """
    attempts = int(sub.get("failed_charge_count") or 0) + 1
    due_at = _parse(sub.get("next_billing_date")) or now
    original_due = _original_due(sub, due_at)

    if attempts < MAX_CHARGE_ATTEMPTS:
        next_try = original_due + timedelta(days=DUNNING_RETRY_DAYS[attempts - 1])
        admin.table("subscriptions").update({
            "failed_charge_count": attempts,
            "next_billing_date": _iso(next_try),
        }).eq("id", sub["id"]).execute()
        logger.warning(
            f"⚠️ Renewal attempt {attempts}/{MAX_CHARGE_ATTEMPTS} failed for subscription "
            f"{sub['id']} ({reason}). Next attempt {next_try.date()}. Access continues."
        )
        _notify(sub, "retry", attempts=attempts, next_try=next_try)
        return "failed"

    # Out of attempts. Access continues to the end of the grace window, then
    # the account drops to Free — handled by the branch below on a later run.
    if sub.get("status") == "active":
        grace_end = original_due + timedelta(days=DUNNING_RETRY_DAYS[-1] + GRACE_DAYS_AFTER_PAST_DUE)
        admin.table("subscriptions").update({
            "failed_charge_count": attempts,
            "status": "past_due",
            "next_billing_date": _iso(grace_end),
        }).eq("id", sub["id"]).execute()
        logger.error(
            f"🚫 Subscription {sub['id']} ({sub['user_id']}) is PAST DUE after {attempts} "
            f"failed charges ({reason}). Access continues until {grace_end.date()}."
        )
        _notify(sub, "past_due", attempts=attempts, next_try=grace_end)
        return "past_due"

    return _cancel_for_nonpayment(admin, sub, attempts, reason)


def _cancel_for_nonpayment(admin, sub: dict, attempts: int, reason: str) -> str:
    """Grace is over. Cancel and drop the account to Free."""
    admin.table("subscriptions").update({
        "failed_charge_count": attempts,
        "status": "canceled",
        "canceled_at": _iso(_now()),
        "next_billing_date": None,
    }).eq("id", sub["id"]).execute()

    try:
        # pending_tier, not tier: the existing deferred-downgrade machinery
        # in reset_credits_if_due() already knows how to move someone to Free
        # and re-grant the right allowance. Setting tier directly here would
        # bypass it and leave the credit totals wrong.
        admin.table("profiles").update(
            {"pending_tier": "free", "subscription_status": "inactive"}
        ).eq("id", sub["user_id"]).execute()
    except Exception as e:
        logger.error(f"❌ Could not schedule the downgrade for {sub['user_id']}: {e}")

    logger.error(
        f"🚫 Subscription {sub['id']} ({sub['user_id']}) CANCELED for non-payment "
        f"after {attempts} attempts ({reason}). Account drops to Free."
    )
    _notify(sub, "canceled", attempts=attempts, next_try=None)
    return "canceled"


def _original_due(sub: dict, fallback: datetime) -> datetime:
    """Retries are spaced from the ORIGINAL due date — the end of the period
    being paid for — so a delayed run cannot stretch the schedule."""
    return _parse(sub.get("current_period_end")) or fallback


def _parse(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _notify(sub: dict, stage: str, attempts: int, next_try: Optional[datetime]) -> None:
    """
    Tell the customer their card failed.

    Uses the Resend sender that already exists for premium-order alerts
    (core/linkedin_notify) rather than introducing a second mail path. NEVER
    RAISES: a subscription's billing state must not depend on whether an email
    went out, and a failed send is logged with everything needed to follow up
    by hand.
    """
    try:
        from core.billing_notify import send_dunning_email
        send_dunning_email(sub, stage=stage, attempts=attempts, next_try=next_try)
    except Exception as e:
        logger.error(
            f"❌ Dunning email ({stage}) failed for subscription {sub.get('id')} "
            f"user {sub.get('user_id')}: {e}"
        )


# ─── The scheduled entry point's shared secret ──────────────────────────────


def cron_secret() -> str:
    return (os.getenv("CRON_SECRET", "") or "").strip()


# ─── CHANGING PLAN (§5) ─────────────────────────────────────────────────────


def _pending_plan(admin, user_id: str) -> Optional[str]:
    row = (admin.table("profiles").select("pending_tier")
           .eq("id", user_id).maybe_single().execute().data)
    return (row or {}).get("pending_tier")


def _end_subscription_at_period_end(admin, sub: dict, now: datetime) -> str:
    """A subscription whose scheduled next plan is Free. Nothing is charged;
    the row closes and reset_credits_if_due() moves the account down."""
    admin.table("subscriptions").update({
        "status": "canceled",
        "canceled_at": _iso(now),
        "next_billing_date": None,
    }).eq("id", sub["id"]).execute()
    logger.info(
        f"↩️ Subscription {sub['id']} ({sub['user_id']}) ended at period end — "
        "scheduled downgrade to Free, nothing charged."
    )
    return "canceled"


def change_plan(user_id: str, new_plan: str) -> dict:
    """
    Move between Free, Pro and Elite. TAKES EFFECT AT THE NEXT BILLING DATE.

    NO PRORATION, deliberately. Moyasar has no subscription object and no
    proration primitives, so charging or refunding a partial period would mean
    computing the difference and issuing refunds by hand — arithmetic around
    money, invented for this one feature. The codebase already has the right
    mechanism instead: profiles.pending_tier, which reset_credits_if_due()
    applies at the period boundary along with the correct credit allowance.

    The trade is that an upgrade is not instant. The alternative — charge the
    new price now and restart the period — silently bins the remainder of a
    month the customer already paid for, which is worse than waiting.

    Scheduling a change is free and reversible: it writes pending_tier and
    nothing else, so a customer who changes their mind before the renewal
    (see resume_subscription) is simply back where they were.
    """
    if new_plan not in ("free", "pro", "elite"):
        raise ValueError(f"change_plan got {new_plan!r}, expected free/pro/elite.")

    admin = get_admin_client()
    profile = (admin.table("profiles").select("tier, pending_tier")
               .eq("id", user_id).maybe_single().execute().data)
    if not profile:
        raise LookupError("Profile not found.")

    current = profile.get("tier")
    if new_plan == current and not profile.get("pending_tier"):
        return {"changed": False, "reason": "already_on_plan", "plan": current}

    sub = _live_subscription(admin, user_id)
    effective = (sub or {}).get("current_period_end")

    if new_plan == current:
        # Cancelling a scheduled change rather than making one.
        admin.table("profiles").update({"pending_tier": None}).eq("id", user_id).execute()
        logger.info(f"↩️ Scheduled plan change cleared for {user_id}; staying on {current}.")
        return {"changed": True, "plan": current, "pending_plan": None, "effective_at": effective}

    admin.table("profiles").update({"pending_tier": new_plan}).eq("id", user_id).execute()
    direction = "upgrade" if _rank(new_plan) > _rank(current) else "downgrade"
    logger.info(
        f"🔀 {direction.title()} scheduled for {user_id}: {current} -> {new_plan}, "
        f"effective {effective or 'at the next renewal'}."
    )
    return {"changed": True, "plan": current, "pending_plan": new_plan,
            "direction": direction, "effective_at": effective}


def _rank(tier: Optional[str]) -> int:
    return {"free": 0, "pro": 1, "elite": 2}.get(tier or "free", 0)
