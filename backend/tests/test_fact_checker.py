from unittest.mock import patch

import pytest

# NOTE: these tests used to import `verify_bullet`, a per-bullet checker that
# no longer exists — core/fact_checker.py now checks every bullet of a run in
# ONE Gemini call (_call_gemini_batch), which is why the whole module stopped
# importing and the suite couldn't be collected at all. They're written
# against the batched API here, so a bullet is checked the same way the
# pipeline actually checks it.
from core.fact_checker import MAX_RETRIES, _call_gemini_batch, run_fact_check_loop

SAMPLE_FACTS = {
    "personal": {"name": "Abdulmalik Hawsawi"},
    "experience": [{
        "company": "TeamLab",
        "title": "Sales Associate",
        "bullets": ["Assisted customers with product selection"],
        "metrics": [],
    }],
    "skills": {"languages": ["Python"], "frameworks": ["LangGraph"]},
    "projects": [{
        "name": "Flight Route Demand Prediction",
        "tech_stack": ["Python", "XGBoost"],
        "metrics": [],
    }],
}

# Checked together in a single call, mirroring how the pipeline batches a
# run's bullets — one shared API call for all three cases instead of three.
BULLETS = {
    "clean": "Assisted customers with product selection at TeamLab",
    "invented_metric": "Increased sales by 45% at TeamLab through customer engagement strategies",
    "invented_skill": "Built and deployed Kubernetes clusters for production ML pipelines",
}


@pytest.fixture(scope="module")
def batch_result():
    """One live Gemini call, shared by every check below."""
    ordered = list(BULLETS)
    results = _call_gemini_batch(
        [{"id": i, "text": BULLETS[key]} for i, key in enumerate(ordered)],
        SAMPLE_FACTS,
    )
    return {key: results[i] for i, key in enumerate(ordered)}


def test_clean_bullet_passes(batch_result):
    assert batch_result["clean"]["passes"] is True


def test_invented_metric_caught(batch_result):
    result = batch_result["invented_metric"]
    assert result["passes"] is False
    assert result["issue"] is not None


def test_invented_skill_caught(batch_result):
    assert batch_result["invented_skill"]["passes"] is False


def test_retry_loop_excludes_on_persistent_failure():
    """If regeneration still hallucinates every time, bullet should be excluded."""
    def always_bad_regen(bullet, issue):
        return "Achieved 99% accuracy improvement using Kubernetes (invented)"

    # Patch the batch call, not a per-bullet one: the loop makes exactly one
    # Gemini call per round, re-checking only what's still pending.
    with patch("core.fact_checker._call_gemini_batch") as mock_batch:
        mock_batch.return_value = {0: {"passes": False, "issue": "invented metric"}}

        bullets = [{"original": "x", "tailored": "Deployed Docker at scale", "relevance_score": 0.5}]
        verified, flags = run_fact_check_loop(bullets, SAMPLE_FACTS, always_bad_regen)

    assert verified == []
    assert any(f["excluded"] for f in flags)
    # One call per round, and the loop gives up after MAX_RETRIES rounds.
    assert mock_batch.call_count == MAX_RETRIES


def test_passing_bullet_is_returned_and_not_reflagged():
    """A bullet that passes round 1 short-circuits the loop — no second call."""
    with patch("core.fact_checker._call_gemini_batch") as mock_batch:
        mock_batch.return_value = {0: {"passes": True, "issue": None}}

        bullets = [{"original": "x", "tailored": "Assisted customers at TeamLab",
                    "relevance_score": 0.9}]
        verified, flags = run_fact_check_loop(bullets, SAMPLE_FACTS, lambda b, i: b)

    assert [v["tailored"] for v in verified] == ["Assisted customers at TeamLab"]
    assert flags == []
    assert mock_batch.call_count == 1
