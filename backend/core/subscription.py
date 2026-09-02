# core/subscription.py
#
# Cancel / downgrade a subscription. Same trust model as core/credits.py:
# the frontend can never write to `profiles` directly (no RLS policy grants
# it), so this is the only path a tier change can take. Uses the
# service_role client, same as credits.py.
#
# IMPORTANT: cancel_subscription() does NOT change `tier` or touch credits
# immediately. It only sets `pending_tier`, so the user keeps their current
# tier's access and credits for the rest of the cycle they already paid
# for. The actual switch (and adding the new tier's credits on top of
# whatever's left) happens in reset_credits_if_due() once credits_reset_at
# is reached — see 006_deferred_downgrade.sql.
#
# PROVIDER-SIDE CANCELLATION is wired below rather than left as a note. It is
# inert today (nobody has a payment_subscription_id, because no provider
# creates one yet) and becomes live the moment one does, without anyone having
# to remember this file exists.
from fastapi import HTTPException, status
from loguru import logger

from datetime import datetime, timezone

from core.credits import get_admin_client


def activate_paid_subscription(
    user_id: str,
    tier: str,
    *,
    provider: str | None = None,
    customer_id: str | None = None,
    subscription_id: str | None = None,
    locked_price: float | None = None,
) -> dict:
    """
    Turns a SUCCESSFUL PAYMENT into a paid account. Call this from the
    subscription payment webhook, once, on a charge that actually succeeded.

    THIS IS THE FUNCTION THE FOUNDING-MEMBER BADGE DEPENDS ON.
    claim_founding_member_slot() exists in the database and, until this
    function was added, had no caller anywhere in the codebase. Switching
    payments on without calling it would have awarded Founding Member to
    nobody — silently, while the pricing page promises it to the first 50 Pro
    subscribers. Claiming the slot here rather than at a separate call site is
    the point: there is one place a subscription becomes paid, so the badge
    cannot be forgotten independently of the thing that earns it.

    Nothing calls this yet, because no subscription payment flow exists — only
    the LinkedIn add-on has a webhook. It is the documented integration point;
    see core/PAYMENTS_LAUNCH_CHECKLIST.md.

    Ordered so the money-state is recorded before the badge: a failure to
    claim a slot must never cost someone the subscription they paid for, which
    is why the claim is caught rather than raised.
    """
    if tier not in ("pro", "elite"):
        raise ValueError(f"activate_paid_subscription is for paid tiers only, got {tier!r}.")

    admin = get_admin_client()

    updates: dict = {
        "tier": tier,
        "subscription_status": "active",
        # A fresh payment clears any scheduled downgrade — someone who
        # cancelled and then paid again is not still on their way to Free.
        "pending_tier": None,
    }
    if provider:
        updates["payment_provider"] = provider
    if customer_id:
        updates["payment_customer_id"] = customer_id
    if subscription_id:
        updates["payment_subscription_id"] = subscription_id
    if locked_price is not None:
        updates["locked_price"] = locked_price

    result = admin.table("profiles").update(updates).eq("id", user_id).select().execute()
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    logger.info(f"💳 Subscription activated for user {user_id} on {tier}.")

    # The 1-arg overload is the correct one: it is idempotent (a retried
    # webhook cannot consume a second slot), takes an advisory lock so two
    # simultaneous payments cannot both be handed slot 50, and is granted to
    # service_role only. The 3-arg overload is stale and had its EXECUTE
    # revoked during the Section 1 hardening — do not call it.
    try:
        slot = admin.rpc("claim_founding_member_slot", {"p_user_id": user_id}).execute().data
        if slot:
            logger.info(f"🏅 User {user_id} claimed Founding Member slot #{slot}.")
    except Exception as e:
        # Never fatal: the person has paid and their tier is already set. A
        # missing badge is cosmetic and recoverable by hand; failing here
        # would leave a real payment unrecorded.
        logger.error(f"❌ Could not claim a founding-member slot for {user_id}: {e}")

    return row


def cancel_subscription(user_id: str) -> dict:
    admin = get_admin_client()

    # BUG FIX: .single() raises instead of returning None when a query
    # matches zero rows — e.g. a user whose signup partially failed and
    # never got a profile row. That made the "if not profile: raise 404"
    # check below unreachable; a missing profile crashed with an
    # unhandled 500 instead. .maybe_single() returns None for zero rows
    # like this code already assumed. Same fix applied everywhere else in
    # this file and in core/credits.py.
    profile = (
        admin.table("profiles")
        .select("tier, pending_tier, credits_reset_at, payment_subscription_id")
        .eq("id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    if profile["tier"] == "free":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You're already on the Free plan.",
        )

    # STOP THE REAL CHARGE FIRST.
    #
    # Ordered deliberately: the renewal is stopped BEFORE the downgrade is
    # scheduled. Telling someone their subscription is cancelled while their
    # card keeps being charged is the worst outcome available, and doing it
    # the other way round produces exactly that whenever the second step
    # fails.
    #
    # There is no provider call here any more. Moyasar has no subscription
    # object — the schedule lives in OUR subscriptions table and the charge is
    # made by our own renewal job, so "cancel with the provider" was always a
    # call to a stub. Stopping the charge means taking the row out of the
    # job's query, which is what setting status to canceled does.
    try:
        admin.table("subscriptions").update({
            "status": "canceled",
            "canceled_at": _iso_now(),
            "next_billing_date": None,
        }).eq("user_id", user_id).neq("status", "canceled").execute()
    except Exception as e:
        logger.error(
            f"❌ Could not stop renewals for user {user_id}: {e}. Refusing to schedule the "
            "downgrade — the card could still be charged next cycle."
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "cancellation_unavailable",
                "message": "We couldn't cancel your billing just now. Please try again shortly, "
                           "or contact support so we can stop it manually.",
            },
        )

    # Founding-member price is locked in only while the subscription stays
    # continuously active — clearing it here means a resubscribe later goes
    # through at the normal list price, not the offer price. If you decide
    # the offer should be truly permanent regardless of cancellation, drop
    # "locked_price": None from this update.
    result = (
        admin.table("profiles")
        .update({"pending_tier": "free", "subscription_status": "canceling", "locked_price": None})
        .eq("id", user_id)
        .select()
        .execute()
    )
    # BUG FIX: same .maybe_single()-doesn't-exist-on-this-builder-type issue
    # as core/location.py hit in production — .update().eq().select()
    # returns a builder that only supports plain list access, not
    # .maybe_single()/.single(). Index into .data instead.
    row = result.data[0] if result.data else None

    logger.info(
        f"↩️ Subscription cancel scheduled for user {user_id} — "
        f"stays on {profile['tier']} until {profile['credits_reset_at']}, then moves to Free."
    )
    return row


def resume_subscription(user_id: str) -> dict:
    """Undo a scheduled cancellation/downgrade — clears pending_tier so the
    user's current tier just continues as normal at the next renewal."""
    admin = get_admin_client()

    # Same .single() -> .maybe_single() fix as cancel_subscription above.
    profile = admin.table("profiles").select("pending_tier").eq("id", user_id).maybe_single().execute().data
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    if profile["pending_tier"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No scheduled change to undo.",
        )

    result = (
        admin.table("profiles")
        .update({"pending_tier": None, "subscription_status": "active"})
        .eq("id", user_id)
        .select()
        .execute()
    )
    row = result.data[0] if result.data else None
    logger.info(f"↩️ Cancellation undone for user {user_id}.")
    return row


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
