# schemas/output_schema.py
from pydantic import BaseModel, Field
from typing import Optional


class GapItem(BaseModel):
    skill: str
    importance: str          # "required" | "preferred"
    how_to_close: str


class ScoreBreakdown(BaseModel):
    # Order matches the weights in utils/ats_scorer.py, heaviest first.
    # title_match is the newest factor: the candidate's own job titles against
    # the role applied for, which is weighted heavily by real ATS engines and
    # was previously parsed but never scored.
    skills_match:     int = Field(ge=0, le=100)
    keyword_match:    int = Field(ge=0, le=100)
    title_match:      int = Field(default=0, ge=0, le=100)
    experience_match: int = Field(ge=0, le=100)
    education_match:  int = Field(ge=0, le=100)


class MatchScorerOutput(BaseModel):
    ats_score:              int = Field(ge=0, le=100)
    score_breakdown:        ScoreBreakdown
    matched_keywords:       list[str]
    gap_analysis:           list[GapItem]
    overall_recommendation: str


class FinalOutput(BaseModel):
    ats_score:            int
    score_breakdown:      ScoreBreakdown
    gap_analysis:         list[GapItem]
    overall_recommendation: str
    cv_pdf_path:          Optional[str] = None
    cover_letter_pdf_path: Optional[str] = None
    similar_jobs:         Optional[list[dict]] = None