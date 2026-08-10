# core/admin_stats.py
#
# Read-only aggregates behind the admin Analytics, User Management and
# Pipeline Health pages. Every query runs through a SECURITY DEFINER SQL
# function granted to service_role only (see
# supabase/migrations/005_payment_events.sql) — PostgREST can't reach
# auth.users or aggregate across tables the way these need to.
#
# Every route here is gated by get_current_admin_user_id, which checks
# profiles.is_admin server-side on every single request.
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from loguru import logger

from core.auth import get_current_admin_user_id
from core.credits import get_admin_client
from core.entitlements import ADDON_CAPS

router = APIRouter()

# Fixed peg. SAR has been pegged at 3.75/USD since 1986, so this is a
# constant rather than a rate to fetch. Kept here (not in the frontend) so
# every surface converts identically and a display tweak can never disagree
# with what the ledger says.
USD_TO_SAR = 3.75

# ─── PRICING ────────────────────────────────────────────────────────────────
# Source of truth for every revenue figure the admin pages show. Kept
# server-side so the maths happens once rather than being reimplemented per
# page, and denominated in SAR because SAR is what customers are actually
# charged. USD is derived for display only, at the peg above.
#
# Values are from pricing reference v6 §3 and §6. They must stay in step with
# the `sar` fields in frontend/src/lib/language.tsx, which is what a customer
# sees.
#
# THERE IS ONE PRICE PER TIER. Nobody is grandfathered onto a lower one: the
# founding offer is a badge and a 50-seat cap with no discount attached (§3a),
# so every Pro subscriber pays the Pro price. profiles.locked_price is a
# leftover of the old discounted offer; it should be null everywhere now, and
# a non-null value on a live row means someone was priced under a scheme that
# no longer exists.
#
# WORST-CASE COST is the cost of a user who burns their entire allotment on the
# most expensive generations: credits × COST_PER_CREDIT_SAR. It's what makes
# Free a NEGATIVE line, since every free user is an acquisition cost rather
# than income. Derived, not hardcoded per tier, so the two can never disagree.
COST_PER_CREDIT_SAR = 0.75  # $0.20 per credit at the 3.75 peg (reference §1, §7)

TIER_PRICING = {
    "free":  {"label": "Free",  "price_sar": 0.00,  "credits": 3},
    # ONE PRO PRICE. There is no founding price any more: the founding offer
    # is a badge and a 50-seat cap, with no discount attached, so there is no
    # second figure to grandfather and no `founding_price_sar` here.
    "pro":   {"label": "Pro",   "price_sar": 29.00, "credits": 24},
    "elite": {"label": "Elite", "price_sar": 99.00, "credits": 80},
}

PACK_PRICING = {
    "starter":    {"label": "Starter",    "price_sar": 9.00,  "credits": 5},
    "best-value": {"label": "Best Value", "price_sar": 22.00, "credits": 15},
    "power":      {"label": "Power",      "price_sar": 38.00, "credits": 30},
}

# ADD-ONS BUNDLED INTO A SUBSCRIPTION. Neither is sold separately, so neither
# contributes revenue; they exist here only as a COST against the tier that
# includes them, capped at the monthly allowance so the worst case stays a
# real ceiling rather than an unbounded one.
#
# Interview Prep's per-generation figure is an ESTIMATE. It is one large
# Sonnet call over a whole CV and posting, sized from development runs rather
# than from production traffic, and every surface that shows it has to say so.
BUNDLED_ADDON_COSTS_SAR = {
    "linkedin_essential": {"label": "LinkedIn Essential", "cost_sar": 0.15, "estimated": False},
    "interview_prep":     {"label": "Interview Prep",     "cost_sar": 0.85, "estimated": True},
}

# Monthly caps per tier. IMPORTED, not restated: core/entitlements.py is what
# actually enforces them on every generation, and a second copy here is how a
# dashboard ends up reporting a worst case the product no longer has. The
# worst case is a subscriber who uses every one.
BUNDLED_ADDON_CAPS = ADDON_CAPS

