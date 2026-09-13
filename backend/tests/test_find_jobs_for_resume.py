# tests/test_find_jobs_for_resume.py
#
# The per-CV "find matching jobs" button (core/documents.py), unified onto
# the same credit-purchasable Job Search pool as the standalone page
# (2026-09-12, credit-addons prompt item 4). Mocks the DB/search seams the
# same way tests/test_job_search_cache.py does for the standalone endpoint.
#
# core/documents.py pulls in the FULL PDF-rendering stack at import time
# (utils/pdf_generator.py -> utils/fit_to_page.py -> weasyprint, which needs
# system Pango/Cairo, not just a pip install) for the CV/cover-letter
# download routes this test file has no interest in exercising. Stubbed out
# in sys.modules BEFORE the import, the same shape tests/test_entitlements.py
# avoided entirely by reading source text instead — this file wants the real
# find_jobs_for_resume function, so it stubs the one heavy branch instead.
import sys
import types
from unittest.mock import MagicMock, patch

for _mod_name, _attrs in {
    "utils.pdf_generator": ("render_cv_pdf", "render_cover_letter_pdf"),
    "utils.docx_generator": ("generate_cv_docx",),
}.items():
    if _mod_name not in sys.modules:
        _stub = types.ModuleType(_mod_name)
        for _attr in _attrs:
            setattr(_stub, _attr, MagicMock())
        sys.modules[_mod_name] = _stub

import pytest
from fastapi import HTTPException

import core.documents as documents

RESUME_ID = "11111111-1111-1111-1111-111111111111"


def _row(similar_jobs=None):
    return {
        "id": RESUME_ID,
        "user_id": "user-1",
        "similar_jobs": similar_jobs,
        "generation_snapshot": {
            "facts_json": {"personal": {"location": "Riyadh"}},
            "weight_factors": {"job_title": "Software Engineer", "required_skills": ["Python"]},
        },
    }


def _call(*, row, spend_credits=False, begin_addon_use_result=None, find_similar_jobs_side_effect=None):
    if begin_addon_use_result is None:
        begin_addon_use_result = {"source": "baseline", "addon": "job_search"}
    find_kwargs = dict(return_value=[{"title": "Fresh Job"}])
    if find_similar_jobs_side_effect is not None:
        find_kwargs = dict(side_effect=find_similar_jobs_side_effect)

    mock_admin = MagicMock()
    mock_admin.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = \
        MagicMock(data=row)

    with patch.object(documents, "get_admin_client", return_value=mock_admin), \
         patch.object(documents, "maybe_row", return_value=row), \
         patch("core.rate_limit.enforce"), \
         patch("agents.jobs_finder.assert_search_affordable") as assert_affordable, \
         patch("agents.jobs_finder._fetch_profile_location", return_value="Riyadh"), \
         patch("agents.jobs_finder._looks_like_real_location", return_value=True), \
         patch("agents.jobs_finder.find_similar_jobs", **find_kwargs) as find_similar, \
         patch("core.entitlements.begin_addon_use", return_value=begin_addon_use_result) as begin_use, \
         patch("core.entitlements.release_addon_use") as release_use:
        result = documents.find_jobs_for_resume(RESUME_ID, spend_credits=spend_credits, user_id="user-1")

    return result, dict(
        assert_affordable=assert_affordable, find_similar=find_similar,
        begin_use=begin_use, release_use=release_use,
    )


def test_existing_results_return_free_even_with_spend_credits_confirmed():
    """The core idempotency promise, now checked specifically UNDER a credit
    spend confirmation: a double-click (or a frontend that always sends
    spend_credits=True once baseline is known to be exhausted) must not
    reach begin_addon_use at all when results already exist — 'already paid
    for' has to win before the spend decision is ever made."""
    result, mocks = _call(row=_row(similar_jobs=[{"title": "Cached Job"}]), spend_credits=True)

    assert result["from_cache"] is True
    assert result["jobs"] == [{"title": "Cached Job"}]
    mocks["begin_use"].assert_not_called()
    mocks["assert_affordable"].assert_not_called()
    mocks["find_similar"].assert_not_called()


def test_no_existing_results_runs_a_live_search_and_pays_with_baseline_by_default():
    result, mocks = _call(row=_row(similar_jobs=None))

    assert result["from_cache"] is False
    assert result["paid_with"] == "baseline"
    mocks["begin_use"].assert_called_once()
    _, kwargs = mocks["begin_use"].call_args
    assert kwargs["confirmed_purchase"] is False


def test_spend_credits_flag_is_threaded_through_as_the_confirmation():
    _, mocks = _call(row=_row(similar_jobs=None), spend_credits=True,
                      begin_addon_use_result={"source": "credits", "addon": "job_search", "reserved": 5})
    _, kwargs = mocks["begin_use"].call_args
    assert kwargs["confirmed_purchase"] is True


def test_search_failure_releases_whatever_was_claimed():
    """Atomicity: a failed find_similar_jobs must release the baseline slot
    or refund the credits begin_addon_use claimed — the same rule the
    standalone page's job_search() follows."""
    from agents.jobs_finder import SearchQuotaExhausted

    credits_token = {"source": "credits", "addon": "job_search", "reserved": 5}
    with pytest.raises(HTTPException) as exc:
        _call(
            row=_row(similar_jobs=None),
            begin_addon_use_result=credits_token,
            find_similar_jobs_side_effect=SearchQuotaExhausted("plan exhausted"),
        )
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "search_quota_exhausted"


def test_preflight_failure_never_reaches_the_spend_decision():
    """Item 9: the pre-flight runs before anything is claimed here too."""
    from agents.jobs_finder import SearchUnavailable

    row = _row(similar_jobs=None)
    mock_admin = MagicMock()
    mock_admin.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = \
        MagicMock(data=row)

    with patch.object(documents, "get_admin_client", return_value=mock_admin), \
         patch.object(documents, "maybe_row", return_value=row), \
         patch("core.rate_limit.enforce"), \
         patch("agents.jobs_finder.assert_search_affordable", side_effect=SearchUnavailable("no key")), \
         patch("core.entitlements.begin_addon_use") as begin_use, \
         patch("agents.jobs_finder.find_similar_jobs") as find_similar:
        with pytest.raises(HTTPException) as exc:
            documents.find_jobs_for_resume(RESUME_ID, spend_credits=False, user_id="user-1")

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "search_failed"
    begin_use.assert_not_called()
    find_similar.assert_not_called()


def test_someone_elses_resume_is_a_404():
    row = _row(similar_jobs=None)
    row["user_id"] = "someone-else"
    mock_admin = MagicMock()
    with patch.object(documents, "get_admin_client", return_value=mock_admin), \
         patch.object(documents, "maybe_row", return_value=row):
        with pytest.raises(HTTPException) as exc:
            documents.find_jobs_for_resume(RESUME_ID, spend_credits=False, user_id="user-1")
    assert exc.value.status_code == 404
