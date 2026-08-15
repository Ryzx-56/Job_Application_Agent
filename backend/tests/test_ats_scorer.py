# tests/test_ats_scorer.py
from utils.ats_scorer import (
    exact_keyword_match_rate,
    required_skills_match_rate,
    calculate_ats_score,
)
from utils.skills import has_skills, resolve_skills

# What tailoring_engine.py emits when Agent 3 produced no skills: every
# category present, every list empty. Truthy, which is the whole bug.
EMPTY_SHELL = {c: [] for c in ("languages", "frameworks", "tools", "soft_skills", "other")}

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
    # SAMPLE_FACTS["skills"], not SAMPLE_FACTS. This argument became the
    # skills dict when the scorer started preferring tailored_skills over the
    # raw extraction (see required_skills_match_rate's docstring); the test
    # kept passing the whole facts_json, so it iterated education/experience
    # entries and handed a dict to normalize().
    rate, matched, missing = required_skills_match_rate(
        SAMPLE_WEIGHT_FACTORS["required_skills"], SAMPLE_FACTS["skills"]
    )
    assert "Python" in matched
    assert "Docker" in missing
    assert 0 <= rate <= 1


def test_empty_skills_shell_is_not_mistaken_for_real_skills():
    """
    The empty-but-present shell must be treated as absent, so the raw parsed
    skills are used instead. Before the fix this scored 0% skills against a
    CV that listed real ones, and stripped the Skills section off the
    rendered document via the same pattern in cv_context.py.
    """
    assert bool(EMPTY_SHELL) is True, "the shell is truthy — that is the trap"
    assert has_skills(EMPTY_SHELL) is False
    assert has_skills(SAMPLE_FACTS["skills"]) is True
    assert resolve_skills(EMPTY_SHELL, SAMPLE_FACTS["skills"]) == SAMPLE_FACTS["skills"]
    assert resolve_skills(EMPTY_SHELL, {}) == {}
    assert resolve_skills({"tools": ["  "]}, SAMPLE_FACTS["skills"]) == SAMPLE_FACTS["skills"]

    shelled = calculate_ats_score(
        SAMPLE_FACTS, SAMPLE_WEIGHT_FACTORS, SAMPLE_CV_TEXT, tailored_skills=EMPTY_SHELL
    )
    real = calculate_ats_score(
        SAMPLE_FACTS, SAMPLE_WEIGHT_FACTORS, SAMPLE_CV_TEXT,
        tailored_skills=SAMPLE_FACTS["skills"],
    )
    assert shelled["score_breakdown"]["skills_match"] == real["score_breakdown"]["skills_match"]
    assert shelled["score_breakdown"]["skills_match"] > 0


def test_empty_skills_shell_still_renders_the_skills_section():
    """The other half of the same bug: the delivered CV lost its skills."""
    from utils.cv_context import build_cv_context

    state = {
        "facts_json": SAMPLE_FACTS,
        "cv_language": "en",
        "profile_name_en": "Test Candidate",
        "tailored_skills": EMPTY_SHELL,
    }
    rendered = build_cv_context(state)["skills"]
    total = sum(len(v) for v in rendered.values() if isinstance(v, list))
    assert total == 4, f"expected the 4 real parsed skills to render, got {total}"


def test_bm25_matching_survives_document_length():
    """
    The old cosine layer collapsed from 0.289 at 10 tokens to 0.007 at 800,
    so it never fired on a real CV. A keyword genuinely present must match at
    any realistic length.
    """
    from utils.ats_scorer import bm25_match_rate

    filler = " ".join(["led project delivered report analysis team"] * 120)  # ~840 tokens
    for text in ["python engineer", "python " + filler]:
        rate, matched = bm25_match_rate(["Python"], text)
        assert matched == ["Python"], f"missed in a {len(text.split())}-token document"

    # And a word that simply isn't there must still miss.
    _, matched = bm25_match_rate(["Kubernetes"], "python " + filler)
    assert matched == []


def test_bm25_gives_partial_phrase_credit():
    from utils.ats_scorer import phrase_coverage, _stem_counts

    cv = "Interpreted clinical variants and documented the interpretation."
    counts, length = _stem_counts(cv)
    assert phrase_coverage("clinical variant interpretation", counts, length) >= 0.6
    assert phrase_coverage("HIPAA compliance auditing", counts, length) < 0.6


def test_education_is_field_agnostic():
    """A non-software exact-field match must reach 1.0; it used to cap at 0.5."""
    from utils.ats_scorer import education_match_score

    def score(req, degree):
        return education_match_score(req, {"education": [{"degree": degree}]})

    assert score("BSc Computer Science", "BSc Computer Science") == 1.0
    assert score("BSc Nursing", "BSc Nursing") == 1.0
    assert score("PhD in Molecular Biology or Genetics", "PhD Molecular Biology and Genetics") == 1.0
    assert score("Bachelor degree in Accounting", "BSc Accounting") == 1.0
    # An unrelated degree must NOT beat an exact match, which is what the old
    # "related/equivalent" branch did (0.8 vs 0.5).
    assert score("BSc Computer Science or equivalent", "BSc Molecular Biology") < \
           score("BSc Nursing", "BSc Nursing")
    # A requirement naming NO field asks only that a degree exists, so any
    # degree satisfies it fully — that is correct, not a bug.
    assert score("Bachelor degree or equivalent", "BSc Molecular Biology") == 1.0
    # "ai" must no longer substring-match the "ai" inside "training".
    assert score("BSc Computer Science or equivalent training", "BSc Molecular Biology") < 1.0


