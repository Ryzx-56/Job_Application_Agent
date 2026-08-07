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
# NOTE: this only schedules the change in your DB — it does NOT yet call the
# payment provider to actually stop a real recurring charge. Once a provider
# is wired, add that call here (e.g. cancel the provider-side subscription
# using payment_subscription_id) so the next billing cycle genuinely doesn't
# charge for the old tier.
from fastapi import HTTPException, status
from loguru import logger

from core.credits import get_admin_client


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
        .select("tier, pending_tier, credits_reset_at")
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

    # TODO once a payment provider is wired: cancel the actual recurring
    # charge here, using the stored payment_subscription_id. If that call
    # fails, raise before scheduling the downgrade below.

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
