"""
Section 4's rules, as checks rather than prompt text.

Every defect pinned here had an explicit instruction in
TAILORING_SYSTEM_PROMPT telling the model not to do it, and every one of them
reached a finished CV anyway. These are the ones code can decide.
"""

import pytest

from core.fact_checker import issue_names_a_specific_invention
from utils.cv_context import build_cv_context
from utils.cv_validators import (
    MAX_TECH_TAGS,
    clean_skill_list,
    clean_skills,
    clean_tech_stack,
    is_dataset_or_platform,
    is_filler,
    normalize_degree,
)


# ─── 4a.1 — datasets and platforms are not skills ──────────────────────────

@pytest.mark.parametrize("value", ["CASIA 2", "casia2", "Kaggle", "ImageNet",
                                   "COCO", "MNIST", "GLUE", "Papers With Code"])
def test_datasets_and_platforms_are_rejected(value):
    assert is_dataset_or_platform(value)


@pytest.mark.parametrize("value", ["Pandas", "PyTorch", "Kaggle Grandmaster",
                                   "Docker", "Computer Vision", "Scikit-learn"])
def test_real_skills_and_credentials_survive(value):
    """Matched on the whole entry, never as a substring — "Kaggle" goes,
    "Kaggle Grandmaster" is a real credential and stays."""
    assert not is_dataset_or_platform(value)
    assert clean_skill_list([value]) == [value]


def test_the_exact_observed_failure():
    """`Tools: API Integration, Multi-agent System, Pandas, CASIA 2, Kaggle`
    — from real output in the blind comparison."""
    assert clean_skill_list(
        ["API Integration", "Multi-agent System", "Pandas", "CASIA 2", "Kaggle"]
    ) == ["API Integration", "Multi-agent System", "Pandas"]


# ─── 4a.2 — filler tags ────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["Programming", "Coding", "Technology",
                                   "Other", "Computer Skills", "General"])
def test_filler_terms_are_rejected(value):
    assert is_filler(value)


def test_cleaning_preserves_shape_and_order():
    """Callers rely on all five categories existing, empty or not, and the
    model puts the most relevant skill first."""
    out = clean_skills({"languages": ["Python", "SQL"], "frameworks": [],
                        "tools": ["Git", "Kaggle", "Programming", "Git"],
                        "soft_skills": [], "other": []})
    assert set(out) == {"languages", "frameworks", "tools", "soft_skills", "other"}
    assert out["tools"] == ["Git"]
    assert out["languages"] == ["Python", "SQL"]


# ─── 4a.5 — long tag strings break the template layout ─────────────────────

def test_tech_tags_are_capped_so_the_project_title_cannot_wrap():
    tags = clean_tech_stack(["Python", "PyTorch", "OpenCV", "NumPy", "Pandas",
                             "Matplotlib", "Seaborn", "Jupyter", "CUDA"])
    assert len(tags) <= MAX_TECH_TAGS
    assert len(", ".join(tags)) <= 70


def test_capping_trims_the_tail_not_the_head():
    """The model returns the most relevant first."""
    assert clean_tech_stack(["Python", "PyTorch", "OpenCV", "NumPy", "Pandas",
                             "Matplotlib", "Seaborn"])[0] == "Python"


# ─── Degree normalisation — a validator, because the prompt rule did not hold ──

@pytest.mark.parametrize("raw,expected", [
    ("Bachelor degree in Artificial Intelligence", "Bachelor's Degree in Artificial Intelligence"),
    ("bachelors degree in CS", "Bachelor's Degree in CS"),
    ("Masters degree in Data Science", "Master's Degree in Data Science"),
    ("Bachelor of Science in Computer Science", "Bachelor of Science in Computer Science"),
    ("PhD in Physics", "PhD in Physics"),
])
def test_degree_spelling_is_fixed_without_changing_the_qualification(raw, expected):
    assert normalize_degree(raw) == expected


def test_an_arabic_degree_is_left_alone():
    arabic = "بكالوريوس في الذكاء الاصطناعي"
    assert normalize_degree(arabic) == arabic


