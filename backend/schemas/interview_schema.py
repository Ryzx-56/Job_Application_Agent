# schemas/interview_schema.py
#
# The Interview Prep add-on's contract: what agents/interview_prep.py returns
# and what frontend/src/components/interview-ui.tsx renders.
#
# NOT A CONVERSATION. No chat, no scoring, no per-question state: a request
# in, one immutable set of questions out. That set IS saved (one row per CV,
# see supabase/migrations/010_interview_preps.sql) so returning to the page
# reopens it instead of spending another monthly generation, but it is a
# document, not a session.
#
# LANGUAGE: unlike the LinkedIn add-on (English always, because that is how
# LinkedIn is read), these follow the language the READER asked for, which is
# the site language at generation time. An English CV read on an Arabic page
# produces Arabic questions; the model translates the CV as it goes and the
# purity pass in agents/interview_prep.py catches anything left in Latin.
from typing import List, Literal, Optional

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
    # The spoken answer. Generous, because this is the part the candidate
    # actually reads and rehearses from, and a clipped answer is worse than
    # a long one.
    "answer_paragraph": 1800,
    "star_part": 600,
    "evidence": 120,
    "gap_honesty": 600,
    "overview": 500,
}


class InterviewStarAnswer(BaseModel):
    """The four STAR beats, as a SUMMARY of the written answer.

    Demoted deliberately: four disconnected fragments are not something a
    person can say out loud, so `answer_paragraph` is now the answer and
    this is the glance-at-it-while-preparing version of the same facts. It
    must not introduce anything the paragraph does not already say.

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

    # How to frame the answer, in one or two sentences. Strategy, not content.
    answer_angle: str = ""
    # THE ANSWER ITSELF: a flowing first-person paragraph the candidate can
    # read and recognise as something they could say. This is what they
    # rehearse from.
    answer_paragraph: str = ""
    # The same answer compressed to four labelled beats, shown underneath as
    # a summary. Empty when the CV supports no example (gap questions).
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
    # WHICH LANGUAGE TO WRITE IN. The site's current language, because that
    # is the language the person is reading the page in and therefore the
    # one they asked for. Falls back to the CV's language when absent, which
    # is what an older client sends. Anything other than "ar" means English.
    language: Optional[str] = None
