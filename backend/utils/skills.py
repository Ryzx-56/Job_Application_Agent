# utils/skills.py
"""
Choosing which skills dict is the real one.

WHY THIS EXISTS. Agent 3 does not signal "I produced no skills" by returning
nothing — tailoring_engine.py builds its result by looping over the five
known categories, so a model response with no skills in it still comes back
as:

    {"languages": [], "frameworks": [], "tools": [], "soft_skills": [], "other": []}

which is a NON-EMPTY dict, and therefore truthy. Every downstream site chose
its source with `tailored_skills or facts_json["skills"]`, so that shell won
the `or` and the real, parsed skills were never reached. Two consequences,
both measured:

  · the ATS skills sub-score read 0% instead of 100%, dragging the total
    from 60 to 25, and
  · utils/cv_context.py rendered the CV with NO skills section at all —
    8 real skills silently dropped from the delivered document.

The shape of a dict is the wrong question. What every caller actually means
is "does this contain a skill", so that is what this module answers, in one
place, for the scorer and both generators.
"""


def has_skills(skills) -> bool:
    """True only if `skills` holds at least one non-blank entry."""
    if not isinstance(skills, dict):
        return False
    return any(
        isinstance(items, list) and any(str(item).strip() for item in items)
        for items in skills.values()
    )


def resolve_skills(*candidates) -> dict:
    """
    The first candidate that actually contains a skill, else {}.

    Returning {} rather than the last candidate is deliberate: {} is falsy,
    so a caller that still writes `resolve_skills(...) or something_else`
    keeps working, and "no skills anywhere" stays distinguishable from "an
    empty shell that looked like skills".
    """
    for candidate in candidates:
        if has_skills(candidate):
            return candidate
    return {}
