"""
The skills-inference rule is shared by the CV tailoring prompt and the
LinkedIn About box, and it must not be possible to weaken one without the
other.

This exists because it already happened once, silently. linkedin_generator
used to obtain the rule with
`TAILORING_SYSTEM_PROMPT.index("MISSING/EMPTY SKILLS")`. The heading was
renamed to "MISSING/EMPTY/IRRELEVANT SKILLS", the lookup raised, and the
module fell back to a four-line paraphrase behind a WARNING nobody read. The
only symptom was LinkedIn profiles being held to a weaker evidence standard
than CVs — invisible in the output.
"""

import pytest

from agents.tailoring_engine import SKILLS_INFERENCE_RULE, TAILORING_SYSTEM_PROMPT
from agents.linkedin_generator import (
    LINKEDIN_SYSTEM_PROMPT,
    _shared_skills_inference_rule,
)


def test_the_rule_is_a_real_constant_with_real_content():
    assert SKILLS_INFERENCE_RULE.strip(), "the shared rule is empty"
    assert "traceable to a specific sentence" in SKILLS_INFERENCE_RULE, \
        "the evidence-traceability requirement is the whole point of this rule"


def test_the_tailoring_prompt_actually_carries_the_rule():
    assert SKILLS_INFERENCE_RULE in TAILORING_SYSTEM_PROMPT
    assert "<<" not in TAILORING_SYSTEM_PROMPT, \
        "an unsubstituted placeholder is being sent to the model"


def test_the_linkedin_prompt_carries_the_same_rule_not_a_paraphrase():
    """The em-dash normalisation is the only permitted difference."""
    assert _shared_skills_inference_rule() in LINKEDIN_SYSTEM_PROMPT
    assert _shared_skills_inference_rule() == \
        SKILLS_INFERENCE_RULE.replace(" — ", ", ").strip()
    assert "<<" not in LINKEDIN_SYSTEM_PROMPT


def test_there_is_no_silent_fallback_left():
    """A fallback is how the last regression hid. Importing the module must
    fail outright if the rule is gone, not degrade to a shorter prompt."""
    import agents.linkedin_generator as lg

    assert not hasattr(lg, "_SKILLS_RULE_FALLBACK"), \
        "a fallback prompt is back — that is what made the last drift invisible"
    assert not hasattr(lg, "_SKILLS_RULE_START")
