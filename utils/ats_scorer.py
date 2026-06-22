# utils/ats_scorer.py
"""
ATS Score calculation logic.
Handles exact keyword matching + semantic matching via cosine similarity.
Claude (Agent 5) handles the reasoning layer on top of this.
"""

import re
from math import sqrt


# ─── WEIGHTS (from roadmap) ──────────────────────────────────────────────────
WEIGHTS = {
    "keyword_match":    0.40,
    "skills_match":     0.35,
    "education_match":  0.15,
    "experience_match": 0.10,
}


# ─── TEXT UTILITIES ───────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokenize(text: str) -> list[str]:
    return normalize(text).split()


# ─── EXACT KEYWORD MATCHING ───────────────────────────────────────────────────

def exact_keyword_match_rate(
    keywords: list[str],
    cv_text: str
) -> tuple[float, list[str], list[str]]:
    """
    Check which keywords appear verbatim (case-insensitive) in the CV text.
    Returns: (rate 0-1, matched list, unmatched list)
    """
    matched = []
    unmatched = []
    cv_lower = normalize(cv_text)

    for kw in keywords:
        if normalize(kw) in cv_lower:
            matched.append(kw)
        else:
            unmatched.append(kw)

    rate = len(matched) / len(keywords) if keywords else 1.0
    return rate, matched, unmatched


# ─── SIMPLE SEMANTIC MATCHING (TF-IDF cosine, no external models) ─────────────

def _build_vocab(docs: list[list[str]]) -> list[str]:
    vocab = set()
    for doc in docs:
        vocab.update(doc)
    return sorted(vocab)