# LinkedIn add-on (reference §4). Prices mirror PRICING in core/linkedin.py.
#
# Premium carries NO cost figure on purpose. Its cost is manual time, not
# compute, and both available shortcuts are wrong: assuming zero overstates
# profit, and inventing a labour rate makes the number arbitrary. So premium
# revenue is reported on its own with cost explicitly marked as not tracked,
# and it is excluded from every automatic worst-case total (§7).
LINKEDIN_PRICING = {
    "normal":  {"label": "Essential", "price_sar": 49.00,  "worst_case_cost_sar": 0.15},
    "premium": {"label": "Premium",   "price_sar": 200.00, "worst_case_cost_sar": None},
}


def worst_case_cost_sar(credits: int) -> float:
    """Worst-case AI cost of granting this many credits, in SAR."""
    return round(float(credits or 0) * COST_PER_CREDIT_SAR, 2)


def _margin_pct(revenue: float, cost: float) -> float | None:
    """Profit as a share of revenue. None when there's no revenue to divide
    by, which must render as "not applicable" rather than 0% — a tier nobody
    has bought has no margin, it doesn't have a zero margin."""
    if not revenue:
        return None
    return round((revenue - cost) / revenue * 100, 1)


def _rpc(name: str, params: dict | None = None):
    """
    Calls a SQL function and returns its rows, or None if the call failed.

    None is deliberately distinct from an empty result: it means "this
    number could not be read" (function missing because a migration hasn't
    run, permissions, outage), which the UI must render differently from a
    genuine zero. Showing an unread metric as 0 is how dashboards end up
    lying.
    """
    try:
        return get_admin_client().rpc(name, params or {}).execute().data
    except Exception as e:
        logger.error(f"admin stats RPC '{name}' failed: {e}")
        return None


def _first_row(name: str, params: dict | None = None) -> dict | None:
    rows = _rpc(name, params)
    if rows is None:
        return None
    if isinstance(rows, list):
        return rows[0] if rows else {}
    return rows if isinstance(rows, dict) else {}


def _money(sar) -> dict:
    """
    One amount rendered both ways, converted server-side.

    TAKES SAR NOW, not USD. SAR is the charged currency, so it's the input and
    the primary figure; the dollar value is derived for reference. This used to
    be the other way round, which meant every riyal figure on the admin pages
    was a conversion of a conversion.
    """
    try:
        value = float(sar or 0)
    except (TypeError, ValueError):
        value = 0.0
    return {"sar": round(value, 2), "usd": round(value / USD_TO_SAR, 2)}


def _linkedin_revenue() -> dict:
    """
    Actual LinkedIn add-on revenue, split by tier.

    Unlike the subscription figures, this is money genuinely recorded rather
    than a projection: linkedin_purchases stores price_paid per paid purchase
    (see 008_linkedin_addon.sql), so summing it is a measurement.

    Premium's cost is reported as null, and `cost_tracked: false` says why in a
    way the UI can act on. Never 0 — a zero would quietly turn manual labour
    into pure profit on the dashboard.
    """
    empty = {
        "essential": {
            "label": LINKEDIN_PRICING["normal"]["label"],
            "sold": 0, "revenue": _money(0), "worst_case_cost": _money(0),
            "worst_case_profit": _money(0), "worst_case_margin_pct": None,
            "cost_tracked": True,
        },
        "premium": {
            "label": LINKEDIN_PRICING["premium"]["label"],
            "sold": 0, "revenue": _money(0), "worst_case_cost": None,
            "worst_case_profit": None, "worst_case_margin_pct": None,
            "cost_tracked": False,
        },
        "available": False,
    }

    try:
        rows = (
            get_admin_client()
            .table("linkedin_purchases")
            .select("tier, price_paid")
            .eq("payment_status", "paid")
            .execute()
            .data
            or []
        )
    except Exception as e:
        # The add-on's tables may not exist on this environment yet. That's a
        # missing figure, not a zero, so `available` stays false and the UI
        # renders it as unread rather than as "no sales".
        logger.warning(f"LinkedIn revenue could not be read: {e}")
        return empty

    result = empty
    result["available"] = True

    essential_sold = sum(1 for r in rows if r.get("tier") == "normal")
    premium_sold = sum(1 for r in rows if r.get("tier") == "premium")
    essential_revenue = sum(float(r.get("price_paid") or 0) for r in rows if r.get("tier") == "normal")
    premium_revenue = sum(float(r.get("price_paid") or 0) for r in rows if r.get("tier") == "premium")
    essential_cost = round(essential_sold * float(LINKEDIN_PRICING["normal"]["worst_case_cost_sar"]), 2)

    result["essential"].update({
        "sold": essential_sold,
        "revenue": _money(essential_revenue),
        "worst_case_cost": _money(essential_cost),
        "worst_case_profit": _money(essential_revenue - essential_cost),
        "worst_case_margin_pct": _margin_pct(essential_revenue, essential_cost),
    })
    result["premium"].update({
        "sold": premium_sold,
        "revenue": _money(premium_revenue),
    })
    return result


