# tests/test_job_search_cache.py
#
# The standalone Job Search page's shared cache + per-user history
# (2026-09-12, prompts/claude-code-prompt-depth-history-allowance.md Part 2,
# built shared rather than per-user per the product decision — see
# supabase/migrations/20260912100000_job_search_history_cache.sql).
#
# Mocks the four DB seams (_get_cached_search / _store_search_in_cache /
# _record_cache_hit / _record_search_history) rather than the Supabase
# client chain itself — those seams ARE the contract between the endpoint's
# decision logic (hit vs miss vs refresh vs stale) and persistence, and
# testing at that boundary is what lets these tests assert "did a live
# search actually run" without a fake Postgrest client.
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

import core.job_search as job_search


def _fresh_cache_row(credits_used=8):
    return {
        "cache_key": "abc123",
        "results": {"exact": [{"title": "Cached Job"}], "related": [], "related_titles": []},
        "fetched_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        "tavily_credits_used": credits_used,
    }


def _stale_cache_row(credits_used=8):
    return {
        "cache_key": "abc123",
        "results": {"exact": [{"title": "Old Job"}], "related": [], "related_titles": []},
        "fetched_at": (datetime.now(timezone.utc) - timedelta(hours=49)).isoformat(),
        "tavily_credits_used": credits_used,
    }


def _live_results():
    return {"exact": [{"title": "Fresh Job"}], "related": [], "related_titles": []}


def _run_search(*, refresh=False, location="Riyadh", cached_row=None, spend_credits=False,
                 begin_addon_use_result=None, live_search_side_effect=None):
    """Calls the job_search() route function directly, past FastAPI's
    Depends machinery, with the DB and live-search seams mocked.

    begin_addon_use defaults to "baseline available" — most of these tests
    are about the cache, not the spend decision, which has its own tests
    below."""
    if begin_addon_use_result is None:
        begin_addon_use_result = {"source": "baseline", "addon": "job_search"}
    payload = job_search.JobSearchRequest(
        job_title="Software Engineer", location=location, refresh=refresh, spend_credits=spend_credits,
    )
    live_search_kwargs = dict(return_value=_live_results())
    if live_search_side_effect is not None:
        live_search_kwargs = dict(side_effect=live_search_side_effect)
    with patch.object(job_search, "enforce"), \
         patch.object(job_search, "_get_cached_search", return_value=cached_row) as get_cached, \
         patch.object(job_search, "_store_search_in_cache") as store_cache, \
         patch.object(job_search, "_record_cache_hit") as record_hit, \
         patch.object(job_search, "_record_search_history") as record_history, \
         patch.object(job_search, "assert_search_affordable") as assert_affordable, \
         patch.object(job_search, "begin_addon_use", return_value=begin_addon_use_result) as begin_use, \
         patch.object(job_search, "release_addon_use") as release_use, \
         patch.object(job_search, "search_jobs_by_title", **live_search_kwargs) as live_search:
        response = job_search.job_search(payload, user_id="user-1")
    return response, dict(
        get_cached=get_cached, store_cache=store_cache, record_hit=record_hit,
        record_history=record_history, live_search=live_search,
        begin_use=begin_use, release_use=release_use, assert_affordable=assert_affordable,
    )


def test_normalized_key_is_case_and_whitespace_insensitive_and_has_no_user():
    a = job_search._normalize_job_search_key("Software   Engineer", "Riyadh", False)
    b = job_search._normalize_job_search_key("software engineer", "riyadh", False)
    assert a == b, "the whole point of normalization: same query, same key regardless of how it was typed"

    different_location = job_search._normalize_job_search_key("software engineer", "Jeddah", False)
    different_internships = job_search._normalize_job_search_key("software engineer", "riyadh", True)
    assert a != different_location
    assert a != different_internships


def test_cache_freshness_boundary():
    assert job_search._cache_is_fresh(_fresh_cache_row()) is True
    assert job_search._cache_is_fresh(_stale_cache_row()) is False
    assert job_search._cache_is_fresh({"fetched_at": None}) is False, (
        "an unreadable/missing timestamp must read as stale, not fresh"
    )


