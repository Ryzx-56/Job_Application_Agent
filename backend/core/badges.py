# core/badges.py
#
# Single source of truth for which badges a user currently holds.
#
# Previously each badge was fetched from its own place — is_admin and
# is_owner from one endpoint, is_founding_member and tier from the credits
# query — and the frontend assembled the list. That doesn't survive tier
# badges: Pro/Elite/Free are DERIVED from live subscription state rather
# than stored, and "which badge is new since last time" needs the whole set
# computed together. Doing it here means one rule, one place.
#
# NOTHING HERE GRANTS ANYTHING. Every privileged route authorizes on
# is_admin via core/auth.py and nothing else; these are display only.
from fastapi import APIRouter, Depends
from loguru import logger

from core.auth import get_current_user_id
from core.credits import get_admin_client

router = APIRouter()

# Subscription states that mean "actually paying right now". Anything else
# (cancelled, past_due, unpaid, null) is treated as lapsed, which is what
# drops someone back to the Free badge.
ACTIVE_SUBSCRIPTION_STATES = {"active", "trialing"}

# Rendered highest-standing first so the row reads as a hierarchy.
BADGE_ORDER = ["owner", "admin", "elite", "pro", "founding_member", "alpha_tester", "free"]


def compute_badges(profile: dict) -> list[str]:
    """
    The badges this profile currently earns, in display order.

    TIER BADGES ARE MUTUALLY EXCLUSIVE and derived, never stored: exactly
    one of elite / pro / free is always present. A lapsed subscription
    (status not active/trialing) falls back to free automatically, which is
    what makes the Pro badge disappear on cancellation without anything
    having to run a cleanup job.

    Everything else is an independent flag and can stack — an owner can also
    be an alpha tester and a founding member.
    """
    badges: list[str] = []

    if profile.get("is_owner"):
        badges.append("owner")
    if profile.get("is_admin"):
        badges.append("admin")

    tier = (profile.get("tier") or "free").lower()
    subscribed = (profile.get("subscription_status") or "") in ACTIVE_SUBSCRIPTION_STATES
    if tier == "elite" and subscribed:
        badges.append("elite")
    elif tier == "pro" and subscribed:
        badges.append("pro")
    else:
        # Includes free-tier users AND anyone whose paid subscription has
        # lapsed. There is no "no badge" state.
        badges.append("free")

    # Awarded on the first successful PAYMENT, not on selecting a plan —
    # see claim_founding_member_slot in 007_badge_state.sql, which the
    # payment webhook calls. Kept even if the subscription later lapses:
    # they were still one of the first 50 to pay, and the pricing reference
    # describes it as permanent.
    if profile.get("is_founding_member"):
        badges.append("founding_member")

    if profile.get("is_alpha_tester"):
        badges.append("alpha_tester")

    return [b for b in BADGE_ORDER if b in badges]


def _fetch_profile(user_id: str) -> dict | None:
    """
    Reads only the badge-relevant columns.

    Selected one at a time rather than as a single list because PostgREST
    fails the WHOLE query if any named column is missing, and these columns
    arrived across several migrations — a database that hasn't run the
    latest one must still return the badges it can, not nothing.
    """
    admin = get_admin_client()
    wanted = [
        "tier", "subscription_status", "is_owner", "is_admin",
        "is_alpha_tester", "is_founding_member", "founding_member_number",
        "seen_badges",
    ]
    profile: dict = {}
    for column in wanted:
        try:
            row = (
                admin.table("profiles")
                .select(column)
                .eq("id", user_id)
                .maybe_single()
                .execute()
                .data
            )
        except Exception:
            continue  # column not present on this schema yet
        if row:
            profile[column] = row.get(column)
    return profile or None


@router.get("/api/v1/profile/badges", tags=["Profile"])
def get_badges(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Current badges, plus which of them the user hasn't been congratulated
    for yet.

    `new` drives the unlock popup. It is NOT cleared here — the frontend
    marks badges seen only after it has actually shown them, so a user who
    closes the tab mid-animation still gets the popup next time instead of
    silently missing it.
    """
    profile = _fetch_profile(user_id)
    if not profile:
        return {"badges": [], "new": [], "founding_member_number": None}

    earned = compute_badges(profile)
    seen = set(profile.get("seen_badges") or [])

    return {
        "badges": earned,
        "new": [b for b in earned if b not in seen],
        "founding_member_number": profile.get("founding_member_number"),
    }


@router.post("/api/v1/profile/badges/seen", tags=["Profile"])
def mark_badges_seen(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Records every currently-earned badge as seen, so the popup doesn't fire
    for them again.

    Marks the badges recomputed right now rather than trusting a list from
    the client: a request claiming to have seen a badge the user doesn't
    hold would otherwise suppress that badge's popup forever if they later
    earned it for real.
    """
    profile = _fetch_profile(user_id)
    if not profile:
        return {"seen": []}

    earned = compute_badges(profile)
    # Union with what's already stored, so a badge that was earned, seen,
    # lost (a lapsed subscription) and earned again doesn't re-congratulate.
    merged = sorted(set(profile.get("seen_badges") or []) | set(earned))

    try:
        get_admin_client().table("profiles").update({"seen_badges": merged}).eq("id", user_id).execute()
    except Exception as e:
        # Non-fatal: worst case the popup shows once more next visit, which
        # is far better than failing the dashboard load over a cosmetic ack.
        logger.warning(f"Couldn't persist seen_badges for {user_id}: {e}")

    return {"seen": merged}
