from pydantic import BaseModel
from typing import List

class TailoredBullet(BaseModel):
    original: str        # The original bullet from facts_json
    tailored: str        # The rewritten version using JD keywords
    relevance_score: float  # 0.0 to 1.0 — how relevant to this JD

class TailoredCV(BaseModel):
    professional_summary: str
    bullets: List[TailoredBullet]