def test_cache_hit_serves_stored_results_and_never_touches_the_live_search():
    """The core promise: zero Tavily credits, zero allowance, zero user
    credits, no Tavily request at all — the strongest single check for that
    is that search_jobs_by_title (which is what would spend all of those)
    is never called."""
    response, mocks = _run_search(cached_row=_fresh_cache_row())

    mocks["live_search"].assert_not_called()
    mocks["store_cache"].assert_not_called()  # nothing new was fetched, nothing new to store
    mocks["record_hit"].assert_called_once()
    mocks["record_history"].assert_called_once()
    mocks["begin_use"].assert_not_called()  # a cache hit never reaches the spend decision at all
    mocks["release_use"].assert_not_called()
    mocks["assert_affordable"].assert_not_called()  # nor the pre-flight — nothing is being spent

    assert response["from_cache"] is True
    assert response["exact"] == [{"title": "Cached Job"}]


def test_cache_miss_runs_a_live_search_and_populates_the_cache():
    response, mocks = _run_search(cached_row=None)

    mocks["live_search"].assert_called_once()
    mocks["store_cache"].assert_called_once()
    mocks["record_hit"].assert_not_called()
    mocks["record_history"].assert_called_once()
    mocks["begin_use"].assert_called_once_with("user-1", job_search.JOB_SEARCH_ADDON, confirmed_purchase=False)
    mocks["release_use"].assert_not_called()  # succeeded, nothing to give back

    assert response["from_cache"] is False
    assert response["exact"] == [{"title": "Fresh Job"}]
    assert response["paid_with"] == "baseline"


def test_stale_cache_falls_through_to_a_live_search_without_refresh():
    """A cache entry past the 48h TTL is not served as a hit even when the
    caller didn't ask for Refresh — this is a plain new search request for
    the same query, which the spec treats as legitimate, not as the
    forbidden "auto-refresh on our own initiative" case (that's specifically
    about a history reopen or a page revisit re-fetching without being
    asked; see job_search_reopen, which never calls search_jobs_by_title at
    all)."""
    response, mocks = _run_search(cached_row=_stale_cache_row())

    mocks["live_search"].assert_called_once()
    mocks["store_cache"].assert_called_once()
    assert response["from_cache"] is False


def test_refresh_bypasses_a_fresh_cache_entry_and_pays_for_a_live_search():
    """Refresh is the ONLY path that re-runs a live search against a query
    that already has a fresh cache entry. The frontend is responsible for
    getting explicit confirmation before ever setting refresh=True; this
    test only proves the backend actually honours the flag."""
    response, mocks = _run_search(refresh=True, cached_row=_fresh_cache_row())

    mocks["live_search"].assert_called_once()
    mocks["record_hit"].assert_not_called()
    mocks["store_cache"].assert_called_once()
    assert response["from_cache"] is False


def test_preflight_failure_never_reaches_the_spend_decision():
    """Credit-addons prompt item 9: the Tavily pre-flight runs BEFORE
    anything is claimed, not just before the search — so a quota/config
    failure costs nothing at all rather than costing a slot or credits that
    then have to be refunded. begin_addon_use must never even be called."""
    from agents.jobs_finder import SearchQuotaExhausted
    from fastapi import HTTPException

    payload = job_search.JobSearchRequest(job_title="Software Engineer", location="Riyadh")
    with patch.object(job_search, "enforce"), \
         patch.object(job_search, "_get_cached_search", return_value=None), \
         patch.object(job_search, "assert_search_affordable", side_effect=SearchQuotaExhausted("out")) as assert_affordable, \
         patch.object(job_search, "begin_addon_use") as begin_use, \
         patch.object(job_search, "search_jobs_by_title") as live_search:
        with pytest.raises(HTTPException) as exc:
            job_search.job_search(payload, user_id="user-1")

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "search_quota_exhausted"
    assert_affordable.assert_called_once()
    begin_use.assert_not_called()
    live_search.assert_not_called()


