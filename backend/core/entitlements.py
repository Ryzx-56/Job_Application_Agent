# core/entitlements.py
#
# What a subscription includes beyond credits, and how much of it is left
# this month — and, since 2026-09-12, what it costs to buy more of it with
# credits once that runs out.
#
# Two add-ons are bundled into Pro and Elite rather than sold: LinkedIn
# Essential and Interview Prep (pricing reference v6 §4 and §5). Job Search
# joined them 2026-09-09, then was unified across its two entry points
# 2026-09-12 (see JOB_SEARCH below). Neither has a price of its own, so the
# thing that has to be enforced is the monthly cap, and it has to be
# enforced HERE, server-side, on every generation. A cap that only exists in
# the pricing table is not a cap.
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
#
# ─── CREDIT-PURCHASABLE, 2026-09-12 ─────────────────────────────────────────
#
# begin_addon_use() / release_addon_use() are the NEW enforcement point for
# all three add-ons, replacing require_addon_quota()/consume_addon_quota() as
# what a caller actually invokes (those two still exist and still work, but
# their all-or-nothing "not on this tier -> 403" shape is now wrong for a
# feature anyone can buy with credits — see begin_addon_use's docstring).
# SPEND ORDER: baseline first, always; credits only once baseline is
# exhausted, and only with an explicit confirmation from the caller (never
# silently). See prompts/claude-code-prompt-credit-addons.md items 1 and 2.
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from core.auth import PAID_TIERS, get_current_user_id, read_subscription_tier
from core.credits import get_admin_client, maybe_row, refund_credits, reserve_addon_credits
from core.pricing import ADDON_CREDIT_COSTS

# The two metered add-ons. The string values are the `addon` argument the SQL
# function takes and the suffix of the column it increments
# (`{addon}_used` on profiles), so adding a third one is a migration plus an
# entry here, nothing else.
LINKEDIN_ESSENTIAL = "linkedin_essential"
INTERVIEW_PREP = "interview_prep"
# Added pre-launch. Job Search was the only paid feature with no cap at all,
# and it is the most expensive thing the product does — one standalone search
# is 24-36 Tavily credits against a quota shared by the whole platform.
JOB_SEARCH = "job_search"

# Monthly allowance per tier, from pricing reference v6 §3, §4 and §5.
# Free is 0 for both: both features are locked on Free, and stating that as a
# cap of zero rather than a special case means the same code path answers
# "can this user do it" for every tier.
#
# JOB_SEARCH bumped 4->5 (Pro) / 12->13 (Elite) on 2026-09-12, the "no full
# switch" column of the depth-history-allowance prompt's Part 3 — conditional
# on the tavily_depth_test.py run NOT justifying a global switch to 'basic'
# (it didn't; see PRIORITY_LANE_SEARCH_DEPTH in agents/jobs_finder.py for the
# one lane where the data did support a change). Had the global switch
# landed, per-search cost would have roughly halved and the bump would have
# been to 6/15 instead — see that prompt file for the full table.
ADDON_CAPS: dict[str, dict[str, int]] = {
    "free":  {LINKEDIN_ESSENTIAL: 0, INTERVIEW_PREP: 0,  JOB_SEARCH: 0},
    "pro":   {LINKEDIN_ESSENTIAL: 2, INTERVIEW_PREP: 5,  JOB_SEARCH: 5},
    "elite": {LINKEDIN_ESSENTIAL: 5, INTERVIEW_PREP: 15, JOB_SEARCH: 13},
}

# Human-readable, for logs only. User-facing labels come from the frontend
# dictionary like every other piece of copy.
ADDON_LABELS = {
    LINKEDIN_ESSENTIAL: "LinkedIn Essential",
    INTERVIEW_PREP: "Interview Prep",
    JOB_SEARCH: "Job Search",
}


