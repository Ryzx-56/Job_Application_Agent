from pydantic import BaseModel, Field
from typing import List, Optional


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
