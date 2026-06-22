import pytest

from core.state import AgentState
from agents.tailoring_engine import run_tailoring_engine

SAMPLE_FACTS = {
    "personal": {"name": "Abdulmalik Hawsawi"},
    "experience": [
        {
            "company": "TeamLab",
            "title": "Customer Experience Staff",
            "bullets": [
                "Assisted visitors with technical issues across interactive exhibits",
                "Communicated with international guests in English and Arabic",
            ],
        }
    ],
    "projects": [
        {
            "name": "Job Application Agent",
            "tech_stack": ["Python", "LangGraph", "Claude API", "Gemini API"],
            "description": "Built a multi-agent pipeline that tailors CVs and generates cover letters using LangGraph orchestration",
        },
        {
            "name": "Flight Route Demand Prediction",
            "tech_stack": ["Python", "GMM", "scikit-learn", "pandas"],
            "description": "Applied Gaussian Mixture Models to 880K BTS flight records to predict route demand clusters",
        },
    ],
    "skills": {
        "languages": ["Python"],
        "frameworks": ["LangGraph", "Flask", "scikit-learn"],
        "tools": ["Git", "GitHub", "Jupyter"],
    },
}

SAMPLE_WEIGHT_FACTORS = {
    "job_title": "AI Engineer",
    "company": "TechCorp",
    "seniority_level": "junior",
    "required_skills": ["Python", "LangGraph", "LLM APIs"],
    "preferred_skills": ["FastAPI", "Docker"],
    "ats_keywords_high": ["multi-agent", "LLM pipeline", "production AI"],
    "ats_keywords_medium": ["orchestration", "API integration"],
    "culture_signals": ["fast-paced", "ownership"],
    "cover_letter_tone": "confident and direct",
}


def make_state() -> AgentState:
    return AgentState(
        raw_cv_text="",
        job_description="",
        facts_json=SAMPLE_FACTS,
        weight_factors=SAMPLE_WEIGHT_FACTORS,
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
def tailored_result():
    """One Gemini call shared by all tailoring tests."""
    return run_tailoring_engine(make_state())


def test_tailoring_engine_runs(tailored_result):
    assert tailored_result["error"] is None
    assert tailored_result["tailored_summary"] != ""
    assert len(tailored_result["tailored_bullets"]) > 0


def test_bullets_have_required_fields(tailored_result):
    for bullet in tailored_result["tailored_bullets"]:
        assert "original" in bullet
        assert "tailored" in bullet
        assert "relevance_score" in bullet


def test_no_hallucination_obvious(tailored_result):
    for bullet in tailored_result["tailored_bullets"]:
        assert "kubernetes" not in bullet["tailored"].lower()