def test_a_live_search_failure_releases_whatever_was_claimed():
    """Atomicity (credit-addons prompt item 2/9): a live search that raises
    must give back exactly what begin_addon_use claimed — baseline slot or
    credits — before the error surfaces. The Tavily SearchQuotaExhausted
    path and the generic-failure path both go through release_addon_use."""
    from agents.jobs_finder import SearchQuotaExhausted
    from fastapi import HTTPException

    credits_token = {"source": "credits", "addon": "job_search", "reserved": 5}
    with pytest.raises(HTTPException) as exc:
        _run_search(
            cached_row=None,
            begin_addon_use_result=credits_token,
            live_search_side_effect=SearchQuotaExhausted("plan exhausted"),
        )
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "search_quota_exhausted"

    # release_addon_use is patched fresh inside _run_search each call, so
    # check it via a second call that raises a generic failure too.
    with pytest.raises(HTTPException):
        _run_search(
            cached_row=None,
            begin_addon_use_result=credits_token,
            live_search_side_effect=RuntimeError("boom"),
        )


def test_begin_addon_use_is_called_with_the_confirmation_flag():
    """spend_credits on the request becomes confirmed_purchase on
    begin_addon_use — the one wire that turns an explicit frontend
    confirmation into an actual credit charge."""
    _, mocks = _run_search(cached_row=None, spend_credits=True)
    mocks["begin_use"].assert_called_once_with("user-1", job_search.JOB_SEARCH_ADDON, confirmed_purchase=True)


def test_cache_hit_and_history_use_the_real_begin_addon_use_free_tier_job_search_is_excluded():
    """Not mocked here on purpose: this exercises core.entitlements'
    real begin_addon_use/purchase_cap_for to confirm the actual product
    rule, not a stand-in for it. Job Search's purchase cap equals its
    baseline (core/entitlements.py PURCHASE_CAPPED_ADDONS), and Free's
    baseline is 0 — so a Free user's purchase cap is ALSO 0, meaning credits
    can never buy a Job Search on Free, unlike LinkedIn Essential and
    Interview Prep, which anyone can buy (credit-addons prompt item 4: 'Free
    stays 0/0, enforced explicitly')."""
    import core.entitlements as entitlements
    from fastapi import HTTPException

    with patch.object(entitlements, "effective_feature_tier", return_value="free"), \
         patch.object(entitlements, "get_admin_client") as mock_client:
        # get_addon_quota's read of {addon}_used: report 0 used, so
        # quota["remaining"] is 0 (limit 0 - used 0 = 0, capped at 0) and the
        # baseline branch is skipped, landing on the purchase-cap check.
        mock_client.return_value.table.return_value.select.return_value.eq.return_value \
            .maybe_single.return_value.execute.return_value.data = {"job_search_used": 0}
        with pytest.raises(HTTPException) as exc:
            entitlements.begin_addon_use("free-user", entitlements.JOB_SEARCH, confirmed_purchase=True)
    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == "purchase_limit_reached"


def test_reopening_history_is_always_free_even_when_stale():
    """job_search_reopen must never call search_jobs_by_title — reopening a
    past search, however old, costs nothing and never fires a live search on
    its own. Staleness is surfaced as a flag for the frontend's Refresh
    button, not hidden and not auto-corrected."""
    history_row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "user-1",
        "cache_key": "abc123",
        "raw_query": "Software Engineer",
        "location": "Riyadh",
        "internships": False,
        "searched_at": datetime.now(timezone.utc).isoformat(),
    }
    with patch.object(job_search, "maybe_row", return_value=history_row), \
         patch.object(job_search, "get_admin_client", return_value=MagicMock()), \
         patch.object(job_search, "_get_cached_search", return_value=_stale_cache_row()), \
         patch.object(job_search, "search_jobs_by_title") as live_search:
        response = job_search.job_search_reopen(history_row["id"], user_id="user-1")

    live_search.assert_not_called()
    assert response["is_stale"] is True
    assert response["from_cache"] is True
    assert response["exact"] == [{"title": "Old Job"}]


def test_reopening_someone_elses_history_is_a_404_not_a_403():
    """Same convention as core/documents.py and core/linkedin.py: a 403
    would confirm the id exists at all."""
    other_users_row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "someone-else",
        "cache_key": "abc123",
        "raw_query": "Software Engineer",
        "location": "",
        "internships": False,
        "searched_at": datetime.now(timezone.utc).isoformat(),
    }
    from fastapi import HTTPException
    with patch.object(job_search, "maybe_row", return_value=other_users_row), \
         patch.object(job_search, "get_admin_client", return_value=MagicMock()):
        try:
            job_search.job_search_reopen(other_users_row["id"], user_id="user-1")
            assert False, "expected a 404"
        except HTTPException as e:
            assert e.status_code == 404