def _money_from_usd(usd) -> dict:
    """For figures that genuinely arrive in USD, i.e. the payment_events ledger
    rows written before SAR became the unit. Converts, then hands back the same
    shape as _money."""
    try:
        value = float(usd or 0)
    except (TypeError, ValueError):
        value = 0.0
    return _money(value * USD_TO_SAR)


@router.get("/api/v1/admin/analytics", tags=["Admin"])
def get_analytics(admin_user_id: str = Depends(get_current_admin_user_id)) -> dict:
    """
    Everything the Analytics page shows, in one round trip.

    `payments_wired` is the important field: it's False until the first
    payment_events row exists, and the UI uses it to label revenue and
    pack/subscription-history tiles as awaiting the payment integration
    instead of presenting a real-looking $0.00. Those figures aren't
    missing because the page is unfinished — until Moyasar writes to
    payment_events there is genuinely no data to derive them from.
    """
    platform = _first_row("admin_platform_stats") or {}
    tiers = _rpc("admin_tier_counts") or []
    payments = _first_row("admin_payment_stats") or {}
    by_product = _rpc("admin_payment_by_product") or []

    total_payment_events = int(payments.get("total_events") or 0)

    # ── Estimated monthly revenue per tier ──────────────────────────────
    #
    # This is a PROJECTION from who is currently subscribed at what price,
    # not a measurement of money received — that needs payment_events. It's
    # still worth showing because it's the one revenue figure that IS
    # knowable today, and it's the number that actually matters
    # operationally (current MRR).
    #
    # Free is deliberately negative: those users generate cost, not income.
    tier_rows = []
    estimated_mrr = 0.0
    # Running worst-case totals across the paid tiers. Free is deliberately
    # excluded from the revenue side (it has none) but its cost is real, so it
    # lands in total_cost — that's what makes the total honest rather than
    # flattering.
    total_revenue = 0.0
    total_cost = 0.0

    for row in tiers:
        slug = row.get("tier") or "free"
        pricing = TIER_PRICING.get(slug, {})
        current = int(row.get("current_count") or 0)
        active = int(row.get("active_count") or 0)
        # locked_price_total / locked_price_count are still returned by
        # admin_tier_counts, but nothing prices off them any more. See the
        # bug-fix note in the revenue branch below.
        credits = int(pricing.get("credits") or 0)
        unit_cost = worst_case_cost_sar(credits)

        if slug == "free":
            # Cost of serving the free tier, shown as negative revenue.
            monthly = -(current * unit_cost)
            cost = current * unit_cost
            revenue = 0.0
        else:
            # EVERY ACTIVE SUBSCRIBER PAYS THE TIER PRICE. There is no
            # grandfathered rate any more (reference v6 §3a: the founding offer
            # is a badge only), so revenue is simply headcount × list.
            #
            # BUG FIX, the stale price in this panel: this used to read
            # `locked_total + list_payers × price`, summing profiles.locked_price
            # for anyone who still had one. Those values are leftovers of the
            # discounted founding offer that was removed, so the panel kept
            # pricing those subscribers at a figure the product no longer
            # charges (the 10.99 USD / ~41 SAR founding-era Pro price, which
            # surfaced on whichever tier the affected rows sat on). Reading a
            # dead column made the dashboard disagree with what customers are
            # actually billed, which is the one thing this page must not do.
            revenue = active * float(pricing.get("price_sar", 0))
            monthly = revenue
            # Cost follows ACTIVE subscribers, not everyone sitting on the
            # tier: a lapsed subscriber gets no allotment, so they cost nothing.
            cost = active * unit_cost

        estimated_mrr += monthly
        total_revenue += revenue
        total_cost += cost

        tier_rows.append({
            "tier": slug,
            "label": pricing.get("label", slug.title()),
            "current_count": current,
            "active_count": active,
            "founding_count": row.get("founding_count") or 0,
            "price_sar": pricing.get("price_sar"),
            "credits": credits,
            "estimated_monthly": _money(monthly),
            # ── Worst case, per §7 of the pricing reference ──
            "worst_case_cost": _money(cost),
            "worst_case_profit": _money(revenue - cost),
            "worst_case_margin_pct": _margin_pct(revenue, cost),
            "unit_worst_case_cost": _money(unit_cost),
            # Free's figure is a cost, so the UI renders it differently.
            "is_cost": slug == "free",
        })

    # ── Packs ───────────────────────────────────────────────────────────
    # Sales counts and revenue need payment_events; the catalogue (price,
    # credits) is known now, so the table renders in full with the sold
    # columns pending rather than the whole panel being empty.
    sold_by_slug = {
        r.get("product_slug"): r
        for r in by_product
        if r.get("kind") == "pack"
    }
    pack_rows = []
    packs_revenue_all = 0.0
    packs_revenue_month = 0.0
    for slug, pricing in PACK_PRICING.items():
        sold = sold_by_slug.get(slug, {})
        ever = int(sold.get("count_ever") or 0)
        month = int(sold.get("count_month") or 0)
        # payment_events records revenue in USD; convert to SAR to keep one unit
        # across the whole response.
        revenue = float(sold.get("revenue_usd") or 0) * USD_TO_SAR
        unit_cost = worst_case_cost_sar(pricing["credits"])
        cost = ever * unit_cost

        packs_revenue_all += revenue
        # Per-pack monthly revenue isn't returned separately, so derive it from
        # this month's unit count at list price.
        packs_revenue_month += month * float(pricing["price_sar"])
        total_revenue += revenue
        total_cost += cost

        pack_rows.append({
            "slug": slug,
            "label": pricing["label"],
            "price_sar": pricing["price_sar"],
            "credits": pricing["credits"],
            "sold_ever": ever,
            "sold_this_month": month,
            "revenue": _money(revenue),
            "worst_case_cost": _money(cost),
            "worst_case_profit": _money(revenue - cost),
            "worst_case_margin_pct": _margin_pct(revenue, cost),
            "unit_worst_case_cost": _money(unit_cost),
        })

    # ── LinkedIn add-on (§7) ──
    # Read from linkedin_purchases directly rather than payment_events, because
    # that table is ours and already records what was actually paid. This is
    # therefore REAL revenue, not a projection like the tier figures above.
    linkedin = _linkedin_revenue()
    total_revenue += linkedin["essential"]["revenue"]["sar"]
    total_cost += linkedin["essential"]["worst_case_cost"]["sar"]
    # Premium is deliberately NOT added to total_cost: its cost is manual time,
    # and both alternatives (assume zero, or invent a rate) would lie. Its
    # revenue is also kept out of the worst-case total so profit and cost stay
    # comparable; it's reported on its own instead.

    now = datetime.now(timezone.utc)

    return {
        "generated_at": now.isoformat(),
        # Named explicitly so the page can print "August 2026: X signups"
        # without the browser's timezone shifting which month it thinks it is.
        "current_month_label": now.strftime("%B %Y"),
        "usd_to_sar": USD_TO_SAR,

        "signups": {
            "total": platform.get("signups_total"),
            "this_month": platform.get("signups_month"),
        },
        "generations": {
            "total": platform.get("cvs_total"),
            "this_month": platform.get("cvs_month"),
            "arabic_total": platform.get("cvs_ar_total"),
            "english_total": platform.get("cvs_en_total"),
            "arabic_this_month": platform.get("cvs_ar_month"),
            "english_this_month": platform.get("cvs_en_month"),
            "failed_total": platform.get("cvs_failed_total"),
        },
        "founding_members": platform.get("founding_members"),

        # current_count / active_count are derivable from profiles today.
        # ever_count and month_count come from payment_events and stay 0
        # until it's populated — profiles.tier is a snapshot, so a user who
        # subscribed and cancelled is indistinguishable from one who never
        # did.
        "tiers": tier_rows,
        "packs_catalogue": pack_rows,

        # ── WORST-CASE PROFIT (pricing reference §7) ──
        # Revenue minus worst-case AI cost, where worst case means every credit
        # granted is burned on the most expensive generation. Per tier and per
        # pack above; this is the running total.
        #
        # Free's cost IS included while its revenue is zero, so the total shows
        # the real position rather than a flattering one. LinkedIn Premium is
        # excluded entirely (no fixed cost to compute) and reported on its own
        # under `linkedin`.
        "worst_case": {
            "revenue": _money(total_revenue),
            "cost": _money(total_cost),
            "profit": _money(total_revenue - total_cost),
            "margin_pct": _margin_pct(total_revenue, total_cost),
            "cost_per_credit": _money(COST_PER_CREDIT_SAR),
            "excludes": ["linkedin_premium"],
        },
        "linkedin": linkedin,
        # Projected from who is subscribed right now at their actual price.
        # Distinct from `revenue`, which is money actually recorded.
        "estimated_mrr": _money(estimated_mrr),
        "packs_revenue": {
            "all_time": _money(packs_revenue_all),
            "this_month": _money(packs_revenue_month),
        },
        "subscription_revenue": {
            # All-time needs the ledger; monthly is the MRR projection.
            "this_month_estimated": _money(estimated_mrr),
        },

        "payments_wired": total_payment_events > 0,
        "revenue": {
            # The ledger stores USD, so these two convert rather than being
            # taken as riyals. See _money_from_usd.
            "all_time": _money_from_usd(payments.get("revenue_all_time_usd")),
            "this_month": _money_from_usd(payments.get("revenue_this_month_usd")),
        },
        "subscriptions": {
            "ever": payments.get("subs_ever") or 0,
            "this_month": payments.get("subs_this_month") or 0,
        },
        "packs": {
            "ever": payments.get("packs_ever") or 0,
            "this_month": payments.get("packs_this_month") or 0,
        },
        "by_product": [
            {
                "kind": row.get("kind"),
                "product_slug": row.get("product_slug"),
                "count_ever": row.get("count_ever"),
                "count_month": row.get("count_month"),
                "revenue": _money_from_usd(row.get("revenue_usd")),
            }
            for row in by_product
        ],
    }


