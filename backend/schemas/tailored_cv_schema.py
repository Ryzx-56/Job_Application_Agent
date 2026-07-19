from pydantic import BaseModel, field_validator
from typing import List, Optional


class TailoredBullet(BaseModel):
    original: str        # The original bullet from facts_json
    tailored: str         # The rewritten version using JD keywords

    # Optional + defaulted: relevance_score isn't consumed by any scoring
    # logic (ats_scorer.py computes the real ATS score independently;
    # match_scorer.py does its own judgment) — it only rides along to the
    # API response. A single missing or malformed score from the LLM should
    # never invalidate an otherwise-good tailored CV and trigger a full,
    # costly regeneration in tailoring_engine.py. Clamped rather than
    # bounded with Field(ge/le=...) so an out-of-range value (e.g. 1.2) gets
    # corrected instead of also failing validation.
    relevance_score: Optional[float] = 0.5

    @field_validator("relevance_score")
    @classmethod
    def _clamp_relevance_score(cls, v):
        if v is None:
            return 0.5
        return max(0.0, min(1.0, v))


class TailoredCV(BaseModel):
    professional_summary: str
    bullets: List[TailoredBullet]
