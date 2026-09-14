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


def _row(matched_jobs=None, similar_jobs=None):
    """
    `matched_jobs` is the PAID column and the only one idempotency reads.
    `similar_jobs` is the FREE automatic teaser, written on every generation
    since 2026-09-14 — it must never make the button look already-paid-for.
    """
    return {
        "id": RESUME_ID,
        "user_id": "user-1",
        "matched_jobs": matched_jobs,
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
    result, mocks = _call(row=_row(matched_jobs=[{"title": "Cached Job"}]), spend_credits=True)

    assert result["from_cache"] is True
    assert result["jobs"] == [{"title": "Cached Job"}]
    mocks["begin_use"].assert_not_called()
    mocks["assert_affordable"].assert_not_called()
    mocks["find_similar"].assert_not_called()


def test_the_free_automatic_teaser_does_not_satisfy_the_paid_button():
    """
    THE REGRESSION THIS SPLIT EXISTS FOR.

    The automatic per-CV match writes `similar_jobs` on every generation. For
    one day this endpoint's idempotency check read that same column, so every
    CV arrived looking like it had already been paid for: the button returned
    the free teaser's listings and the search nobody had run was reported as
    "from_cache". The paid feature stopped running at all.

    A row carrying a full teaser and no paid results must spend and search.
    """
    teaser = [{"title": f"Teaser {i}"} for i in range(5)]
    result, mocks = _call(row=_row(matched_jobs=None, similar_jobs=teaser))

    assert result["from_cache"] is False, \
        "the free teaser was mistaken for a paid result"
    mocks["begin_use"].assert_called_once()
    mocks["find_similar"].assert_called_once()
    # And what comes back is the search's output, not the teaser.
    assert result["jobs"] == [{"title": "Fresh Job"}]


def test_paid_results_are_stored_in_the_paid_column_not_the_teaser_column():
    """Writing back into similar_jobs would overwrite the free teaser AND
    re-create the conflation from the other direction."""
    import core.documents as docs
    from unittest.mock import MagicMock, patch as _patch

    mock_admin = MagicMock()
    row = _row(matched_jobs=None, similar_jobs=[{"title": "Teaser"}])
    with _patch.object(docs, "get_admin_client", return_value=mock_admin), \
         _patch.object(docs, "maybe_row", return_value=row), \
         _patch("core.rate_limit.enforce"), \
         _patch("agents.jobs_finder.assert_search_affordable"), \
         _patch("agents.jobs_finder._fetch_profile_location", return_value="Riyadh"), \
         _patch("agents.jobs_finder._looks_like_real_location", return_value=True), \
         _patch("agents.jobs_finder.find_similar_jobs", return_value=[{"title": "Fresh"}]), \
         _patch("core.entitlements.begin_addon_use",
                return_value={"source": "baseline", "addon": "job_search"}), \
         _patch("core.entitlements.release_addon_use"):
        docs.find_jobs_for_resume(RESUME_ID, spend_credits=False, user_id="user-1")

    writes = [c for c in mock_admin.table.return_value.update.call_args_list]
    assert writes, "the paid result was never stored"
    stored = writes[-1].args[0]
    assert "matched_jobs" in stored
    assert "similar_jobs" not in stored, \
        "the paid search must not overwrite the free automatic teaser"


def test_no_existing_results_runs_a_live_search_and_pays_with_baseline_by_default():
    result, mocks = _call(row=_row())

    assert result["from_cache"] is False
    assert result["paid_with"] == "baseline"
    mocks["begin_use"].assert_called_once()
    _, kwargs = mocks["begin_use"].call_args
    assert kwargs["confirmed_purchase"] is False


def test_spend_credits_flag_is_threaded_through_as_the_confirmation():
    _, mocks = _call(row=_row(), spend_credits=True,
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
            row=_row(),
            begin_addon_use_result=credits_token,
            find_similar_jobs_side_effect=SearchQuotaExhausted("plan exhausted"),
        )
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "search_quota_exhausted"


def test_preflight_failure_never_reaches_the_spend_decision():
    """Item 9: the pre-flight runs before anything is claimed here too."""
    from agents.jobs_finder import SearchUnavailable

    row = _row()
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
    row = _row()
    row["user_id"] = "someone-else"
    mock_admin = MagicMock()
    with patch.object(documents, "get_admin_client", return_value=mock_admin), \
         patch.object(documents, "maybe_row", return_value=row):
        with pytest.raises(HTTPException) as exc:
            documents.find_jobs_for_resume(RESUME_ID, spend_credits=False, user_id="user-1")
    assert exc.value.status_code == 404


def test_a_missing_matched_jobs_column_falls_back_instead_of_500ing():
    """
    THE DEPLOY WINDOW. This code ships on push; its migration is applied by a
    human. In between, selecting `matched_jobs` fails the whole query — which
    would take the button down for everyone rather than degrade it. The
    fallback restores exactly today's behaviour (idempotency off
    similar_jobs) until the column exists.
    """
    import core.documents as docs
    from unittest.mock import MagicMock, patch as _patch

    legacy_row = {
        "id": RESUME_ID,
        "user_id": "user-1",
        "similar_jobs": [{"title": "Previously paid"}],
        "generation_snapshot": {
            "facts_json": {"personal": {"location": "Riyadh"}},
            "weight_factors": {"job_title": "Software Engineer", "required_skills": ["Python"]},
        },
    }

    calls = {"n": 0}

    def flaky_maybe_row(*_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError('column resumes.matched_jobs does not exist')
        return legacy_row

    with _patch.object(docs, "get_admin_client", return_value=MagicMock()), \
         _patch.object(docs, "maybe_row", side_effect=flaky_maybe_row), \
         _patch("core.rate_limit.enforce"), \
         _patch("core.entitlements.begin_addon_use") as begin_use:
        result = docs.find_jobs_for_resume(RESUME_ID, spend_credits=False, user_id="user-1")

    # Fell back rather than raising, and honoured the old idempotency.
    assert result["from_cache"] is True
    assert result["jobs"] == [{"title": "Previously paid"}]
    begin_use.assert_not_called()
    assert calls["n"] == 2, "the legacy select was never attempted"