@router.get("/api/v1/admin/pipeline-health", tags=["Admin"])
def get_pipeline_health(
    days: int = Query(30, ge=1, le=365),
    admin_user_id: str = Depends(get_current_admin_user_id),
) -> dict:
    """
    Run outcomes over a trailing window.

    Every field here has been recorded on every generation for a while and
    surfaced nowhere — diagnosing a failure has meant reading raw Render
    logs by hand. Success rate, the actual failure messages, how often
    Arabic localization is still leaving Latin text behind, and how many
    users are landing on the legacy name path are all one query away.
    """
    health = _first_row("admin_pipeline_health", {"days": days}) or {}
    errors = _rpc("admin_top_errors", {"days": days, "limit_n": 10}) or []

    runs = int(health.get("runs") or 0)
    succeeded = int(health.get("succeeded") or 0)
    arabic_runs = int(health.get("arabic_runs") or 0)

    def _pct(part: int, whole: int) -> float | None:
        return round(part / whole * 100, 1) if whole else None

    return {
        "window_days": days,
        "runs": runs,
        "succeeded": succeeded,
        "failed": health.get("failed") or 0,
        "success_rate": _pct(succeeded, runs),
        "hit_max_retries": health.get("hit_max_retries") or 0,
        "avg_tailoring_attempts": float(health.get("avg_tailoring_attempts") or 0),
        "arabic": {
            "runs": arabic_runs,
            "purity_pass_fired": health.get("arabic_purity_fired") or 0,
            "still_latin_after_pass": health.get("arabic_purity_bad") or 0,
            # Of the Arabic runs that needed a localization pass, how many
            # still had Latin text left afterwards. This is the direct
            # quality signal for the glossary localizer.
            "still_latin_rate": _pct(
                int(health.get("arabic_purity_bad") or 0),
                int(health.get("arabic_purity_fired") or 0),
            ),
        },
        "name_fallback_used": health.get("name_fallback_used") or 0,
        "tokens": {
            "input": health.get("input_tokens") or 0,
            "output": health.get("output_tokens") or 0,
            "calls": health.get("total_calls") or 0,
        },
        "top_errors": [
            {
                "message": row.get("error_message"),
                "count": row.get("occurrences"),
                "last_seen": row.get("last_seen"),
            }
            for row in errors
        ],
    }


