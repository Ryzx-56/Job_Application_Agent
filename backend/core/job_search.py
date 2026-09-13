# core/job_search.py
#
# The standalone Job Search page (Pro and Elite).
#
# Nothing here touches the CV pipeline. It takes a job title, optionally a
# location and an internships flag, and returns listings — no CV, no job
# description, no credits, no LangGraph. The actual searching is
# agents/jobs_finder.py's search_jobs_by_title, which runs the same four
# search lanes, legitimacy filter, model screen and liveness check the
# similar-jobs feature uses; see that function's header for why this reuses
# that pipeline rather than adding a simpler second one.
#
# GATING (rewritten 2026-09-12 — see below): NOT tier-gated any more. Every
# route here uses get_current_user_id, because a Free user (or a pack buyer)
# can now buy a search with credits exactly like anyone else — see
# core/entitlements.py's removal of the pack-buyer tier promotion (credit-
# addons prompt item 1) and begin_addon_use() (item 2). The Pro/Elite
# BASELINE still only applies on Pro/Elite; what changed is that reaching
# the endpoint at all no longer requires a subscription, since a plain
# credit purchase is now always an option once the baseline (zero, for
# anyone without one) runs out.
#
# METERED, UNIFIED WITH THE PER-CV BUTTON (2026-09-12, credit-addons prompt
# item 4). ADDON_CAPS[JOB_SEARCH] in core/entitlements.py is ONE shared
# monthly pool: this endpoint and core/documents.py's find_jobs_for_resume
# both draw on the same `job_search_used` counter, through the same
# begin_addon_use()/release_addon_use() functions. Baseline first, then
# credits (capped at the same number as the baseline — see
# PURCHASE_CAPPED_ADDONS), spent through the exact same call either entry
# point uses.
#
# HISTORY AND CACHING (2026-09-12). See
# supabase/migrations/20260912100000_job_search_history_cache.sql for the
# full design note. In short: job_search_cache is SHARED across every user
# (a product decision, not the default a per-user cache would have been) and
# keyed only by the normalized query; job_search_history is per-user, a
# lightweight pointer back at a cache row plus what THIS user actually typed
# and when. A cache hit costs nothing and fires no Tavily request; Refresh
# (payload.refresh=True) is the only path that runs a live search against an
# existing cache entry, and the frontend must get an explicit confirmation
# from the user before ever sending it — this endpoint does not ask twice.
import hashlib
import re
from datetime import datetime, timedelta, timezone

from core.rate_limit import enforce, JOB_SEARCH
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from pydantic import BaseModel, Field

from core.auth import PAID_TIERS, get_current_user_id, read_subscription_tier
from core.credits import get_admin_client, maybe_row
from core import search_provider
from core.entitlements import JOB_SEARCH as JOB_SEARCH_ADDON, begin_addon_use, release_addon_use
from agents.jobs_finder import (
    SearchQuotaExhausted,
    SearchUnavailable,
    _fetch_profile_location,
    assert_search_affordable,
    search_jobs_by_title,
)

router = APIRouter()

# Long enough for "Senior Business Intelligence Developer", short enough that
# nobody pastes a job description into it — which would send a wall of text
# to Tavily as a search query.
_MAX_TITLE_CHARS = 80
_MAX_LOCATION_CHARS = 60