# ─── REMOVED 2026-09-12: THE PACK-BUYER TIER PROMOTION ──────────────────────
#
# This used to hold PACK_BUYER_TIER, has_purchased_credits() and
# effective_tier() — a free user holding purchased_credits > 0 was gated as
# 'pro' for these three add-ons, for as long as the credits lasted. Removed
# entirely (credit-addons prompt item 1): a user's tier for allowance
# purposes is now STRICTLY their subscription tier, full stop.
#
# WHY THIS WAS WRONG, NOT JUST INCONSISTENT: a Power-pack buyer (38 SAR, 30
# credits) got the Pro MONTHLY BASELINE too — 2 free LinkedIn Essentials, 5
# free Interview Preps, 5 free Job Searches, none of which they paid for and
# none of which drew on their 30 credits. A subscription's baseline is
# supposed to be funded by the subscription price; this promotion handed it
# out for the price of a one-time pack, indefinitely, for as long as any
# fraction of those 30 credits remained unspent (a single unused credit was
# enough). See the real-cost example in CLAUDE.md's "a paid subscription
# written with no card" and "a customer who bought a credit pack refused the
# features it buys" — this bug was the SECOND one, told the other way round:
# the credits were honoured, but honoured as something bigger than what was
# bought.
#
# WHAT REPLACES IT: buying a pack still has to unlock something, or packs
# don't sell — see the 2026-09-01 note this section used to carry. It just
# unlocks it correctly now: begin_addon_use() below lets ANY authenticated
# user spend ordinary credits on these three add-ons once their tier's own
# baseline (zero, for Free and for a pack buyer who isn't ALSO a Pro/Elite
# subscriber) is exhausted — which for a zero baseline means immediately.
# That is "exactly like anyone else" from the prompt: a pack's credits spend
# on a CV, or on one of these three, at the same fixed exchange rate,
# and nothing about holding them promotes a tier.
#
# get_current_paid_user_id() in core/auth.py used to call effective_tier()
# for the same reason; it now calls read_subscription_tier() directly (that
# gate is for whatever, if anything, is EXCLUSIVELY Pro/Elite with no
# credit-purchase alternative — nothing currently is, see that function's
# docstring).


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
    # STRICT subscription tier — see the removal note above. A pack buyer
    # spends what they paid for through begin_addon_use()'s credit path
    # below, not through a promoted baseline here.
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
        "unlocked": (tier in PAID_TIERS) and limit > 0,
    }