def _tf(tokens: list[str], vocab: list[str]) -> list[float]:
    count = {t: tokens.count(t) for t in vocab}
    total = len(tokens) or 1
    return [count[v] / total for v in vocab]


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    mag_a = sqrt(sum(a ** 2 for a in vec_a))
    mag_b = sqrt(sum(b ** 2 for b in vec_b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def semantic_keyword_match_rate(
    keywords: list[str],
    cv_text: str,
    threshold: float = 0.35
) -> tuple[float, list[str]]:
    """
    Semantic similarity between each keyword and the full CV text using cosine.
    No external embedding model needed — pure Python TF-IDF vectors.
    Returns: (rate 0-1, list of semantically matched keywords)
    """
    cv_tokens = tokenize(cv_text)
    matched = []

    for kw in keywords:
        kw_tokens = tokenize(kw)
        vocab = _build_vocab([kw_tokens, cv_tokens])
        vec_kw = _tf(kw_tokens, vocab)
        vec_cv = _tf(cv_tokens, vocab)
        sim = cosine_similarity(vec_kw, vec_cv)
        if sim >= threshold:
            matched.append(kw)

    rate = len(matched) / len(keywords) if keywords else 1.0
    return rate, matched


def combined_keyword_rate(
    high_keywords: list[str],
    medium_keywords: list[str],
    cv_text: str
) -> tuple[float, list[str], list[str]]:
    """
    Combines exact + semantic matching across high/medium priority keywords.
    High keywords weighted 2x vs medium.
    Returns: (weighted_rate 0-1, all_matched, all_unmatched)
    """
    # Exact pass first
    exact_rate_h, matched_h, unmatched_h = exact_keyword_match_rate(high_keywords, cv_text)
    exact_rate_m, matched_m, unmatched_m = exact_keyword_match_rate(medium_keywords, cv_text)

    # Semantic pass on what exact missed
    sem_rate_h, sem_matched_h = semantic_keyword_match_rate(unmatched_h, cv_text)
    sem_rate_m, sem_matched_m = semantic_keyword_match_rate(unmatched_m, cv_text)

    all_matched = list(set(matched_h + matched_m + sem_matched_h + sem_matched_m))
    all_keywords = list(set(high_keywords + medium_keywords))
    all_unmatched = [k for k in all_keywords if k not in all_matched]

    # Weight: high keywords count double
    total_high = len(high_keywords)
    total_medium = len(medium_keywords)
    matched_high_count = len([k for k in all_matched if k in high_keywords])
    matched_medium_count = len([k for k in all_matched if k in medium_keywords])

    weighted_score = (
        (matched_high_count * 2) + matched_medium_count
    ) / ((total_high * 2 + total_medium) or 1)

    return min(weighted_score, 1.0), all_matched, all_unmatched


# ─── SKILLS MATCH ─────────────────────────────────────────────────────────────

def required_skills_match_rate(
    required_skills: list[str],
    facts_json: dict
) -> tuple[float, list[str], list[str]]:
    """
    Check required skills against the skills section of facts_json.
    Returns: (rate 0-1, matched, missing)
    """
    all_candidate_skills = []
    skills = facts_json.get("skills", {})
    for category in skills.values():
        if isinstance(category, list):
            all_candidate_skills.extend([normalize(s) for s in category])

    matched = []
    missing = []
    for skill in required_skills:
        if normalize(skill) in all_candidate_skills:
            matched.append(skill)
        else:
            # Semantic fallback — check if similar skill exists
            _, sem_match = semantic_keyword_match_rate(
                [skill],
                " ".join(all_candidate_skills),
                threshold=0.5
            )
            if sem_match:
                matched.append(skill)
            else:
                missing.append(skill)

    rate = len(matched) / len(required_skills) if required_skills else 1.0
    return rate, matched, missing


# ─── EDUCATION MATCH ──────────────────────────────────────────────────────────

def education_match_score(
    education_requirement: str,
    facts_json: dict
) -> float:
    """
    Simple heuristic: does the candidate's degree field match the requirement?
    Returns 0.0, 0.5, or 1.0.
    """
    if not education_requirement:
        return 1.0

    education = facts_json.get("education", [])
    if not education:
        return 0.0

    req_norm = normalize(education_requirement)
    for edu in education:
        degree = normalize(edu.get("degree", ""))
        if any(term in req_norm for term in ["computer science", "ai", "artificial intelligence",
                                              "software", "engineering", "data"]):
            if any(term in degree for term in ["artificial intelligence", "computer", "software",
                                                "data", "engineering"]):
                return 1.0
        # Related field
        if "related" in req_norm or "equivalent" in req_norm:
            return 0.8
    return 0.5  # Has a degree but field match uncertain


# ─── EXPERIENCE YEARS MATCH ───────────────────────────────────────────────────

def experience_years_match(
    years_required: int,
    facts_json: dict
) -> float:
    """
    Estimate candidate's years of experience from facts_json.
    Returns 0-1 score.
    """
    if not years_required or years_required == 0:
        return 1.0

    experience = facts_json.get("experience", [])
    # Count distinct years mentioned across all roles
    year_pattern = re.compile(r"\b(20\d{2})\b")
    years_found = set()
    for exp in experience:
        for bullet in exp.get("bullets", []):
            years_found.update(year_pattern.findall(bullet))
        dates = exp.get("dates", "")
        years_found.update(year_pattern.findall(dates))

    # Projects also count as partial experience
    projects = facts_json.get("projects", [])
    estimated_years = max(len(experience) * 0.5, len(years_found) * 0.3, len(projects) * 0.2)
    estimated_years = round(min(estimated_years, 10), 1)

    if estimated_years >= years_required:
        return 1.0
    elif estimated_years >= years_required * 0.7:
        return 0.7
    elif estimated_years >= years_required * 0.5:
        return 0.5
    else:
        return 0.3


# ─── FINAL ATS SCORE ─────────────────────────────────────────────────────────

def calculate_ats_score(
    facts_json: dict,
    weight_factors: dict,
    tailored_cv_text: str  # Full text of the tailored CV (bullets joined)
) -> dict:
    """
    Master function. Calculates the full ATS score breakdown.
    Returns the score_breakdown dict that Agent 5 (Claude) uses for gap analysis.
    """
    # 1. Keyword match
    kw_rate, matched_kw, unmatched_kw = combined_keyword_rate(
        high_keywords=weight_factors.get("ats_keywords_high", []),
        medium_keywords=weight_factors.get("ats_keywords_medium", []),
        cv_text=tailored_cv_text
    )

    # 2. Required skills match
    skills_rate, matched_skills, missing_skills = required_skills_match_rate(
        required_skills=weight_factors.get("required_skills", []),
        facts_json=facts_json
    )

    # 3. Education match
    edu_score = education_match_score(
        education_requirement=weight_factors.get("education_requirement", ""),
        facts_json=facts_json
    )

    # 4. Experience years match
    exp_score = experience_years_match(
        years_required=weight_factors.get("years_experience_required", 0),
        facts_json=facts_json
    )

    # 5. Weighted total
    ats_score = int(round(
        (kw_rate    * WEIGHTS["keyword_match"]   +
         skills_rate * WEIGHTS["skills_match"]    +
         edu_score   * WEIGHTS["education_match"] +
         exp_score   * WEIGHTS["experience_match"]) * 100
    ))

    return {
        "ats_score": ats_score,
        "score_breakdown": {
            "keyword_match":    int(kw_rate * 100),
            "skills_match":     int(skills_rate * 100),
            "education_match":  int(edu_score * 100),
            "experience_match": int(exp_score * 100),
        },
        "matched_keywords": matched_kw,
        "unmatched_keywords": unmatched_kw,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
    }