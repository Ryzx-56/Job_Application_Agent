# core/entitlements.py
#
# What a subscription includes beyond credits, and how much of it is left
# this month.
#
# Two add-ons are bundled into Pro and Elite rather than sold: LinkedIn
# Essential and Interview Prep (pricing reference v6 §4 and §5). Neither has
# a price any more, so the thing that has to be enforced is the monthly cap,
# and it has to be enforced HERE, server-side, on every generation. A cap
# that only exists in the pricing table is not a cap.
#
# TRACKED THE SAME WAY CREDITS ARE, deliberately (reference §5):
#   · a counter column on `profiles`, one per add-on,
#   · incremented atomically by a Postgres function, exactly like
#     reserve_credits() so two parallel requests can't both pass the check,
#   · zeroed by reset_credits_if_due() on the same monthly boundary that
#     refills credits, so there is one cycle in the system rather than two.
#
# The columns and the function ship in supabase/migrations/009_addon_quotas.sql.
# Until that migration is applied, _consume() fails OPEN and logs loudly, see
# the note on it below for why that direction was chosen.
from fastapi import HTTPException, status
from loguru import logger

from core.auth import PAID_TIERS, read_subscription_tier
from core.credits import get_admin_client

# The two metered add-ons. The string values are the `addon` argument the SQL
# function takes and the suffix of the column it increments
# (`{addon}_used` on profiles), so adding a third one is a migration plus an
# entry here, nothing else.
LINKEDIN_ESSENTIAL = "linkedin_essential"
INTERVIEW_PREP = "interview_prep"

# Monthly allowance per tier, from pricing reference v6 §3, §4 and §5.
# Free is 0 for both: both features are locked on Free, and stating that as a
# cap of zero rather than a special case means the same code path answers
# "can this user do it" for every tier.
ADDON_CAPS: dict[str, dict[str, int]] = {
    "free":  {LINKEDIN_ESSENTIAL: 0, INTERVIEW_PREP: 0},
    "pro":   {LINKEDIN_ESSENTIAL: 2, INTERVIEW_PREP: 5},
    "elite": {LINKEDIN_ESSENTIAL: 5, INTERVIEW_PREP: 15},
}

# Human-readable, for logs only. User-facing labels come from the frontend
# dictionary like every other piece of copy.
ADDON_LABELS = {
    LINKEDIN_ESSENTIAL: "LinkedIn Essential",
    INTERVIEW_PREP: "Interview Prep",
}


def cap_for(tier: str, addon: str) -> int:
    return ADDON_CAPS.get((tier or "free").lower(), ADDON_CAPS["free"]).get(addon, 0)


def get_addon_quota(user_id: str, addon: str) -> dict:
    """
    This user's allowance and usage for one add-on, for display.

    Read-only and never raises: a page has to be able to render even when the
    counter column doesn't exist yet, so a failed read reports usage 0 rather
    than blocking the page. Enforcement is consume_addon_quota below, which
    is the only thing that decides anything.
    """
    tier = read_subscription_tier(user_id)
    limit = cap_for(tier, addon)
    used = 0

    try:
        row = (
            get_admin_client()
            .table("profiles")
            .select(f"{addon}_used")
            .eq("id", user_id)
            .maybe_single()
            .execute()
            .data
        )
        used = int((row or {}).get(f"{addon}_used") or 0)
    except Exception as e:
        # Column missing (migration not applied) or a transient failure.
        # Reported as 0 used, which shows the full allowance rather than
        # locking someone out of something they paid for.
        logger.warning(f"Could not read {addon}_used for {user_id}: {e}")

    return {
        "tier": tier,
        "limit": limit,
        "used": min(used, limit) if limit else used,
        "remaining": max(limit - used, 0),
        "unlocked": tier in PAID_TIERS and limit > 0,
    }


def require_addon_quota(user_id: str, addon: str) -> dict:
    """
    Refuses the request unless this user is on a tier that includes the
    add-on AND has allowance left. Returns the quota it checked.

    Read-then-act, so it is NOT the atomic guard on its own: it exists to
    give a clean, specific error before an expensive generation starts.
    consume_addon_quota is what actually claims a slot.
    """
    quota = get_addon_quota(user_id, addon)

    if not quota["unlocked"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "upgrade_required",
                "tier": quota["tier"],
                "message": "This feature is available on the Pro and Elite plans.",
            },
        )

    if quota["remaining"] <= 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "monthly_limit_reached",
                "addon": addon,
                "tier": quota["tier"],
                "limit": quota["limit"],
                "used": quota["used"],
                "message": (
                    f"You've used all {quota['limit']} of this month's "
                    f"{ADDON_LABELS.get(addon, addon)} generations."
                ),
            },
        )

    return quota


def consume_addon_quota(user_id: str, addon: str) -> dict:
    """
    Atomically claims one slot. THIS is the enforcement point.

    Calls consume_addon_quota() in Postgres, which checks and increments in a
    single statement for the same reason reserve_credits() does: two requests
    firing at once must not both pass a check that neither has yet acted on.

    FAILS OPEN if the function or column is missing, and says so at ERROR
    level. That direction is deliberate and worth stating: the alternative is
    that deploying this code before running 009_addon_quotas.sql silently
    denies a paying subscriber a feature they are entitled to. An
    over-generous cap for the window between deploy and migration is the
    cheaper mistake, and the log line makes the window visible.
    """
    quota = require_addon_quota(user_id, addon)

    try:
        granted = bool(
            get_admin_client()
            .rpc("consume_addon_quota", {
                "p_user_id": user_id,
                "p_addon": addon,
                "p_limit": quota["limit"],
            })
            .execute()
            .data
        )
    except Exception as e:
        logger.error(
            f"❌ consume_addon_quota({addon}) could not run for {user_id}: {e}. "
            "Allowing this generation UNMETERED. Apply "
            "supabase/migrations/009_addon_quotas.sql to enforce the cap."
        )
        return quota

    if not granted:
        # Another request took the last slot between the read above and this
        # increment. Rare, and the correct answer is the same as being over.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "monthly_limit_reached",
                "addon": addon,
                "tier": quota["tier"],
                "limit": quota["limit"],
                "used": quota["limit"],
                "message": (
                    f"You've used all {quota['limit']} of this month's "
                    f"{ADDON_LABELS.get(addon, addon)} generations."
                ),
            },
        )

    logger.info(
        f"🎟️ {ADDON_LABELS.get(addon, addon)}: slot {quota['used'] + 1}/{quota['limit']} "
        f"claimed by {user_id} ({quota['tier']})."
    )
    return quota


def release_addon_quota(user_id: str, addon: str) -> None:
    """
    Gives a claimed slot back after a failed generation, mirroring
    refund_credits(). A generation that produced nothing must not cost a
    slot, for the same reason it must not cost a credit.

    Never raises: a failed release is logged so a balance can be corrected by
    hand, but it must not mask the generation error that caused it.
    """
    try:
        get_admin_client().rpc("release_addon_quota", {"p_user_id": user_id, "p_addon": addon}).execute()
        logger.info(f"↩️ Returned one {ADDON_LABELS.get(addon, addon)} slot to {user_id} after a failure.")
    except Exception as e:
        logger.error(f"❌ Could not return a {addon} slot to {user_id}: {e}")
