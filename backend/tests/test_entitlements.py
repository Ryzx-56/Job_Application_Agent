# tests/test_entitlements.py
import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

import core.entitlements as entitlements
from core.entitlements import (
    ADDON_CREDIT_COSTS,
    INTERVIEW_PREP,
    JOB_SEARCH,
    LINKEDIN_ESSENTIAL,
    cap_for,
    purchase_cap_for,
)

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def test_job_search_allowance_matches_the_no_switch_column():
    """2026-09-12, depth-history-allowance prompt Part 3, confirmed by the
    user AFTER tavily_depth_test.py showed no case for a global depth
    switch — so the "if it does not [switch]" column applies: Pro 5,
    Elite 13 (not the Pro 6 / Elite 15 the doc's other column would have
    been). Free stays locked out entirely."""
    assert cap_for("free", JOB_SEARCH) == 0
    assert cap_for("pro", JOB_SEARCH) == 5
    assert cap_for("elite", JOB_SEARCH) == 13


def test_job_search_purchase_cap_equals_baseline_others_are_uncapped():
    """Credit-addons prompt item 4, patched: purchase cap = baseline, so
    total max is Pro 5+5=10, Elite 13+13=26. LinkedIn Essential and
    Interview Prep have no purchase cap at all — limited only by credits."""
    assert purchase_cap_for("pro", JOB_SEARCH) == 5
    assert purchase_cap_for("elite", JOB_SEARCH) == 13
    assert purchase_cap_for("free", JOB_SEARCH) == 0  # see the exclusion test below

    assert purchase_cap_for("pro", LINKEDIN_ESSENTIAL) is None
    assert purchase_cap_for("elite", INTERVIEW_PREP) is None
    assert purchase_cap_for("free", LINKEDIN_ESSENTIAL) is None


def test_job_search_cap_is_unified_across_both_entry_points():
    """2026-09-12, credit-addons prompt item 4: the standalone page and the
    per-CV find-jobs button now draw on the SAME pool through the SAME
    function. Read as source text rather than importing core.documents /
    core.job_search — those modules pull in the full PDF-rendering stack
    (WeasyPrint and friends) for something this check has no need to
    execute at all."""
    documents_src = (_BACKEND_DIR / "core" / "documents.py").read_text()
    match = re.search(
        r"^def find_jobs_for_resume\(.*?\n(?=^def |^@router|\Z)",
        documents_src, re.DOTALL | re.MULTILINE,
    )
    assert match, "find_jobs_for_resume not found in core/documents.py — did it move or get renamed?"
    per_cv_source = match.group(0)
    assert "begin_addon_use(" in per_cv_source
    assert "release_addon_use(" in per_cv_source

    standalone_source = (_BACKEND_DIR / "core" / "job_search.py").read_text()
    assert "begin_addon_use(" in standalone_source
    assert "release_addon_use(" in standalone_source
    # Both must be spending the SAME addon name — this is what makes it one
    # pool rather than two pools that happen to share a cap number.
    assert "JOB_SEARCH_ADDON" in standalone_source or "JOB_SEARCH," in standalone_source


def _mock_admin(baseline_used: int, purchased_used: int = 0):
    """A fake Supabase admin client whose only job is to answer the reads
    begin_addon_use makes before it decides anything — get_addon_quota's
    `{addon}_used` and _read_purchased_count's `{addon}_purchased`. Every
    query shape in this module ends in the same
    `.table().select().eq().maybe_single().execute().data` chain, so one
    fake row serves both reads regardless of which column was asked for."""
    client = MagicMock()
    row = {"linkedin_essential_used": baseline_used, "interview_prep_used": baseline_used,
           "job_search_used": baseline_used, "linkedin_essential_purchased": purchased_used,
           "interview_prep_purchased": purchased_used, "job_search_purchased": purchased_used}
    client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = row
    return client


