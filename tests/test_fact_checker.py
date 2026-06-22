from unittest.mock import patch

import pytest

from core.fact_checker import verify_bullet, run_fact_check_loop

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


@pytest.fixture(scope="module")
def gemini_fact_checker():
    """Shared live Gemini calls for fact-check tests (3 API calls)."""
    return True


def test_clean_bullet_passes(gemini_fact_checker):
    bullet = "Assisted customers with product selection at TeamLab"
    result = verify_bullet(bullet, SAMPLE_FACTS)
    assert result["passes"] is True


def test_invented_metric_caught(gemini_fact_checker):
    bullet = "Increased sales by 45% at TeamLab through customer engagement strategies"
    result = verify_bullet(bullet, SAMPLE_FACTS)
    assert result["passes"] is False
    assert result["issue"] is not None


def test_invented_skill_caught(gemini_fact_checker):
    bullet = "Built and deployed Kubernetes clusters for production ML pipelines"
    result = verify_bullet(bullet, SAMPLE_FACTS)
    assert result["passes"] is False


def test_retry_loop_excludes_on_persistent_failure():
    """If regeneration still hallucinates every time, bullet should be excluded."""
    def always_bad_regen(bullet, issue):
        return "Achieved 99% accuracy improvement using Kubernetes (invented)"

    with patch("core.fact_checker.verify_bullet") as mock_verify:
        mock_verify.return_value = {"passes": False, "issue": "invented metric"}

        bullets = [{"original": "x", "tailored": "Deployed Docker at scale", "relevance_score": 0.5}]
        verified, flags = run_fact_check_loop(bullets, SAMPLE_FACTS, always_bad_regen)

    assert len(verified) == 0
    assert any(f["excluded"] for f in flags)
    assert mock_verify.call_count == 3
