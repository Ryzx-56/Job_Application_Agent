from pydantic import BaseModel, Field, field_validator
from typing import Any, List, Optional

class PersonalInfo(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    location: Optional[str] = None
    portfolio: Optional[str] = None    # designers, freelancers often have this

class Education(BaseModel):
    institution: Optional[str] = None
    degree: Optional[str] = None
    gpa: Optional[str] = None
    graduation_year: Optional[str] = None
    distinctions: List[str] = []
    relevant_coursework: List[str] = []  # useful for students with no experience

class Experience(BaseModel):
    company: Optional[str] = None
    title: Optional[str] = None
    dates: Optional[str] = None
    bullets: List[str] = []
    metrics: List[str] = []

class Skills(BaseModel):
    languages: List[str] = []          # not everyone has programming languages
    frameworks: List[str] = []
    tools: List[str] = []
    soft_skills: List[str] = []        # relevant for non-technical roles
    other: List[str] = []              # catch-all for anything that doesn't fit

class Project(BaseModel):
    name: Optional[str] = None
    tech_stack: List[str] = []         # empty for non-technical projects
    description: Optional[str] = None
    metrics: List[str] = []
    url: Optional[str] = None          # portfolio links, GitHub, live demos


# ─── STRING COERCION ────────────────────────────────────────────────────────
#
# Every list below is extracted by an LLM, and an LLM occasionally returns a
# richer shape than it was asked for — an object where a string was
# specified, e.g. {"name": "...", "year": "..."} inside "entries". Pydantic
# would reject that, cv_parser would burn all three of its retries on the
# same disagreement, and the WHOLE run would fail on one badly-shaped list
# item. That trade is wrong: these fields exist so nothing gets dropped, so
# a recoverable shape mismatch must not cost the user their CV.
#
# Flattening is deliberately dumb and lossless — it keeps every value the
# model returned, it never reorders or summarizes, and it never touches a
# plain string (the overwhelmingly common case passes through untouched).
def _flatten_to_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return ", ".join(
            f"{k}: {_flatten_to_text(v)}" if k else _flatten_to_text(v)
            for k, v in value.items() if v not in (None, "", [], {})
        )
    if isinstance(value, (list, tuple)):
        return ", ".join(_flatten_to_text(v) for v in value if v not in (None, "", [], {}))
    return "" if value is None else str(value)


def _coerce_str_list(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    return [text for text in (_flatten_to_text(item).strip() for item in value) if text]


class TrainingCourse(BaseModel):
    """A course, workshop or training programme — distinct from a formal
    certification, which stays in `certifications`."""
    name: Optional[str] = None
    provider: Optional[str] = None      # who ran it
    date: Optional[str] = None          # exactly as written on the CV

class Participation(BaseModel):
    """Conferences, committees, programmes and events the candidate took part
    in. Standard on Saudi and academic/medical CVs, usually split into local
    and international, which `scope` preserves when the CV states it."""
    title: Optional[str] = None
    role: Optional[str] = None          # attendee / speaker / organizer / member
    organization: Optional[str] = None
    scope: Optional[str] = None         # "local" / "international", only if stated
    date: Optional[str] = None

class Publication(BaseModel):
    """A paper, article, chapter or book. `title` carries the whole citation
    verbatim when it can't be split confidently — never drop half a citation
    to make it fit these fields."""
    title: Optional[str] = None
    venue: Optional[str] = None         # journal / conference / publisher
    year: Optional[str] = None
    url: Optional[str] = None

class AdditionalSection(BaseModel):
    """
    THE CATCH-ALL. Any CV section that doesn't map to a named field above,
    kept under its own original heading.

    This is what stops the schema from silently deciding what a CV is allowed
    to contain. A surgeon's procedure counts, a pilot's flight hours, a
    researcher's grant list, a teacher's student outcomes — none of those have
    (or should have) a dedicated field, and before this existed they had
    nowhere to land, so a perfect extraction still lost them.

    `entries` is verbatim source text. Nothing downstream rewrites it: the
    tailoring engine is told explicitly to leave it alone, and the renderers
    print it as-is. That matters because this is exactly where hard factual
    data ends up — "1,240 procedures performed", "4,800 flight hours" — and a
    paraphrased number is a fabricated number.
    """
    section_title: str = ""
    entries: List[str] = []

    # Defaulted rather than required: a heading the model failed to echo back
    # is a formatting miss, and failing the entire extraction over it would
    # throw away the very content this field exists to preserve. The
    # renderers fall back to a generic "Additional Information" heading.
    @field_validator("entries", mode="before")
    @classmethod
    def _entries_as_text(cls, v):
        return _coerce_str_list(v)


class FactsJSON(BaseModel):
    personal: PersonalInfo
    # The candidate's own profile / objective / "about me" paragraph, verbatim.
    # Agent 3 writes the tailored summary that actually gets printed; this is
    # the source it writes FROM, and the fallback when Agent 3 produced none.
    summary: Optional[str] = None
    education: List[Education] = []    # optional — some senior CVs drop this
    experience: List[Experience] = []  # optional — students, career changers
    skills: Skills = Field(default_factory=Skills)
    projects: List[Project] = []       # optional — non-technical users
    certifications: List[str] = []
    languages_spoken: List[str] = []   # human languages, not programming
    volunteer_work: List[str] = []     # common on non-technical CVs
    awards: List[str] = []

    # ── Named fields for content real CVs carry that had nowhere to go ─────
    # Each one is a section that turned up on real submitted CVs and was
    # dropped for lack of a field. They're named rather than left to
    # additional_sections because they're common enough that the scorer and
    # the tailoring engine benefit from addressing them directly.
    major_achievements: List[str] = []
    training_courses: List[TrainingCourse] = []
    participation: List[Participation] = []
    publications: List[Publication] = []
    teaching_and_editorial: List[str] = []   # teaching posts + editorial/review boards

    # ── Everything else, under the CV's own headings ──────────────────────
    additional_sections: List[AdditionalSection] = []

    @field_validator("certifications", "languages_spoken", "volunteer_work",
                     "awards", "major_achievements", "teaching_and_editorial",
                     mode="before")
    @classmethod
    def _string_lists(cls, v):
        return _coerce_str_list(v)