def test_removed_tier_promotion_free_with_purchased_credits_gets_zero_baseline_on_all_three():
    """The regression test credit-addons prompt item 1 asks for directly:
    tier='free', purchased_credits=30 -> all three baselines are 0, and
    credits can still be spent on all three (item 1's 'exactly like anyone
    else').

    effective_tier()/has_purchased_credits()/PACK_BUYER_TIER are gone
    entirely (see core/entitlements.py's removal note) — this test would
    have failed against the old code, which promoted this exact user to the
    Pro baseline (2 LinkedIn Essential, 5 Interview Prep, 5 Job Search) for
    as long as any of the 30 credits remained.
    """
    assert not hasattr(entitlements, "effective_tier")
    assert not hasattr(entitlements, "has_purchased_credits")
    assert not hasattr(entitlements, "PACK_BUYER_TIER")

    # LinkedIn Essential and Interview Prep: no purchase cap, so a
    # confirmed, funded purchase goes straight through as a credit charge —
    # NOT a promoted baseline (the old bug would have reported "baseline").
    for addon in (LINKEDIN_ESSENTIAL, INTERVIEW_PREP):
        with patch.object(entitlements, "effective_feature_tier", return_value="free"), \
             patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=0)), \
             patch.object(entitlements, "credit_balance", return_value=30), \
             patch.object(entitlements, "reserve_addon_credits", return_value=ADDON_CREDIT_COSTS[addon]) as reserve:
            payment = entitlements.begin_addon_use("free-pack-buyer", addon, confirmed_purchase=True)

        assert payment["source"] == "credits", f"{addon}: expected a credit charge, not a promoted baseline"
        reserve.assert_called_once()

    # Job Search is the one exception (item 1/4): its purchase cap equals
    # its ZERO baseline on Free, so it stays excluded even with credits and
    # even with confirmation — see test_free_tier_job_search_is_excluded... .
    with patch.object(entitlements, "effective_feature_tier", return_value="free"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=0)), \
         patch.object(entitlements, "reserve_addon_credits") as reserve:
        with pytest.raises(HTTPException):
            entitlements.begin_addon_use("free-pack-buyer", JOB_SEARCH, confirmed_purchase=True)
        reserve.assert_not_called()


def test_free_tier_job_search_is_excluded_even_with_credits_and_confirmation():
    """Credit-addons prompt item 4: 'Free stays 0/0, enforced explicitly
    even though free users can't afford the 5-credit price anyway.' Falls
    out of purchase_cap_for(tier, JOB_SEARCH) == cap_for(tier, JOB_SEARCH):
    Free's baseline is 0, so its purchase cap is ALSO 0 — 0 purchases made
    (0) is not < 0, so the cap is reported as already reached before any
    credits are touched."""
    with patch.object(entitlements, "effective_feature_tier", return_value="free"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=0)), \
         patch.object(entitlements, "reserve_addon_credits") as reserve:
        with pytest.raises(HTTPException) as exc:
            entitlements.begin_addon_use("free-user", JOB_SEARCH, confirmed_purchase=True)

    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == "purchase_limit_reached"
    reserve.assert_not_called()  # refused before any credit was ever touched


