# tests/test_search_provider.py
#
# Coverage for the priority/Jadarat lane depth override (2026-09-12,
# backend/tools/tavily_depth_test.py — see PRIORITY_LANE_SEARCH_DEPTH's own
# comment in agents/jobs_finder.py for the data behind it) and the
# provider-neutral depth plumbing it needed in core/search_provider.py.
#
# Everything here mocks TavilyClient / httpx — no network call, no Tavily
# credits spent. The whole point of test_priority_lane_uses_fast_depth... is
# to prove the override actually resolves correctly at runtime rather than
# leaking to every lane — "a config default that silently applies
# everywhere is exactly the failure class we've been fixing all month."
from unittest.mock import MagicMock, patch

import pytest

import core.search_provider as search_provider
from agents import jobs_finder


def test_priority_lane_uses_fast_depth_every_other_lane_stays_thorough(monkeypatch):
    """One search pass, four concurrent lanes. Only the Jadarat/priority lane's
    Tavily call may carry search_depth='basic' — every other lane in the same
    pass must still carry 'advanced'."""
    monkeypatch.setattr(search_provider, "SEARCH_PROVIDER", "tavily")
    monkeypatch.setenv("TAVILY_API_KEY", "test-key")

    captured: list[dict] = []

    def _fake_search(**kwargs):
        captured.append(kwargs)
        return {"results": []}

    mock_client = MagicMock()
    mock_client.search.side_effect = _fake_search

    with patch("tavily.TavilyClient", return_value=mock_client):
        jobs_finder._run_search_pass(None, None, "Software Engineer jobs vacancies apply", [])

    assert len(captured) == 4, f"expected 4 lane calls (priority/trusted/saudi/open), got {len(captured)}"

    depth_by_domains = {
        tuple(call.get("include_domains") or ()): call["search_depth"]
        for call in captured
    }
    priority_key = tuple(jobs_finder.PRIORITY_DOMAINS)
    assert priority_key in depth_by_domains, "priority lane never called include_domains=PRIORITY_DOMAINS"
    assert depth_by_domains[priority_key] == "basic", (
        "priority/Jadarat lane must resolve to basic at runtime"
    )
    for domains, depth in depth_by_domains.items():
        if domains != priority_key:
            assert depth == "advanced", (
                f"non-priority lane {domains or 'OPEN WEB'} must stay advanced, got {depth!r}"
            )


def test_fast_depth_costs_half_the_credits_of_thorough_on_tavily():
    assert search_provider.units_per_call("tavily", depth=search_provider.DEPTH_THOROUGH) == 2
    assert search_provider.units_per_call("tavily", depth=search_provider.DEPTH_FAST) == 1
    assert search_provider.cost_per_call_usd("tavily", depth=search_provider.DEPTH_THOROUGH) == pytest.approx(0.016)
    assert search_provider.cost_per_call_usd("tavily", depth=search_provider.DEPTH_FAST) == pytest.approx(0.008)


def test_counter_reflects_the_actual_depth_of_each_call_not_a_flat_rate(monkeypatch):
    """The counter is what the Jadarat override's reported savings comes
    from. If it billed every call at the thorough rate regardless of what
    was actually sent, the savings would be invisible — silently correct
    code with a counter that lies about it."""
    monkeypatch.setattr(search_provider, "SEARCH_PROVIDER", "tavily")
    with search_provider.search_call_counter() as counter:
        search_provider.record_call(counter, depth=search_provider.DEPTH_FAST)
        search_provider.record_call(counter, depth=search_provider.DEPTH_THOROUGH)
    assert counter["calls"] == 2
    assert counter["units"] == 1 + 2
    assert counter["usd"] == pytest.approx(0.008 + 0.016)


def test_serper_ignores_depth_without_erroring(monkeypatch):
    """Serper has no depth concept at all. The dispatcher passes `depth`
    uniformly to both providers so jobs_finder never has to know which one
    is live — Serper's path must silently accept and ignore it."""
    monkeypatch.setattr(search_provider, "SEARCH_PROVIDER", "serper")
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    fake_response = MagicMock(status_code=200, headers={})
    fake_response.json.return_value = {"organic": []}

    with patch("httpx.post", return_value=fake_response):
        fast = search_provider.search("query", depth=search_provider.DEPTH_FAST)
        thorough = search_provider.search("query", depth=search_provider.DEPTH_THOROUGH)

    assert fast == thorough == []
    assert (search_provider.units_per_call("serper", depth=search_provider.DEPTH_FAST)
            == search_provider.units_per_call("serper", depth=search_provider.DEPTH_THOROUGH)
            == 1)
