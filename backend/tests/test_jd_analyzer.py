import pytest

from core.state import AgentState
from agents.jd_analyzer import run_jd_analyzer

SAMPLE_JD_1 = """
We are looking for a Machine Learning Engineer to join our team.
Requirements:
- 2+ years of experience with Python and PyTorch
- Experience deploying ML models to production
- Familiarity with MLOps tools (MLflow, DVC)
Bonus: Docker, Kubernetes, experience with NLP
We move fast, value ownership, and ship every week.
"""

SAMPLE_JD_2 = """
Junior AI Developer - Fresh graduates welcome
Must have: Python, basic ML knowledge
Nice to have: TensorFlow, data visualization
We are a collaborative team focused on research and innovation.
"""


def get_initial_state(jd_text: str) -> AgentState:
    return AgentState(
        raw_cv_text="",
        job_description=jd_text,
        facts_json={},
        weight_factors={},
        tailored_bullets=[],
        tailored_summary="",
        hallucination_flags=[],
        fact_check_passed=False,
        cover_letter_text="",
        cv_pdf_path="",
        cover_letter_pdf_path="",
        ats_score=0,
        score_breakdown={},
        gap_analysis=[],
        similar_jobs=[],
        error=None,
        current_step="",
    )


@pytest.fixture(scope="module")
def ml_engineer_result():
    """One Gemini call shared by the ML engineer JD test."""
    return run_jd_analyzer(get_initial_state(SAMPLE_JD_1))


@pytest.fixture(scope="module")
def junior_result():
    """Second Gemini call — opt in via pytest -m extra_api_call."""
    return run_jd_analyzer(get_initial_state(SAMPLE_JD_2))


def test_jd_analyzer_ml_engineer(ml_engineer_result):
    result = ml_engineer_result

    assert result["error"] is None
    wf = result["weight_factors"]
    required = [s.lower() for s in wf["required_skills"]]
    assert any("python" in s or "pytorch" in s for s in required)
    assert wf["seniority_level"] in ["junior", "mid", "senior", "lead"]
    assert len(wf["ats_keywords_high"]) > 0
    print("ML Engineer JD result:", wf)


@pytest.mark.extra_api_call
def test_jd_analyzer_junior(junior_result):
    result = junior_result

    assert result["error"] is None
    assert result["weight_factors"]["seniority_level"] == "junior"
    print("Junior JD result:", result["weight_factors"])
