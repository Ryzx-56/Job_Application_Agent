from pydantic import BaseModel, Field
from typing import List, Optional


# ─── "Unknown" is not a company ─────────────────────────────────────────────
#
# jd_analyzer is instructed to write the literal string "Unknown" into
# `company` when a posting names no employer. Every consumer that treated the
# field as truthy therefore believed in an employer by that name: a cover
# letter addressed to the "Unknown Recruitment Team", "Unknown" printed as the
# recipient, the string handed to the model as the company to write about, and
# a saved resume row filed under it in My Resumes. Found by reading a
# generated letter rather than the code.
#
# Lives here because this is where the field is defined, so the producer and
# every consumer share one definition of "absent".
_PLACEHOLDER_COMPANIES = {
    "unknown", "unknown company", "n/a", "na", "none", "not specified",
    "not mentioned", "not provided", "unspecified", "-", "--",
    "غير معروف", "غير محدد", "غير مذكور",
}


def real_company(value) -> str:
    """The employer's name, or "" when the posting never named one."""
    name = str(value or "").strip()
    return "" if name.casefold() in _PLACEHOLDER_COMPANIES else name


class WeightFactors(BaseModel):
    job_title: str
    company: str
    seniority_level: str  # "junior", "mid", "senior", "lead"
    required_skills: List[str] = Field(default_factory=list)
    preferred_skills: List[str] = Field(default_factory=list)
    years_experience_required: Optional[int] = None
    ats_keywords_high: List[str] = Field(default_factory=list)
    ats_keywords_medium: List[str] = Field(default_factory=list)
    culture_signals: List[str] = Field(default_factory=list)
    education_requirement: Optional[str] = None
    red_flags: List[str] = Field(default_factory=list)
    cover_letter_tone: str
