# tests/test_ats_scorer.py
from utils.ats_scorer import (
    exact_keyword_match_rate,
    required_skills_match_rate,
    calculate_ats_score,
)

SAMPLE_FACTS = {
    "education": [{"degree": "B.Sc. Artificial Intelligence", "gpa": "4.23"}],
    "skills": {
        "languages": ["Python"],
        "frameworks": ["LangGraph", "TensorFlow"],
        "tools": ["Git"]
    },
    "experience": [{"company": "TeamLab", "dates": "2023-2024", "bullets": []}],
    "projects": [
        {"name": "Flight Route Demand Prediction", "tech_stack": ["Python", "XGBoost"]},
        {"name": "JBAA", "tech_stack": ["Python", "LangGraph", "Claude"]}
    ]
}

SAMPLE_WEIGHT_FACTORS = {
    "required_skills": ["Python", "TensorFlow", "Docker"],
    "preferred_skills": ["Kubernetes"],
    "ats_keywords_high": ["machine learning", "model deployment", "Python"],
    "ats_keywords_medium": ["NLP", "LangGraph", "pipeline"],
    "education_requirement": "B.Sc. Computer Science or related",
    "years_experience_required": 1,
}

SAMPLE_CV_TEXT = """
Abdulmalik Hawsawi — AI Engineer
Built machine learning pipelines using Python and LangGraph.
Developed NLP models for Arabic dialect identification.
Experience with model deployment and production ML systems.
"""


def test_exact_keyword_match():
    rate, matched, unmatched = exact_keyword_match_rate(["Python", "Docker"], SAMPLE_CV_TEXT)
    assert "Python" in matched
    assert "Docker" in unmatched
    assert 0 <= rate <= 1


def test_skills_match():
    rate, matched, missing = required_skills_match_rate(
        SAMPLE_WEIGHT_FACTORS["required_skills"], SAMPLE_FACTS
    )
    assert "Python" in matched
    assert "Docker" in missing
    assert 0 <= rate <= 1


def test_full_ats_score():
    result = calculate_ats_score(SAMPLE_FACTS, SAMPLE_WEIGHT_FACTORS, SAMPLE_CV_TEXT)
    assert 0 <= result["ats_score"] <= 100
    assert "score_breakdown" in result
    assert "missing_skills" in result
    print(f"\nATS Score: {result['ats_score']}")
    print(f"   Breakdown: {result['score_breakdown']}")
    print(f"   Missing: {result['missing_skills']}")