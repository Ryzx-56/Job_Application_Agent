# schemas/output_schema.py
from pydantic import BaseModel, Field
from typing import Optional


class GapItem(BaseModel):
    skill: str
    importance: str          # "required" | "preferred"
    how_to_close: str


class ScoreBreakdown(BaseModel):
    keyword_match:    int = Field(ge=0, le=100)
    skills_match:     int = Field(ge=0, le=100)
    education_match:  int = Field(ge=0, le=100)
    experience_match: int = Field(ge=0, le=100)


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