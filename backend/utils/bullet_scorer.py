from typing import List

def score_bullet(bullet: str, jd_keywords: List[str]) -> float:
    """
    Score a CV bullet against JD keywords.
    Returns a float between 0.0 and 1.0.
    Simple keyword overlap — no embeddings needed at this stage.
    """
    if not jd_keywords:
        return 0.0

    bullet_lower = bullet.lower()
    matches = sum(1 for kw in jd_keywords if kw.lower() in bullet_lower)
    return round(matches / len(jd_keywords), 4)


def rank_bullets(bullets: List[str], jd_keywords: List[str]) -> List[dict]:
    """
    Takes a flat list of bullet strings, scores each one,
    and returns them sorted by relevance (highest first).
    """
    scored = [
        {
            "original": bullet,
            "score": score_bullet(bullet, jd_keywords)
        }
        for bullet in bullets
    ]
    return sorted(scored, key=lambda x: x["score"], reverse=True)