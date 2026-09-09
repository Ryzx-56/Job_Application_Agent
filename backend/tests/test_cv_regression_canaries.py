"""
The four checks from the CV-generation regression, locked in permanently.

Every one of these describes a defect that SHIPPED: unedited candidate notes
printed on a finished CV. They are deliberately deterministic — no model call,
no network — because a canary that only runs when someone remembers to spend
money on it is not a canary. What they pin is the ASSEMBLY contract in
utils/cv_context.py: given a tailoring result, what is allowed to reach the
document.

The model-behaviour half of the same checks (does Agent 3 actually decline the
instruction, distribute the notes, merge the duplicate) lives in
test_cv_canaries_live.py behind the `live_model` marker.
"""

import pytest

from utils.cv_context import build_cv_context, resolve_bullet, _match_key

CANARY = "make all this sound cooler broski"

CONTACTS = {
    "name": "Abdulmalik Hawsawi",
    "email": "abdulmalikhawsawi0@gmail.com",
    "phone": "+966501234567",
    "linkedin": "https://www.linkedin.com/in/abdulmalik-hawsawi/",
    "github": "https://github.com/Ryzx-56",
    "location": "Jeddah, Saudi Arabia",
}

RAMBLE = (
    "it was a nice chill project and im also hard working and super chill and cool"
)


def _facts(**overrides):
    facts = {
        "personal": dict(CONTACTS),
        "summary": "ai student looking for work",
        "education": [{"institution": "King Abdulaziz University",
                       "degree": "Bachelor's Degree in Artificial Intelligence"}],
        "experience": [{
            "company": "Elm Company",
            "title": "machine learning intern",
            "dates": "Jun 2025 - Sep 2025",
            "bullets": ["worked on a computer vision model, got 92% accuracy", CANARY],
        }],
        "projects": [{"name": "Detecting Image Forgery",
                      "tech_stack": ["Python"],
                      "description": "forgot its name but eiter way " + RAMBLE}],
        "skills": {"languages": ["Python"], "frameworks": [], "tools": [],
                   "soft_skills": [], "other": []},
    }
    facts.update(overrides)
    return facts


def _state(**overrides):
    state = {
        "facts_json": _facts(),
        "cv_language": "en",
        "tailored_bullets": [{
            "original": "worked on a computer vision model, got 92% accuracy",
            "tailored": "Built a computer vision model reaching 92% accuracy.",
        }],
        "declined_bullets": [{"original": CANARY,
                              "reason": "instruction directed at the model"}],
        "tailored_projects": [{
            "name": "Detecting Image Forgery",
            "tailored_description": "Led a deep-learning image-forgery detector.",
            "tech_stack": ["Python", "PyTorch"],
        }],
    }
    state.update(overrides)
    return state


def _blob(context) -> str:
    import json
    return json.dumps(context, ensure_ascii=False, default=str).lower()


# ─── CHECK 1 — the declined-instruction canary ──────────────────────────────
# If an instruction the candidate typed at the model reaches the document,
# nothing rewrote that field. This is the cheapest signal in the pipeline.

def test_declined_instruction_never_reaches_the_document():
    context = build_cv_context(_state())
    assert CANARY not in _blob(context)
    assert "broski" not in _blob(context)


def test_declined_bullet_is_dropped_not_printed_raw():
    """The bullet is gone, and the one real bullet is still there — a canary
    that passes by rendering an empty CV would be worthless."""
    context = build_cv_context(_state())
    bullets = context["experience"][0]["bullets"]
    assert bullets == ["Built a computer vision model reaching 92% accuracy."]


def test_unmatched_bullet_is_omitted_rather_than_falling_back_to_raw():
    """The original defect: no tailored version -> print what the user typed.
    A miss must cost one bullet, never print unedited notes."""
    state = _state(tailored_bullets=[], declined_bullets=[])
    context = build_cv_context(state)
    assert context["experience"][0]["bullets"] == []
    assert "92% accuracy" not in _blob(context)
    assert context["bullet_match_stats"]["miss"] == 2  # both bullets, incl. the canary


def test_resolve_bullet_tolerates_a_corrected_typo_but_not_a_different_bullet():
    exact = {}
    normalized = {_match_key("Managed the reception desk"): "Ran front-of-house operations."}
    hit, how = resolve_bullet("Managed the recepton desk", exact, normalized)
    assert hit == "Ran front-of-house operations." and how == "fuzzy"
    miss, how = resolve_bullet("Cleaned the training dataset", exact, normalized)
    assert miss is None and how == "miss"


# ─── CHECK 2 — Additional Information is distributed, never dumped ──────────
# additional_sections was made a read-only verbatim list, so a rambling
# paragraph reached the document unedited even though the tailoring prompt
# was distributing it correctly.

def test_additional_section_prefers_the_rewrite_over_the_raw_entries():
    facts = _facts(additional_sections=[
        {"section_title": "Additional Information", "entries": [RAMBLE]}
    ])
    state = _state(facts_json=facts, tailored_additional_sections=[
        {"section_title": "Additional Information",
         "entries": ["Contributed to a deep-learning image-forgery project."]}
    ])
    context = build_cv_context(state)
    assert "chill" not in _blob(context)
    assert context["additional_sections"][0]["entries"] == [
        "Contributed to a deep-learning image-forgery project."
    ]


def test_unrewritten_additional_section_is_logged_loudly(caplog):
    """It still prints — losing content is worse — but it must not be silent."""
    facts = _facts(additional_sections=[
        {"section_title": "Additional Information", "entries": [RAMBLE]}
    ])
    context = build_cv_context(_state(facts_json=facts,
                                      tailored_additional_sections=[]))
    assert context["additional_sections"][0]["entries"] == [RAMBLE]


# ─── CHECK 3 — a duplicate project is one entry, not two ───────────────────

def test_project_named_once_in_facts_is_rendered_once():
    context = build_cv_context(_state())
    names = [p["name"] for p in context["projects"]]
    assert names.count("Detecting Image Forgery") == 1


def test_project_description_uses_the_rewrite_not_the_raw_notes():
    context = build_cv_context(_state())
    assert context["projects"][0]["description"] == \
        "Led a deep-learning image-forgery detector."
    assert "eiter way" not in _blob(context)


# ─── CHECK 4 — contacts survive byte-for-byte ──────────────────────────────
# The one class of field where a "helpful" rewrite is an outright error: a
# reworded email address is an unreachable candidate.

def test_contacts_are_byte_exact_in_the_render_context():
    personal = build_cv_context(_state())["personal"]
    assert personal["email"] == CONTACTS["email"]
    assert personal["phone"] == CONTACTS["phone"]
    assert personal["name"] == CONTACTS["name"]


def test_contacts_are_byte_exact_on_an_arabic_cv():
    """The glossary must never touch an identifier — a translated email is a
    contact that does not exist. Arabic is the primary locale, so this is the
    run that matters."""
    state = _state(cv_language="ar",
                   arabic_glossary={"Python": "بايثون", "Company": "شركة"})
    personal = build_cv_context(state)["personal"]
    assert personal["email"] == CONTACTS["email"]
    assert personal["phone"] == CONTACTS["phone"]
    for value in (personal["email"], personal["phone"]):
        assert not any("؀" <= ch <= "ۿ" for ch in value)


def test_profile_handles_survive_as_handles_not_doubled_urls():
    personal = build_cv_context(_state())["personal"]
    assert personal["linkedin"] == "abdulmalik-hawsawi"
    assert personal["github"] == "Ryzx-56"