def require_addon_quota(user_id: str, addon: str) -> dict:
    """
    Refuses the request unless this user is on a tier that includes the
    add-on AND has allowance left. Returns the quota it checked.

    Read-then-act, so it is NOT the atomic guard on its own: it exists to
    give a clean, specific error before an expensive generation starts.
    consume_addon_quota is what actually claims a slot.

    ⚠️ NOT USED BY LinkedIn Essential, Interview Prep or Job Search ANY MORE
    (2026-09-12) — its "not unlocked on this tier -> 403" shape is exactly
    wrong for a feature anyone can now buy with credits once the baseline is
    zero (that includes Free, whose baseline always is). Those three call
    begin_addon_use() below instead. Kept for a genuinely bundle-only add-on
    with no credit-purchase alternative, if one is ever added — there isn't
    one today.
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


# ═══════════════════════════════════════════════════════════════════════════
# CREDIT-PURCHASABLE ADD-ONS (2026-09-12)
# ═══════════════════════════════════════════════════════════════════════════
#
# Only Job Search has a PURCHASE cap on top of its baseline — it is the
# single most expensive thing the product does (pricing-reference-v7.md
# §1.1), so unlike LinkedIn Essential and Interview Prep (bought with
# credits with no extra limit beyond the credits themselves), a subscriber
# cannot use credits to buy an unbounded number of searches in a month. The
# cap equals the baseline: at most double your monthly searches by paying
# for the second half. Pro 5 baseline + 5 purchasable = 10 max; Elite 13 + 13
# = 26 max.
PURCHASE_CAPPED_ADDONS = {JOB_SEARCH}


def purchase_cap_for(tier: str, addon: str) -> int | None:
    """None means uncapped — limited only by how many credits the user has.
    The one capped addon uses the SAME number as its baseline, by design
    (see PURCHASE_CAPPED_ADDONS above), so this is just cap_for() again
    rather than a second table that could drift from the first."""
    if addon not in PURCHASE_CAPPED_ADDONS:
        return None
    return cap_for(tier, addon)


def _consume_baseline_slot(user_id: str, addon: str, limit: int) -> bool:
    """
    Atomically claims one baseline slot if under `limit`, or False if there
    is no room — NOT an exception, unlike consume_addon_quota(), because the
    caller (begin_addon_use) needs to fall through to the credit path
    on a plain "no room left" rather than treat it as a hard refusal. This
    is why begin_addon_use calls the SQL function directly instead of going
    through require_addon_quota()/consume_addon_quota(), whose 403 "not
    unlocked" response has no meaning here — a zero baseline is just the
    baseline being exhausted immediately, the same as any other tier's cap.

    FAILS OPEN or on the SAME direction as consume_addon_quota() when the
    RPC itself is missing/broken: reported as a successful baseline claim,
    since the migration not being applied must not silently start charging
    credits for something Pro/Elite subscribers already pay for monthly.
    """
    try:
        return bool(
            get_admin_client()
            .rpc("consume_addon_quota", {"p_user_id": user_id, "p_addon": addon, "p_limit": limit})
            .execute()
            .data
        )
    except Exception as e:
        logger.error(
            f"❌ consume_addon_quota({addon}) could not run for {user_id}: {e}. "
            "Treating this as a successful baseline claim (fail open) rather than "
            "silently falling through to a credit charge."
        )
        return True


def _read_purchased_count(user_id: str, addon: str) -> int:
    """This cycle's purchases-made count for one add-on. 0 on a read
    failure — the same direction get_addon_quota takes for `used`, and for
    the same reason: undercounting a cap is the safe failure, not locking
    someone out of something they might not have actually bought yet."""
    try:
        row = (
            get_admin_client()
            .table("profiles")
            .select(f"{addon}_purchased")
            .eq("id", user_id)
            .maybe_single()
            .execute()
            .data
        )
        return int((row or {}).get(f"{addon}_purchased") or 0)
    except Exception as e:
        logger.warning(f"Could not read {addon}_purchased for {user_id}: {e}")
        return 0


def _consume_purchase_slot(user_id: str, addon: str, purchase_limit: int | None) -> bool:
    """Atomically records one credit-bought use, enforcing `purchase_limit`
    (None = uncapped) at the database — the same concurrency reasoning as
    consume_addon_quota: two simultaneous purchases at the cap must not both
    succeed. Fails OPEN (same direction as the baseline RPC) if the function
    is missing, since the credits were already reserved by the time this
    runs — refusing here would need to refund them right back, achieving
    nothing but a confusing round trip for the user."""
    try:
        return bool(
            get_admin_client()
            .rpc("consume_addon_purchase", {
                "p_user_id": user_id, "p_addon": addon, "p_limit": purchase_limit,
            })
            .execute()
            .data
        )
    except Exception as e:
        logger.error(f"❌ consume_addon_purchase({addon}) could not run for {user_id}: {e}. Allowing it.")
        return True


def _release_purchase_slot(user_id: str, addon: str) -> None:
    """Mirrors release_addon_quota, for the purchases-made counter."""
    try:
        get_admin_client().rpc("release_addon_purchase", {"p_user_id": user_id, "p_addon": addon}).execute()
    except Exception as e:
        logger.error(f"❌ Could not release a {addon} purchase slot for {user_id}: {e}")


def credit_balance(user_id: str) -> int:
    """This user's spendable credit balance, for display in a 402's message
    and in the dashboard summary. 0 on a read failure — see get_addon_quota's
    note on why an unreadable count degrades to a safe display value rather
    than raising here; the actual spend (reserve_addon_credits) re-reads and
    is what really enforces the balance."""
    try:
        row = maybe_row(
            get_admin_client()
            .table("profiles")
            .select("credits_remaining")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        return int((row or {}).get("credits_remaining") or 0)
    except Exception as e:
        logger.warning(f"Could not read credits_remaining for {user_id}: {e}")
        return 0


def begin_addon_use(user_id: str, addon: str, confirmed_purchase: bool = False) -> dict:
    """
    Decides how to pay for ONE use of `addon` and atomically claims it,
    returning a token release_addon_use needs if the feature then fails to
    run. THIS is the enforcement point for LinkedIn Essential, Interview
    Prep and Job Search — nothing else spends anything for these three.

    SPEND ORDER, ALWAYS: the monthly baseline first. Only once it is
    exhausted (which for a Free-tier user, or a pack buyer who isn't
    separately a Pro/Elite subscriber, is immediately — their baseline is
    zero) does this look at credits at all, and it will not spend one
    without `confirmed_purchase=True` — see the 402 branch below. This is
    what "never silently spend credits while baseline remains" and "the
    purchase must be explicit" (credit-addons prompt item 2) actually mean
    in code, not just in the response copy.

    Raises rather than returning a sentinel on every refusal, per CLAUDE.md's
    rule on this: a caller cannot mistake "here is your token" for "here is
    why this didn't happen" if the two are different control-flow paths
    entirely.
      · 429 purchase_limit_reached — Job Search only, the purchase cap
        (equal to the baseline) is spent too. Raised BEFORE any credits are
        touched.
      · 402 addon_purchase_available — baseline exhausted, credits could
        cover it, but the caller didn't confirm. Names the addon, the exact
        cost, and the current balance so the frontend can ask
        ("Use 5 credits for another Job Search? You have 18.") without a
        second round trip to find any of those three numbers out.
      · 402 insufficient_credits — confirmed, but the balance can't cover
        it (from reserve_addon_credits).
    """
    quota = get_addon_quota(user_id, addon)
    if quota["remaining"] > 0 and _consume_baseline_slot(user_id, addon, quota["limit"]):
        return {"source": "baseline", "addon": addon}

    # Baseline exhausted, or this tier never had one — credits are the only
    # path left, offered to anyone, exactly like anyone else (item 1).
    cost = ADDON_CREDIT_COSTS[addon]
    purchase_limit = purchase_cap_for(quota["tier"], addon)
    if purchase_limit is not None and _read_purchased_count(user_id, addon) >= purchase_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "purchase_limit_reached",
                "addon": addon,
                "purchase_limit": purchase_limit,
                "message": (
                    f"You've bought the most {ADDON_LABELS.get(addon, addon)} this month allows "
                    f"with credits ({purchase_limit}). It resets with your next billing cycle."
                ),
            },
        )

    if not confirmed_purchase:
        balance = credit_balance(user_id)
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "addon_purchase_available",
                "addon": addon,
                "credit_cost": cost,
                "credit_balance": balance,
                "message": (
                    f"Use {cost} credits for another {ADDON_LABELS.get(addon, addon)}? "
                    f"You have {balance}."
                ),
            },
        )

    reserved = reserve_addon_credits(user_id, cost, ADDON_LABELS.get(addon, addon))
    if not _consume_purchase_slot(user_id, addon, purchase_limit):
        # Lost a race for the last purchase slot between the check above and
        # now — give the credits straight back rather than charge for a use
        # that the cap says didn't happen.
        refund_credits(user_id, reserved)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "purchase_limit_reached",
                "addon": addon,
                "purchase_limit": purchase_limit,
                "message": (
                    f"You've bought the most {ADDON_LABELS.get(addon, addon)} this month allows "
                    "with credits. Nothing was charged."
                ),
            },
        )

    logger.info(f"🎟️ {ADDON_LABELS.get(addon, addon)}: {cost} credit(s) charged for {user_id} (baseline exhausted).")
    return {"source": "credits", "addon": addon, "reserved": reserved}


def release_addon_use(user_id: str, token: dict) -> None:
    """
    Gives back whatever begin_addon_use() claimed, after the feature failed
    to run — the single release point for both payment sources, so a caller
    doesn't need to remember which branch it took.

    Never raises, same as release_addon_quota/refund_credits: a failed
    release is logged for a manual fix, but must never mask the real error
    that made the release necessary.
    """
    addon = token.get("addon")
    if token.get("source") == "credits":
        refund_credits(user_id, token["reserved"])
        _release_purchase_slot(user_id, addon)
    else:
        release_addon_quota(user_id, addon)


# ═══════════════════════════════════════════════════════════════════════════
# THE ONE DASHBOARD ROUND TRIP (2026-09-12, credit-addons prompt item 6)
# ═══════════════════════════════════════════════════════════════════════════
#
# Before this, a dashboard wanting "how much of each add-on is left" had no
# single place to ask — LinkedIn Essential and Interview Prep each expose
# `quota` inline in their OWN generation responses (core/linkedin.py,
# core/interview.py), which only updates after you've already generated one,
# and Job Search exposed nothing at all. Rendering three panels meant either
# three separate requests or waiting for three generations to happen first.
# This is the "don't make the frontend assemble this from four calls" line
# from the prompt, taken literally: one GET, one response, every feature.
router = APIRouter()


def _addon_summary(user_id: str, addon: str, balance: int) -> dict:
    """One add-on's full picture: what the plan includes, what's left of
    it, and what buying more costs — everything a panel needs to decide
    between showing a remaining count and a 'Use N credits' button."""
    quota = get_addon_quota(user_id, addon)
    purchase_limit = purchase_cap_for(quota["tier"], addon)
    purchases_used = _read_purchased_count(user_id, addon) if quota["remaining"] <= 0 else 0
    return {
        "tier": quota["tier"],
        "baseline_limit": quota["limit"],
        "baseline_used": quota["used"],
        "baseline_remaining": quota["remaining"],
        "unlocked": quota["unlocked"],
        "credit_cost": ADDON_CREDIT_COSTS[addon],
        # None = uncapped (LinkedIn Essential, Interview Prep): buy as many
        # as `balance` allows. An integer (Job Search only) is the total
        # this cycle can EVER buy with credits, same number both before and
        # after baseline runs out, so the frontend doesn't have to guess
        # whether "5" means "so far" or "ever".
        "purchase_limit": purchase_limit,
        "purchases_used": purchases_used,
        "purchases_remaining": (
            None if purchase_limit is None else max(0, purchase_limit - purchases_used)
        ),
    }


@router.get("/api/v1/addons/summary", tags=["Entitlements"])
def addon_summary(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Remaining baseline + remaining purchasable + credit balance, for every
    credit-purchasable add-on, in one response. Not tier-gated — a Free
    user needs this too, to see what buying each add-on with credits would
    cost (item 1: "exactly like anyone else").

    Read-only, like get_addon_quota: never raises over a column or table
    that isn't there yet, so a page can render (with zeros) rather than
    break while a migration is mid-rollout.
    """
    balance = credit_balance(user_id)
    return {
        "credit_balance": balance,
        "linkedin_essential": _addon_summary(user_id, LINKEDIN_ESSENTIAL, balance),
        "interview_prep": _addon_summary(user_id, INTERVIEW_PREP, balance),
        "job_search": _addon_summary(user_id, JOB_SEARCH, balance),
    }