def test_an_unrecognised_degree_is_returned_untouched():
    """Inventing a qualification is the worst thing this pipeline can do, so
    an unfixed typo is always the better error."""
    assert normalize_degree("Licenciatura en Informatica") == "Licenciatura en Informatica"


def test_the_degree_validator_runs_at_render_time():
    context = build_cv_context({
        "facts_json": {"personal": {"name": "A"},
                       "education": [{"institution": "KAU",
                                      "degree": "Bachelor degree in AI"}]},
        "cv_language": "en"})
    assert context["education"][0]["degree"] == "Bachelor's Degree in AI"


# ─── 4b — the missing-projects gap ─────────────────────────────────────────

def _state_with_notes_project():
    return {
        "facts_json": {"personal": {"name": "A"},
                       "projects": [{"name": "Detecting Image Forgery"}]},
        "cv_language": "en",
        "tailored_projects": [{"name": "Detecting Image Forgery",
                               "display_name": "Detecting Image Forgery",
                               "tailored_description": "Built a forgery detector.",
                               "tech_stack": ["Python"]}],
        "new_projects": [{"display_name": "Tarshih",
                          "tailored_description": "Built a multi-agent CV platform.",
                          "tech_stack": ["Next.js", "FastAPI"]}],
    }


def test_a_project_described_only_in_the_notes_reaches_the_projects_section():
    """All six models in the blind comparison failed this identically, which
    is what proved it was structural: the prompt had no branch that creates a
    project, and this loop only iterated facts_json.projects."""
    names = [p["name"] for p in build_cv_context(_state_with_notes_project())["projects"]]
    assert names == ["Detecting Image Forgery", "Tarshih"]


def test_the_candidates_own_structured_projects_come_first():
    projects = build_cv_context(_state_with_notes_project())["projects"]
    assert projects[0]["name"] == "Detecting Image Forgery"


def test_a_notes_project_needs_both_a_name_and_something_to_say():
    state = _state_with_notes_project()
    state["new_projects"] = [{"display_name": "Tarshih", "tailored_description": "  "},
                             {"display_name": "", "tailored_description": "x"}]
    assert len(build_cv_context(state)["projects"]) == 1


def test_a_notes_project_is_not_printed_twice_if_it_also_matched():
    state = _state_with_notes_project()
    state["new_projects"] = [{"display_name": "Detecting Image Forgery",
                              "tailored_description": "dupe", "tech_stack": []}]
    names = [p["name"] for p in build_cv_context(state)["projects"]]
    assert names == ["Detecting Image Forgery"]


# ─── Project descriptions are never the candidate's raw notes ──────────────

def test_an_unrewritten_project_loses_its_description_rather_than_printing_raw():
    """Same rule as resolve_bullet. This was the same bug on a different
    field, and unlike the bullet path it did not even log."""
    context = build_cv_context({
        "facts_json": {"personal": {"name": "A"},
                       "projects": [{"name": "P",
                                     "description": "forgot its name but eiter way"}]},
        "cv_language": "en", "tailored_projects": []})
    assert context["projects"][0]["description"] == ""


# ─── The fact checker's own evidence standard, enforced ────────────────────

@pytest.mark.parametrize("issue", [
    "feels exaggerated", "the tone is too strong", "cannot be fully verified",
    "wording differs from the source", "this is generic and vague", "", None,
])
def test_a_verdict_naming_nothing_is_not_a_finding(issue):
    """The prompt lists these by name as invalid reasons to fail. Nothing
    enforced that, so they cost a regeneration round and then a bullet."""
    assert not issue_names_a_specific_invention(issue)


@pytest.mark.parametrize("issue", [
    "invented the metric 92% which is absent from the facts",
    "claims a tool (Kubernetes) not present in the facts",
    'states "led a team of 12" but no headcount appears anywhere',
])
def test_a_verdict_naming_something_specific_still_fails_the_bullet(issue):
    assert issue_names_a_specific_invention(issue)