# How long a cached result set is served as a cache hit. Past this, the row
# still exists (nothing deletes it) but a plain search request falls through
# to a live search, and a history reopen shows it with a staleness marker
# and a Refresh button instead of serving it silently.
CACHE_TTL_HOURS = 48

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _require_uuid(value: str, label: str) -> str:
    if not value or not _UUID_RE.match(str(value).strip()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found.")
    return str(value).strip()


def _normalize_job_search_key(title: str, location: str, internships: bool) -> str:
    """
    Deterministic cache identity for one search: lowercased,
    whitespace-collapsed title and location, plus internships — the only
    filter this page has today ("sorted filter values" in the original spec
    reduces to this one boolean; add more terms here if the page grows real
    filters later, in a stable sort order so key order never matters).

    NO USER ID. Two users searching the same normalized query share one
    cache entry — the 2026-09-12 decision to make this cache shared rather
    than per-user, which is where the real credit savings come from.
    """
    def _norm(value: str) -> str:
        return re.sub(r"\s+", " ", (value or "").strip().lower())

    material = f"{_norm(title)}|{_norm(location)}|internships={bool(internships)}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _parse_timestamp(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _cache_is_fresh(row: dict) -> bool:
    fetched_at = _parse_timestamp(row.get("fetched_at"))
    if fetched_at is None:
        # Can't tell how old it is — treat as stale rather than serving an
        # answer we can't actually vouch for the age of.
        return False
    return datetime.now(timezone.utc) - fetched_at < timedelta(hours=CACHE_TTL_HOURS)


def _get_cached_search(cache_key: str) -> dict | None:
    """
    The cached row, or None.

    None covers BOTH "no such entry" and "could not read the cache" — a
    caller here always falls through to a live search either way, so
    collapsing those two isn't the CLAUDE.md defect (nothing downstream acts
    on None as though it meant a specific one of those two things; it just
    means "don't serve a cache hit"). What must NOT happen is a read failure
    being reported as `is_stale` or any other specific, wrong verdict about
    a row that was never actually read.
    """
    try:
        return maybe_row(
            get_admin_client()
            .table("job_search_cache")
            .select("cache_key, results, fetched_at, tavily_credits_used")
            .eq("cache_key", cache_key)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        logger.warning(f"🧭 Could not read job search cache ({cache_key[:12]}…): {e}")
        return None


def _store_search_in_cache(cache_key: str, title: str, location: str, internships: bool,
                            results: dict, credits_used: int) -> None:
    """Upserts the shared cache row. Never raises: the user already has
    their results, and failing the request now would be worse than losing
    the cache for next time (documents.py's similar_jobs write follows the
    same rule)."""
    try:
        get_admin_client().table("job_search_cache").upsert({
            "cache_key": cache_key,
            "job_title": title,
            "location": location,
            "internships": bool(internships),
            "results": results,
            # Depth is per-lane, not one global knob — see
            # PRIORITY_LANE_SEARCH_DEPTH in agents/jobs_finder.py.
            "depth_used": {"default": "thorough", "priority_lane": "fast"},
            "tavily_credits_used": credits_used,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        logger.error(f"Could not store job search cache ({cache_key[:12]}…): {e}")


def _record_cache_hit(cache_key: str) -> None:
    """Never raises: a missed hit-count increment loses a data point for the
    admin dashboard, not the user's results."""
    try:
        get_admin_client().rpc(
            "increment_job_search_cache_hit", {"p_cache_key": cache_key}
        ).execute()
    except Exception as e:
        logger.warning(f"Could not record a job search cache hit ({cache_key[:12]}…): {e}")


def _record_search_history(user_id: str, cache_key: str, raw_query: str,
                            location: str, internships: bool) -> None:
    """Never raises: history is a convenience list, not the search result
    itself. Prunes on write, per the retention rule in
    prune_job_search_history (last 20 or 30 days, whichever is larger)."""
    try:
        get_admin_client().table("job_search_history").insert({
            "user_id": user_id,
            "cache_key": cache_key,
            "raw_query": raw_query,
            "location": location,
            "internships": bool(internships),
        }).execute()
        get_admin_client().rpc("prune_job_search_history", {"p_user_id": user_id}).execute()
    except Exception as e:
        logger.error(f"Could not record job search history for {user_id}: {e}")


def _results_payload(results: dict) -> dict:
    """The three list fields, defensively defaulted — a cache row from
    before a schema change, or a partially-written one, must not 500 the
    page over a missing key."""
    results = results or {}
    return {
        "exact": results.get("exact") or [],
        "related": results.get("related") or [],
        "related_titles": results.get("related_titles") or [],
    }


class JobSearchRequest(BaseModel):
    job_title: str = Field(..., description="The role to search for. A title, not a description.")
    internships: bool = Field(False, description="Search internships/trainee programmes instead of jobs.")
    # Optional override. Left empty, the user's saved profile location is
    # used, which is where signup and Settings already store it.
    location: str | None = Field(None, description="Optional location override.")
    # The ONLY path that re-runs a live search against a query already in
    # the cache. The frontend must get an explicit confirmation from the
    # user before ever sending refresh=True — never on page load, focus, or
    # navigation. A plain (refresh=False) request for a query whose cache
    # entry is still fresh always gets served from cache; a stale one falls
    # through to a live search on its own (see job_search()'s docstring).
    refresh: bool = Field(False, description="Force a live re-search, bypassing a fresh cache entry.")
    # Confirms spending credits once the shared Job Search baseline (this
    # page + the per-CV find-jobs button) is exhausted. Without it, an
    # exhausted-baseline request gets a 402 naming the price and the
    # caller's credit balance rather than spending anything — see
    # entitlements.begin_addon_use. Irrelevant on a cache hit, which never
    # reaches begin_addon_use at all.
    spend_credits: bool = Field(False, description="Confirms spending credits once the baseline is exhausted.")


@router.get("/api/v1/job-search/overview", tags=["Job Search"])
def job_search_overview(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    What the page needs before it renders: whether this account is unlocked,
    and the location the search will default to.

    Deliberately NOT tier-gated — see this module's header.
    """
    tier = read_subscription_tier(user_id)
    return {
        "tier": tier,
        "unlocked": tier in PAID_TIERS,
        "default_location": _fetch_profile_location(user_id) or "",
    }


@router.get("/api/v1/job-search/history", tags=["Job Search"])
def job_search_history_list(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    This user's past standalone searches, newest first. Reading the list
    costs nothing — it's a history of past lookups, not a search.

    Raises rather than returning {"history": []} on a read failure: an empty
    list here is a legitimate, different state ("you haven't searched
    anything yet") from "we couldn't load your history", and the frontend
    must be able to tell them apart.
    """
    try:
        rows = (
            get_admin_client()
            .table("job_search_history")
            .select("id, cache_key, raw_query, location, internships, searched_at")
            .eq("user_id", user_id)
            .order("searched_at", desc=True)
            .execute()
            .data
        )
    except Exception as e:
        logger.error(f"Could not read job search history for {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "history_unavailable",
                "message": "Could not load your search history right now. Nothing was charged.",
            },
        )
    return {"history": rows or []}


@router.get("/api/v1/job-search/history/{history_id}", tags=["Job Search"])
def job_search_reopen(history_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Reopens one past search's results. ALWAYS free, regardless of age — a
    result set past the cache TTL is returned with `is_stale: true` rather
    than hidden or silently re-fetched. Refresh (POST /api/v1/job-search
    with refresh=True) is the only paid path, and it is a separate,
    explicit action the frontend must confirm before sending.
    """
    row = maybe_row(
        get_admin_client()
        .table("job_search_history")
        .select("id, user_id, cache_key, raw_query, location, internships, searched_at")
        .eq("id", _require_uuid(history_id, "Search"))
        .maybe_single()
        .execute()
    )
    if not row or row.get("user_id") != user_id:
        # 404 rather than 403 for someone else's id — same convention as
        # core/documents.py and core/linkedin.py.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Search not found.")

    cached = _get_cached_search(row["cache_key"])
    if not cached:
        # The underlying cache row is gone or unreadable. Nothing deletes a
        # cache row today, so in practice this means "could not read it
        # right now" — told honestly rather than silently returning empty
        # results that would look like a search that found nothing.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "cache_unavailable",
                "message": "These results could not be loaded right now. Try again, or run the search again.",
            },
        )

    return {
        "job_title": row["raw_query"],
        "internships": bool(row.get("internships")),
        "location": row.get("location") or "",
        **_results_payload(cached.get("results")),
        "from_cache": True,
        "cached_at": cached.get("fetched_at"),
        "searched_at": row.get("searched_at"),
        "is_stale": not _cache_is_fresh(cached),
    }


@router.post("/api/v1/job-search", tags=["Job Search"])
def job_search(
    payload: JobSearchRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Searches for live listings matching a job title, then adjacent roles —
    or serves them from the shared cache when a fresh entry already exists.

    Returns exact matches and related matches as SEPARATE lists so the page
    can label the second group honestly rather than implying every result
    matched what was typed.
    """
    # A per-hour REQUEST-VOLUME ceiling, unrelated to cost — it protects our
    # own servers, not Tavily's quota, so it applies to cache hits too (a
    # cache hit is still a request). The actual cost ceiling is
    # begin_addon_use() below, reached only on a live search.
    enforce(JOB_SEARCH, user_id)

    title = (payload.job_title or "").strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "missing_title", "message": "Enter a job title to search for."},
        )
    if len(title) > _MAX_TITLE_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "title_too_long",
                "message": "That looks like a job description. Enter just the job title.",
            },
        )

    location = (payload.location or "").strip()[:_MAX_LOCATION_CHARS]
    if not location:
        location = _fetch_profile_location(user_id) or ""

    internships = bool(payload.internships)
    cache_key = _normalize_job_search_key(title, location, internships)

    if not payload.refresh:
        cached = _get_cached_search(cache_key)
        if cached and _cache_is_fresh(cached):
            logger.info(
                f"🧭 Job search cache HIT for {user_id}: '{title}' "
                f"(cached {cached.get('fetched_at')}, {cached.get('tavily_credits_used') or 0} "
                "Tavily credits avoided)"
            )
            # ALREADY PAID FOR, by whoever fetched it first — possibly a
            # different user. Zero Tavily credits, zero allowance, zero
            # user credits, no Tavily request at all: the /usage pre-flight
            # below never runs on this path.
            _record_cache_hit(cache_key)
            _record_search_history(user_id, cache_key, title, location, internships)
            return {
                "job_title": title,
                "internships": internships,
                "location": location,
                **_results_payload(cached.get("results")),
                "from_cache": True,
                "cached_at": cached.get("fetched_at"),
            }
        # No entry, or one past the 48h TTL: falls through to a live search
        # below. This is a plain search request for this query, not a
        # Refresh — the doc is explicit that this endpoint never silently
        # re-fetches on the user's behalf, but a user typing the same title
        # into the search box again (not reopening history) IS a genuine
        # new request they made, so it may proceed. Reopening a stale
        # HISTORY entry (the /history/{id} route above) never reaches this
        # function at all, and never fetches live on its own.

    cache_reason = "refresh" if payload.refresh else "miss"
    logger.info(
        f"🧭 Job search cache {cache_reason.upper()} for {user_id}: '{title}' "
        f"({'internships' if internships else 'jobs'}, location: {location or 'any'})"
    )

    # THE PRE-FLIGHT RUNS BEFORE ANYTHING IS CLAIMED (2026-09-12, credit-
    # addons prompt item 9) — not just before the search itself. Checked
    # here, ahead of begin_addon_use, so a quota/config failure costs
    # nothing at all rather than costing a baseline slot or credits that
    # then have to be refunded. search_jobs_by_title re-checks this
    # internally too (cheap, redundant, correct defence-in-depth).
    try:
        assert_search_affordable("standalone job search")
    except SearchQuotaExhausted as e:
        logger.error(f"🚫 Job search unavailable (search quota) for '{title}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "search_quota_exhausted",
                "message": (
                    "Job search is unavailable for the rest of this month while we "
                    "top up our search provider. Nothing was charged. Your saved "
                    "CVs and every other feature are unaffected."
                ),
            },
        )
    except SearchUnavailable as e:
        logger.error(f"🚫 Job search unavailable (provider) for '{title}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "search_failed",
                "message": "Job search is temporarily unavailable. Please try again shortly.",
            },
        )

    # Priced/refused after the pre-flight, before the search — a cache hit
    # never reaches this line at all, so it stays free exactly as documented
    # above. May raise 402 (confirmation needed, or not enough credits) or
    # 429 (the purchase cap is spent) — unified with the per-CV find-jobs
    # button's pool (core/documents.py), same function, same counter.
    payment = begin_addon_use(user_id, JOB_SEARCH_ADDON, confirmed_purchase=payload.spend_credits)

    try:
        with search_provider.search_call_counter() as counter:
            results = search_jobs_by_title(title, location=location, internships=internships)
    except SearchQuotaExhausted as e:
        # NOT "no jobs found". The search provider is out of credits for the
        # month, and returning an empty list here would tell a paying
        # subscriber there are no jobs for their title — which is a lie, and
        # the most damaging possible reading of this failure. Its own code so
        # the page can say something true. The slot/credits go back: they
        # asked for a search and got nothing, and the reason was ours.
        release_addon_use(user_id, payment)
        logger.error(f"🚫 Job search unavailable (search quota) for '{title}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "search_quota_exhausted",
                "message": (
                    "Job search is unavailable for the rest of this month while we "
                    "top up our search provider. Nothing was charged. Your saved "
                    "CVs and every other feature are unaffected."
                ),
            },
        )
    except Exception as e:
        release_addon_use(user_id, payment)
        logger.error(f"❌ Job search failed for '{title}': {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "search_failed",
                "message": "Job search is temporarily unavailable. Please try again shortly.",
            },
        )

    _store_search_in_cache(cache_key, title, location, internships, results, counter["units"])
    _record_search_history(user_id, cache_key, title, location, internships)

    return {
        "job_title": title,
        "internships": internships,
        "location": location,
        "exact": results["exact"],
        "related": results["related"],
        "related_titles": results["related_titles"],
        "from_cache": False,
        "paid_with": payment["source"],
    }
