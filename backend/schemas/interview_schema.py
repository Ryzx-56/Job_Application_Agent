# schemas/interview_schema.py
#
# The Interview Prep add-on's contract: what agents/interview_prep.py returns
# and what frontend/src/components/interview-ui.tsx renders.
#
# ONE-SHOT BY DESIGN. There is no conversation, no scoring, no stored session.
# A request in, a set of questions out, held in the page's React state until
# the user leaves. Nothing here is written to a table, which is why this
# feature needed no migration.
#
# LANGUAGE: unlike the LinkedIn add-on (English always, because that's how
# LinkedIn is read), every string here follows the SOURCE CV's language. A
# person who generated an Arabic CV is preparing for an Arabic interview, so
# Arabic output is the correct answer, not a fallback. See the purity pass in
# agents/interview_prep.py.
from typing import List, Literal

from pydantic import BaseModel, Field

# HOW MANY QUESTIONS. The brief is "more than 10", so 10 is the floor a run
# has to clear, not the target: the prompt asks for TARGET and the model is
# told MAX is the ceiling. MIN is what _postprocess checks before declaring
# the generation usable, so a short answer fails loudly instead of quietly
# shipping 6 questions to someone preparing for an interview.
QUESTION_COUNT_MIN = 10
QUESTION_COUNT_TARGET = 12
QUESTION_COUNT_MAX = 15

# The four buckets, as stored. These are machine-read enum values and stay in
# English in both languages; the UI maps them to translated labels the same
# way gap_analysis's "required"/"preferred" already works in match_scorer.py.
InterviewCategory = Literal["behavioral", "technical", "role_specific", "gap"]

CATEGORIES: tuple[str, ...] = ("behavioral", "technical", "role_specific", "gap")

# At least this many gap questions, when the CV/JD comparison actually found
# gaps. Gap questions are the ones a candidate is least likely to have
# rehearsed and the reason this feature is worth more than a generic question
# list, so the prompt is told not to let them get crowded out.
GAP_QUESTIONS_MIN = 2

# Per-field caps, applied server-side after generation. Nothing here is
# pasted anywhere, so these exist to keep a card readable rather than to
# satisfy an external system's limit.
CONTENT_LIMITS = {
    "question": 400,
    "why_asked": 400,
    "jd_hook": 160,
    "answer_angle": 400,
    "star_part": 600,
    "evidence": 120,
    "gap_honesty": 600,
    "overview": 500,
}


class InterviewStarAnswer(BaseModel):
    """The suggested answer, in the four STAR beats.

    Built strictly from what the CV actually contains. The fact rule is the
    same one the tailoring pipeline enforces: a beat with no evidence behind
    it is left empty rather than invented, because a candidate who rehearses
    a fabricated result will say it out loud in a real interview.
    """
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""

    def is_empty(self) -> bool:
        return not any(
            part.strip() for part in (self.situation, self.task, self.action, self.result)
        )


class InterviewQuestion(BaseModel):
    """One question card.

    `category` and the field names are machine-read and stay English; every
    value the user reads follows the CV's language.
    """
    question: str = ""
    category: InterviewCategory = "behavioral"

    # Why this question is likely to come up, tied to something specific in
    # the job description rather than to interviewing in general.
    why_asked: str = ""
    # The JD requirement it comes from, quoted short so the card can show the
    # link between the posting and the question at a glance.
    jd_hook: str = ""

    # One or two sentences on how to frame the answer, then the STAR beats.
    answer_angle: str = ""
    star: InterviewStarAnswer = Field(default_factory=InterviewStarAnswer)
    # Which real CV items the answer draws on (project names, employers,
    # roles). Rendered as chips so the candidate can see the answer is built
    # from their own record and check it before rehearsing.
    cv_evidence: List[str] = Field(default_factory=list)

    # GAP QUESTIONS ONLY: the honest way to handle a requirement the CV does
    # not demonstrate. Never a way to claim the requirement is met. Empty on
    # every other category.
    gap_honesty: str = ""


class InterviewPrepContent(BaseModel):
    """Everything the results view renders for one CV."""
    # A short read on what this specific interview will turn on. Not a
    # summary of the questions, which the user can see for themselves.
    overview: str = ""
    questions: List[InterviewQuestion] = Field(default_factory=list)

    # Provenance, so the page can label the result and so support can tell
    # which CV a screenshot came from.
    role: str = ""
    company: str = ""
    language: str = "en"
    # True when the JD analysis came from the saved generation (the normal
    # case) rather than from re-running jd_analyzer on a legacy row.
    reused_stored_analysis: bool = True


class InterviewPrepRequest(BaseModel):
    """Which of the caller's own CVs to prepare from. Ownership is verified
    server-side; a resume id belonging to someone else 404s."""
    resume_id: str