def test_spend_order_is_baseline_first_never_credits_while_baseline_remains():
    """Item 2's central rule, checked directly: with baseline remaining,
    reserve_addon_credits must never even be called."""
    with patch.object(entitlements, "effective_feature_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=0)) as client, \
         patch.object(entitlements, "reserve_addon_credits") as reserve:
        payment = entitlements.begin_addon_use("pro-user", LINKEDIN_ESSENTIAL, confirmed_purchase=False)

    assert payment["source"] == "baseline"
    reserve.assert_not_called()
    # The baseline claim itself is the atomic RPC, not a plain UPDATE.
    client.return_value.rpc.assert_any_call(
        "consume_addon_quota",
        {"p_user_id": "pro-user", "p_addon": LINKEDIN_ESSENTIAL, "p_limit": 2},
    )


def test_baseline_exhausted_without_confirmation_returns_402_not_a_silent_charge():
    """'Never spent silently while baseline remains' has a mirror rule this
    pins: never spent WITHOUT the confirmation either, once baseline is
    gone. No exception message match — pinned on the structured code and
    the fields the frontend's confirmation dialog needs."""
    with patch.object(entitlements, "effective_feature_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=2)), \
         patch.object(entitlements, "credit_balance", return_value=18), \
         patch.object(entitlements, "reserve_addon_credits") as reserve:
        with pytest.raises(HTTPException) as exc:
            entitlements.begin_addon_use("pro-user", LINKEDIN_ESSENTIAL, confirmed_purchase=False)

    assert exc.value.status_code == 402
    assert exc.value.detail["code"] == "addon_purchase_available"
    assert exc.value.detail["addon"] == LINKEDIN_ESSENTIAL
    assert exc.value.detail["credit_cost"] == ADDON_CREDIT_COSTS[LINKEDIN_ESSENTIAL]
    assert exc.value.detail["credit_balance"] == 18
    reserve.assert_not_called()


def test_confirmed_purchase_with_baseline_exhausted_reserves_credits_and_records_the_purchase():
    with patch.object(entitlements, "effective_feature_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=5, purchased_used=0)) as client, \
         patch.object(entitlements, "reserve_addon_credits", return_value=3) as reserve:
        payment = entitlements.begin_addon_use("pro-user", INTERVIEW_PREP, confirmed_purchase=True)

    assert payment == {"source": "credits", "addon": INTERVIEW_PREP, "reserved": 3}
    reserve.assert_called_once_with("pro-user", ADDON_CREDIT_COSTS[INTERVIEW_PREP], entitlements.ADDON_LABELS[INTERVIEW_PREP])
    client.return_value.rpc.assert_any_call(
        "consume_addon_purchase",
        {"p_user_id": "pro-user", "p_addon": INTERVIEW_PREP, "p_limit": None},
    )


def test_release_addon_use_refunds_credits_and_releases_the_purchase_slot():
    """Atomicity's other half: undoing a credits-sourced claim must hit
    BOTH refund_credits and release_addon_purchase, not just one."""
    token = {"source": "credits", "addon": JOB_SEARCH, "reserved": 5}
    with patch.object(entitlements, "refund_credits") as refund, \
         patch.object(entitlements, "_release_purchase_slot") as release_purchase:
        entitlements.release_addon_use("user-1", token)

    refund.assert_called_once_with("user-1", 5)
    release_purchase.assert_called_once_with("user-1", JOB_SEARCH)


def test_release_addon_use_releases_a_baseline_slot():
    token = {"source": "baseline", "addon": JOB_SEARCH}
    with patch.object(entitlements, "release_addon_quota") as release_quota:
        entitlements.release_addon_use("user-1", token)
    release_quota.assert_called_once_with("user-1", JOB_SEARCH)


def test_addon_summary_returns_every_addon_in_one_call():
    """Item 6: 'don't make the frontend assemble this from four calls' —
    one function call (and, at the route, one GET) returns the full picture
    for all three add-ons plus the shared credit balance."""
    with patch.object(entitlements, "credit_balance", return_value=12), \
         patch.object(entitlements, "get_addon_quota") as get_quota, \
         patch.object(entitlements, "purchase_cap_for") as purchase_cap, \
         patch.object(entitlements, "_read_purchased_count", return_value=2):
        get_quota.return_value = {"tier": "pro", "limit": 5, "used": 5, "remaining": 0, "unlocked": True}
        purchase_cap.side_effect = lambda tier, addon: 5 if addon == JOB_SEARCH else None

        summary = entitlements.addon_summary(user_id="user-1")

    assert summary["credit_balance"] == 12
    for addon in ("linkedin_essential", "interview_prep", "job_search"):
        assert addon in summary
        assert summary[addon]["baseline_remaining"] == 0
        assert summary[addon]["credit_cost"] == ADDON_CREDIT_COSTS[addon]

    # Job Search is the capped one: purchases_remaining is a real number.
    assert summary["job_search"]["purchase_limit"] == 5
    assert summary["job_search"]["purchases_used"] == 2
    assert summary["job_search"]["purchases_remaining"] == 3
    # LinkedIn Essential / Interview Prep are uncapped: no ceiling to report.
    assert summary["linkedin_essential"]["purchase_limit"] is None
    assert summary["linkedin_essential"]["purchases_remaining"] is None


def test_purchase_cap_reached_refunds_the_credits_it_just_reserved():
    """The race case: two requests both pass the purchase-cap pre-check,
    only one can win the atomic increment. The loser must get its credits
    back rather than being charged for a purchase that the cap says didn't
    happen."""
    # purchased_used=4, one under the purchase cap of 5: the PRE-check
    # passes (this is what makes it a race rather than the ordinary
    # already-at-cap refusal, which never reaches reserve_addon_credits at
    # all — see test_free_tier_job_search_is_excluded... for that path).
    with patch.object(entitlements, "effective_feature_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=5, purchased_used=4)), \
         patch.object(entitlements, "reserve_addon_credits", return_value=5) as reserve, \
         patch.object(entitlements, "refund_credits") as refund, \
         patch.object(entitlements, "_consume_purchase_slot", return_value=False):
        with pytest.raises(HTTPException) as exc:
            entitlements.begin_addon_use("pro-user", JOB_SEARCH, confirmed_purchase=True)

    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == "purchase_limit_reached"
    reserve.assert_called_once()
    refund.assert_called_once_with("pro-user", 5)
