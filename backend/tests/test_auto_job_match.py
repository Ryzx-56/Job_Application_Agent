"""
The automatic per-CV job match (agents/jobs_finder.find_matching_jobs_for_cv).

This runs on EVERY CV generation, for every tier, with no button in front of
it — so its cost is multiplied by every CV the product makes. The previous
version of this feature was removed for exactly that reason. These tests pin
the three things that keep it affordable and honest: how many lanes it buys,
that a cache hit buys none, and that a failure is never reported as "no jobs".
"""
import pytest

from core import search_provider
import agents.jobs_finder as jf
import core.job_search as js


WF = {"job_title": "IT Support Specialist",
      "required_skills": ["Active Directory", "Windows", "Troubleshooting"]}
FACTS = {"personal": {"location": "Riyadh"}, "skills": {"tools": ["Active Directory"]},
         "experience": [], "projects": []}


@pytest.fixture
def stubbed(monkeypatch):
    """Network, model screen and cache all stubbed; the credit counter is real."""
    calls = []

    def fake_search(query, domains=None, max_results=20, counter=None, country=None,
                    depth=search_provider.DEPTH_THOROUGH):
        search_provider.record_call(counter, depth=depth)
        calls.append({"domains": list(domains) if domains else None, "depth": depth})
        host = domains[0] if domains else "example-careers.com"
        return [{
            "url": f"https://{host}/jobs/{i}",
            "title": f"IT Support Specialist {i}",
            "content": ("Hiring an IT Support Specialist in Riyadh. Apply now. "
                        "Active Directory, Windows, troubleshooting. Posted 2 days ago."),
        } for i in range(6)]

    monkeypatch.setattr(search_provider, "search", fake_search)
    monkeypatch.setattr(jf, "_llm_screen_listings", lambda *a, **k: None)
    monkeypatch.setattr(jf, "_listing_is_dead", lambda url: False)
    monkeypatch.setattr(jf, "assert_search_affordable", lambda context="search": None)
    monkeypatch.setattr(js, "read_fresh_cache", lambda key: None)
    monkeypatch.setattr(js, "write_cache", lambda *a, **k: None)
    return calls


def test_one_live_match_buys_two_lanes_and_three_credits(stubbed):
    with search_provider.search_call_counter() as counter:
        jobs, status = jf.find_matching_jobs_for_cv(WF, FACTS)

    assert counter["calls"] == 2, f"expected 2 lane calls, got {counter['calls']}: {stubbed}"
    assert counter["units"] == 3, (
        "One automatic match must cost 3 provider credits: the Jadarat lane at "
        "DEPTH_FAST (1) plus the trusted-boards lane (2). Anything more and this "
        "is drifting back toward the 8-credit version that was removed."
    )
    assert counter["units"] == jf.auto_match_cost_units()
    assert status == jf.MATCH_OK

    # The two lanes bought are the PRE-VETTED ones; no open-web lane.
    assert any("jadarat.sa" in (c["domains"] or []) for c in stubbed)
    assert any("linkedin.com" in (c["domains"] or []) for c in stubbed)
    assert not any(c["domains"] is None for c in stubbed), \
        "the open-web lane must not be bought by the automatic match"
    # And the Jadarat lane uses the measured depth override.
    jadarat = next(c for c in stubbed if "jadarat.sa" in (c["domains"] or []))
    assert jadarat["depth"] == search_provider.DEPTH_FAST


def test_results_are_capped_at_five(stubbed):
    jobs, _ = jf.find_matching_jobs_for_cv(WF, FACTS)
    assert len(jobs) <= jf.AUTO_MATCH_RESULT_CAP == 5


def test_a_cache_hit_costs_nothing(stubbed, monkeypatch):
    monkeypatch.setattr(js, "read_fresh_cache",
                        lambda key: {"exact": [{"url": f"https://x/{i}", "title": "T"}
                                               for i in range(9)], "related": []})
    with search_provider.search_call_counter() as counter:
        jobs, status = jf.find_matching_jobs_for_cv(WF, FACTS)

    assert counter["calls"] == 0 and counter["units"] == 0
    assert len(jobs) == 5 and status == jf.MATCH_OK


def test_it_reads_the_job_search_page_cache_but_never_writes_to_it(stubbed, monkeypatch):
    """Free quality in one direction; never a downgrade in the other."""
    page_key = js.page_search_cache_key("IT Support Specialist", "Riyadh")
    auto_key = js.auto_match_cache_key("IT Support Specialist", "Riyadh")
    assert page_key != auto_key

    read = []
    monkeypatch.setattr(js, "read_fresh_cache", lambda key: read.append(key) or None)
    written = []
    monkeypatch.setattr(js, "write_cache",
                        lambda key, *a, **k: written.append(key))

    jf.find_matching_jobs_for_cv(WF, FACTS)

    assert page_key in read, "the richer Job Search page cache must be checked"
    assert written and all(k == auto_key for k in written), (
        "the automatic match must never write into the Job Search page's cache — "
        "a user spending a monthly search would be served this thinner result set."
    )


def test_a_failed_search_is_unavailable_not_empty(stubbed, monkeypatch):
    """
    The rule this whole codebase keeps relearning. `[]` means "we looked and
    there is nothing"; a failure has to say something else, or the panel tells
    a candidate there is no work for them when we simply could not look.
    """
    def boom(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(search_provider, "search", boom)

    jobs, status = jf.find_matching_jobs_for_cv(WF, FACTS)
    assert jobs == []
    assert status == jf.MATCH_UNAVAILABLE
    assert jf.MATCH_UNAVAILABLE != jf.MATCH_NONE_FOUND


def test_exhausted_platform_allowance_is_unavailable_and_does_not_raise(stubbed, monkeypatch):
    """A CV must never fail because the job panel could not be filled."""
    def exhausted(context="search"):
        raise jf.SearchQuotaExhausted("platform allowance spent")
    monkeypatch.setattr(jf, "assert_search_affordable", exhausted)

    jobs, status = jf.find_matching_jobs_for_cv(WF, FACTS)
    assert (jobs, status) == ([], jf.MATCH_UNAVAILABLE)


def test_a_genuine_no_results_search_is_none_found_not_unavailable(stubbed, monkeypatch):
    monkeypatch.setattr(search_provider, "search",
                        lambda *a, **k: (search_provider.record_call(k.get("counter"),
                                         depth=k.get("depth", search_provider.DEPTH_THOROUGH)) or []))
    jobs, status = jf.find_matching_jobs_for_cv(WF, FACTS)
    assert jobs == []
    assert status == jf.MATCH_NONE_FOUND


def test_no_job_title_is_none_found_and_spends_nothing(stubbed):
    with search_provider.search_call_counter() as counter:
        jobs, status = jf.find_matching_jobs_for_cv({"job_title": ""}, FACTS)
    assert (jobs, status) == ([], jf.MATCH_NONE_FOUND)
    assert counter["units"] == 0


def test_the_on_demand_button_still_costs_more_than_the_auto_match(stubbed):
    """
    The two must stay different. If find_similar_jobs ever collapses to the
    same cost, the automatic panel has silently become the expensive search
    again — which is the regression this whole design is avoiding.
    """
    with search_provider.search_call_counter() as auto:
        jf.find_matching_jobs_for_cv(WF, FACTS)
    with search_provider.search_call_counter() as on_demand:
        jf.find_similar_jobs(WF, FACTS)

    assert auto["units"] < on_demand["units"]