@router.get("/api/v1/admin/users", tags=["Admin"])
def lookup_users(
    q: str | None = Query(None, description="Email, name (either script), or auth user id."),
    limit: int = Query(25, ge=1, le=100),
    admin_user_id: str = Depends(get_current_admin_user_id),
) -> dict:
    """
    Account support lookup: everything needed to answer "what's going on
    with this user's account" without opening Supabase.

    Reuses admin_search_users (the same resolver the Resume Viewer search
    uses) so both pages accept the same inputs, then joins on the profile,
    their generation count and their payment total.
    """
    admin = get_admin_client()
    term = (q or "").strip()

    try:
        if term:
            matches = admin.rpc("admin_search_users", {"term": term}).execute().data or []
        else:
            # No search term: most recent signups, so the page is useful on
            # first load instead of empty.
            matches = admin.rpc("admin_search_users", {"term": ""}).execute().data or []
    except Exception as e:
        logger.error(f"admin user search failed for '{term}': {e}")
        matches = []

    matches = matches[:limit]
    user_ids = [m["id"] for m in matches if m.get("id")]
    if not user_ids:
        return {"users": [], "count": 0}

    profiles_by_id: dict[str, dict] = {}
    try:
        rows = (
            admin.table("profiles")
            .select(
                "id, tier, credits_remaining, credits_total, credits_reset_at, "
                "subscription_status, tier_expires_at, pending_tier, is_founding_member, "
                "founding_member_number, locked_price, location, is_admin, is_owner, created_at"
            )
            .in_("id", user_ids)
            .execute()
            .data
            or []
        )
        profiles_by_id = {r["id"]: r for r in rows}
    except Exception as e:
        logger.error(f"admin profile fetch failed: {e}")

    cv_by_id = {r["user_id"]: r for r in (_rpc("admin_cv_counts_by_users", {"ids": user_ids}) or [])}
    paid_by_id = {r["user_id"]: r for r in (_rpc("admin_paid_by_users", {"ids": user_ids}) or [])}

    users = []
    for match in matches:
        uid = match.get("id")
        profile = profiles_by_id.get(uid, {})
        cv = cv_by_id.get(uid, {})
        paid = paid_by_id.get(uid, {})
        users.append({
            "id": uid,
            "email": match.get("email"),
            "name_en": match.get("name_en"),
            "name_ar": match.get("name_ar"),
            "tier": profile.get("tier"),
            "pending_tier": profile.get("pending_tier"),
            "subscription_status": profile.get("subscription_status"),
            "tier_expires_at": profile.get("tier_expires_at"),
            "credits_remaining": profile.get("credits_remaining"),
            "credits_total": profile.get("credits_total"),
            "credits_reset_at": profile.get("credits_reset_at"),
            "is_founding_member": profile.get("is_founding_member"),
            "founding_member_number": profile.get("founding_member_number"),
            "locked_price": profile.get("locked_price"),
            "location": profile.get("location"),
            "is_admin": profile.get("is_admin"),
            "is_owner": profile.get("is_owner"),
            "signed_up_at": profile.get("created_at"),
            # Combined across languages on purpose — the split lives on the
            # Analytics page; support just needs "how much have they used it".
            "cv_count": cv.get("cv_count") or 0,
            "last_generated_at": cv.get("last_generated"),
            "total_paid": _money(paid.get("total_paid_usd")),
            "payment_count": paid.get("payment_count") or 0,
        })

    return {"users": users, "count": len(users), "usd_to_sar": USD_TO_SAR}