def test_experience_uses_real_durations_not_entry_count():
    """One long role must beat many short ones — the inversion that existed."""
    from utils.ats_scorer import experience_years_match, total_experience_years

    long_role = {"experience": [{"company": "A", "title": "X", "dates": "Jan 2014 - Dec 2024", "bullets": []}]}
    many_short = {"experience": [{"company": f"C{i}", "title": "X", "dates": "2021", "bullets": []}
                                 for i in range(16)]}
    assert experience_years_match(5, long_role) == 1.0
    assert experience_years_match(5, long_role) > experience_years_match(5, many_short)

    years, measured = total_experience_years(long_role)
    assert measured and 10.5 <= years <= 11.5

    # Concurrent roles are counted once, not twice.
    overlapping = {"experience": [
        {"company": "A", "title": "X", "dates": "2015 - 2020", "bullets": []},
        {"company": "B", "title": "Y", "dates": "2017 - 2020", "bullets": []},
    ]}
    years, _ = total_experience_years(overlapping)
    assert years <= 6.5, f"overlapping roles double-counted: {years}"

    # Unparseable dates fall back rather than scoring zero.
    unreadable = {"experience": [{"company": "A", "title": "X", "dates": "sometime", "bullets": []}] * 4}
    assert experience_years_match(5, unreadable) > 0


def test_title_and_seniority_are_scored():
    from utils.ats_scorer import title_match_score

    senior_nurse = {"experience": [{"title": "Senior Registered Nurse"}]}
    assert title_match_score("Registered Nurse", "senior", senior_nurse) > 0.9
    # Right role, wrong level scores below an exact level match.
    assert title_match_score("Registered Nurse", "lead", senior_nurse) < \
           title_match_score("Registered Nurse", "senior", senior_nurse)
    # Wrong role entirely.
    assert title_match_score("Frontend Engineer", "senior", senior_nurse) < 0.5
    # No title in the JD is not a failure.
    assert title_match_score("", "", senior_nurse) == 1.0


def test_preferred_skills_add_credit_but_never_penalise():
    facts = {"education": [], "experience": [], "projects": [],
             "skills": {"languages": ["Python"], "tools": ["Docker"]}}
    base = dict(SAMPLE_WEIGHT_FACTORS, required_skills=["Python", "Docker"],
                ats_keywords_high=[], ats_keywords_medium=[], preferred_skills=[])
    full = calculate_ats_score(facts, base, "Python and Docker.", tailored_skills=facts["skills"])

    with_pref = calculate_ats_score(facts, dict(base, preferred_skills=["Kubernetes"]),
                                    "Python and Docker.", tailored_skills=facts["skills"])
    assert with_pref["score_breakdown"]["skills_match"] == full["score_breakdown"]["skills_match"], \
        "missing an optional skill must not reduce the skills score"

    partial = dict(base, required_skills=["Python", "Docker", "Kubernetes"])
    without = calculate_ats_score(facts, partial, "Python and Docker.", tailored_skills=facts["skills"])
    lifted = calculate_ats_score(facts, dict(partial, preferred_skills=["Python"]),
                                 "Python and Docker.", tailored_skills=facts["skills"])
    assert lifted["score_breakdown"]["skills_match"] > without["score_breakdown"]["skills_match"]


def test_keyword_and_skill_evidence_is_not_double_counted():
    from utils.ats_scorer import _dedupe_keywords

    assert _dedupe_keywords(["React", "cross-functional"], ["react"]) == ["cross-functional"]
    # When every keyword is also a skill there is nothing left for the keyword
    # component to say, and it must not award free points for that.
    facts = {"education": [], "experience": [], "projects": [], "skills": {"languages": []}}
    wf = {"required_skills": ["React"], "preferred_skills": [], "ats_keywords_high": ["React"],
          "ats_keywords_medium": [], "education_requirement": "", "years_experience_required": 0,
          "job_title": "", "seniority_level": ""}
    result = calculate_ats_score(facts, wf, "No relevant content here.")
    assert result["ats_score"] < 50


def test_scorer_survives_null_optional_fields():
    """
    A CV whose education has no stated degree and whose job has no dates.
    Both are ordinary, both arrive as None from FactsJSON.model_dump(), and
    both used to crash the whole scoring node after the user had paid.
    """
    facts = {
        "education": [{"institution": "KAU", "degree": None, "gpa": None}],
        "experience": [{"company": "Acme", "title": "Analyst", "dates": None, "bullets": []}],
        "skills": {"tools": ["Excel"]},
        "projects": [],
    }
    result = calculate_ats_score(facts, SAMPLE_WEIGHT_FACTORS, "Analyst who used Excel.")
    assert 0 <= result["ats_score"] <= 100


def test_full_ats_score():
    result = calculate_ats_score(SAMPLE_FACTS, SAMPLE_WEIGHT_FACTORS, SAMPLE_CV_TEXT)
    assert 0 <= result["ats_score"] <= 100
    assert "score_breakdown" in result
    assert "missing_skills" in result
    print(f"\nATS Score: {result['ats_score']}")
    print(f"   Breakdown: {result['score_breakdown']}")
    print(f"   Missing: {result['missing_skills']}")