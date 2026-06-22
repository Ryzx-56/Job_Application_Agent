import pytest

from schemas.facts_schema import FactsJSON

# Valid CV — all tests below share `parsed_cv` (one Gemini call for this file)


def test_returns_facts_json_instance(parsed_cv):
    assert isinstance(parsed_cv, FactsJSON)


def test_name_is_always_extracted(parsed_cv):
    assert parsed_cv.personal.name is not None
    assert parsed_cv.personal.name.strip() != ""


def test_all_list_fields_are_lists(parsed_cv):
    """
    Every list field must be a list — never None.
    Downstream agents loop over these and will crash on None.
    """
    assert isinstance(parsed_cv.education, list)
    assert isinstance(parsed_cv.experience, list)
    assert isinstance(parsed_cv.projects, list)
    assert isinstance(parsed_cv.certifications, list)
    assert isinstance(parsed_cv.languages_spoken, list)
    assert isinstance(parsed_cv.volunteer_work, list)
    assert isinstance(parsed_cv.awards, list)
    assert isinstance(parsed_cv.skills.languages, list)
    assert isinstance(parsed_cv.skills.frameworks, list)
    assert isinstance(parsed_cv.skills.tools, list)
    assert isinstance(parsed_cv.skills.soft_skills, list)
    assert isinstance(parsed_cv.skills.other, list)


def test_languages_not_confused(parsed_cv):
    """
    Programming languages must be under skills.languages.
    Human languages must be under languages_spoken.
    They must never be mixed.
    """
    known_programming = {
        "python", "java", "javascript", "typescript", "c++", "c#", "r",
        "sql", "kotlin", "swift", "go", "rust", "php", "ruby", "scala",
        "matlab", "bash", "html", "css",
    }
    known_human_languages = {
        "arabic", "english", "french", "spanish", "german", "italian",
        "chinese", "japanese", "korean", "portuguese", "turkish", "hindi",
        "urdu", "farsi", "russian", "dutch",
    }

    for lang in parsed_cv.skills.languages:
        assert lang.lower() not in known_human_languages, (
            f"Human language '{lang}' found in skills.languages"
        )

    for lang in parsed_cv.languages_spoken:
        assert lang.lower() not in known_programming, (
            f"Programming language '{lang}' found in languages_spoken"
        )


def test_print_full_output(parsed_cv):
    """Manual review test — prints the full extracted JSON."""
    print("\n--- FULL FACTS JSON ---")
    print(parsed_cv.model_dump_json(indent=2))
    assert parsed_cv is not None


# Edge case CV — skipped by default (second Gemini call). Run: pytest -m minimal_cv

@pytest.mark.minimal_cv
def test_minimal_cv_does_not_crash(parsed_minimal_cv):
    """
    A CV with only a name and no other sections should still parse
    without crashing. All optional fields default to empty lists.
    """
    assert isinstance(parsed_minimal_cv, FactsJSON)
    assert parsed_minimal_cv.personal.name.strip() != ""

    assert parsed_minimal_cv.experience == []
    assert parsed_minimal_cv.projects == []
    assert parsed_minimal_cv.certifications == []
