# utils/ats_scorer.py
"""
ATS Score calculation logic.
Handles exact keyword matching + semantic matching via cosine similarity.
Claude (Agent 5) handles the reasoning layer on top of this.
"""

import re
from datetime import date

from utils.skills import resolve_skills


# ─── WEIGHTS ─────────────────────────────────────────────────────────────────
#
# WAS: keyword 0.40, skills 0.35, education 0.15, experience 0.10.
#
# Two things were wrong with that split. Keywords outweighed skills, which is
# backwards from how real matching engines rank — skills carry the dominant
# weight in commercial ATS scoring because a skill is the most concrete,
# checkable claim on a CV. And the two components scored THE SAME EVIDENCE
# TWICE: jd_analyzer routinely puts "React" in required_skills and in
# ats_keywords_high, so a single matched skill moved 75% of the score
# between them while an unmatched one was punished twice over.
#
# The double-count is fixed at the source (see _dedupe_keywords) rather than
# by shrinking the keyword weight to compensate, so keywords now measure what
# only they can measure: the JD language that is NOT already a named skill.
#
# title_match is new — see title_match_score for why its absence was the
# largest gap against real ATS behaviour.
WEIGHTS = {
    "skills_match":     0.40,
    "keyword_match":    0.25,
    "title_match":      0.15,
    "experience_match": 0.12,
    "education_match":  0.08,
}


# ─── TEXT UTILITIES ───────────────────────────────────────────────────────────

def normalize(text) -> str:
    """
    Lowercase, strip punctuation, collapse whitespace.

    ACCEPTS None AND NON-STRINGS ON PURPOSE. Everything this module scores
    arrives from a Pydantic model_dump(), and model_dump() emits every
    Optional field it knows about — including the unset ones, as None. That
    makes `d.get("degree", "")` a trap: the default only fires when the KEY
    IS ABSENT, and the key is never absent here, so an education entry with
    no stated degree handed this function None and it died on .lower().

    That was not hypothetical. A CV with one education entry lacking a
    degree, or one job lacking dates — both entirely ordinary — crashed
    calculate_ats_score outright, which takes down the whole scoring node
    AFTER every agent has run and the user's credit is spent. Same bug class
    utils/cv_context.py's `_s()` documents; this is that guard, for the
    scorer.
    """
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokenize(text: str) -> list[str]:
    return normalize(text).split()


# ─── KEYWORD-VARIANT RECOGNITION ──────────────────────────────────────────────
# These two helpers exist to catch keywords the candidate genuinely has —
# just phrased slightly differently (a different grammatical form, or a
# common abbreviation vs its spelled-out form) — that a strict substring
# match would otherwise miss and undercount. Neither of these adds or
# infers anything the candidate didn't actually write; they only recognize
# different real forms of the same real content.

_COMMON_SUFFIXES = ("ing", "ers", "er", "es", "ed", "s")


def _stem(word: str) -> str:
    """
    Lightweight suffix stripping so a genuine grammatical variant of a
    keyword still counts as a match — e.g. CV says "developed" or
    "developing", JD keyword is "develop"/"development". Deliberately
    conservative: only strips a suffix if at least 3 characters remain, to
    avoid mangling short real words.
    """
    w = word.lower()
    for suf in _COMMON_SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[: -len(suf)]
    return w


# Common abbreviation <-> full-term pairs. Recognizing "JS" as a match for
# a JD asking for "JavaScript" (or vice versa) isn't fabrication — it's the
# same real skill, just written differently on each side. Keep this list to
# genuinely unambiguous, widely-standard equivalents only.
_KNOWN_EQUIVALENTS: dict[str, set[str]] = {
    "javascript": {"js"}, "js": {"javascript"},
    "typescript": {"ts"}, "ts": {"typescript"},
    "machine learning": {"ml"}, "ml": {"machine learning"},
    "artificial intelligence": {"ai"}, "ai": {"artificial intelligence"},
    "natural language processing": {"nlp"}, "nlp": {"natural language processing"},
    "user interface": {"ui"}, "ui": {"user interface"},
    "user experience": {"ux"}, "ux": {"user experience"},
    "database": {"db"}, "db": {"database"},
    "application programming interface": {"api"}, "api": {"application programming interface"},
    "continuous integration": {"ci"}, "ci": {"continuous integration"},
    "continuous deployment": {"cd"}, "cd": {"continuous deployment"},
    "object oriented programming": {"oop"}, "oop": {"object oriented programming"},
    "structured query language": {"sql"}, "sql": {"structured query language"},
}


def _stemmed_phrase_match(kw_norm: str, cv_token_stems: set[str]) -> bool:
    """True if every stemmed word in the (normalized) keyword phrase is
    present somewhere in the CV's stemmed tokens — i.e. the candidate used
    a different grammatical form of every word in the keyword."""
    kw_stems = {_stem(t) for t in kw_norm.split() if t}
    return bool(kw_stems) and kw_stems.issubset(cv_token_stems)


# ─── EXACT KEYWORD MATCHING ───────────────────────────────────────────────────

def exact_keyword_match_rate(
    keywords: list[str],
    cv_text: str
) -> tuple[float, list[str], list[str]]:
    """
    Check which keywords appear verbatim (case-insensitive) in the CV text,
    or as a recognized grammatical variant / known equivalent term (see
    _stem and _KNOWN_EQUIVALENTS above — both only recognize real content
    the candidate already wrote, never invented content).
    Returns: (rate 0-1, matched list, unmatched list)
    """
    matched = []
    unmatched = []
    cv_lower = normalize(cv_text)
    cv_token_stems = {_stem(t) for t in cv_lower.split()}

    for kw in keywords:
        kw_norm = normalize(kw)

        if kw_norm in cv_lower:
            matched.append(kw)
            continue

        equivalents = _KNOWN_EQUIVALENTS.get(kw_norm, set())
        if any(eq in cv_lower for eq in equivalents):
            matched.append(kw)
            continue

        if _stemmed_phrase_match(kw_norm, cv_token_stems):
            matched.append(kw)
            continue

        unmatched.append(kw)

    rate = len(matched) / len(keywords) if keywords else 1.0
    return rate, matched, unmatched


# ─── PARTIAL-PHRASE MATCHING (BM25 term weighting) ────────────────────────────
#
# WHAT WAS HERE, AND WHY IT WAS REPLACED. This used to be a raw
# term-frequency cosine between a keyword vector and a whole-CV vector, and
# it could not fire. Cosine against a bag-of-words document shrinks as the
# document grows, because the document vector's magnitude grows with it —
# measured, for a keyword the CV genuinely contains:
#
#     CV length   10    50    100   200   400   800  tokens
#     cosine      0.289 0.092 0.050 0.026 0.014 0.007
#
# against a 0.35 threshold. Every real CV is 200+ tokens, so the "semantic"
# pass matched nothing on any document a user has ever submitted. It was
# dead weight that made the pipeline look more capable than it was.
#
# BM25's term weighting is the standard fix and solves exactly the two
# problems: SATURATION (the tenth mention of "Python" adds almost nothing
# over the second, so keyword-stuffed CVs gain no advantage) and LENGTH
# NORMALISATION (a long CV is not penalised for being long).
#
# NOT CALLED "SEMANTIC" ANY MORE, because it is not. BM25 is lexical: it
# matches the words that are actually there, in any grammatical form via the
# stemmer. What it adds over the exact pass is PARTIAL CREDIT FOR PARTIAL
# PHRASES — a JD asking for "clinical variant interpretation" against a CV
# that says "interpreted variants clinically" now scores as strong coverage
# instead of a flat miss. Nothing is inferred and nothing is invented; the
# words are the candidate's own.

BM25_K1 = 1.5    # saturation: how fast repeated mentions stop helping
BM25_B = 0.75    # how strongly to normalise for document length
BM25_AVG_DOC_TOKENS = 500  # a typical tailored CV body, the reference length

# What one honest mention in an average-length CV is worth. Every term score
# is expressed as a fraction of this, so "present once, normally" reads as
# 1.0 and the scale is interpretable rather than an arbitrary BM25 magnitude.
def _bm25_term_weight(freq: int, doc_len: int) -> float:
    if freq <= 0:
        return 0.0
    norm = 1 - BM25_B + BM25_B * (doc_len / BM25_AVG_DOC_TOKENS)
    return (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * norm)


_BM25_SINGLE_MENTION = _bm25_term_weight(1, BM25_AVG_DOC_TOKENS)


def phrase_coverage(phrase: str, doc_stem_counts: dict[str, int], doc_len: int) -> float:
    """
    How much of `phrase` the document actually covers, 0-1.

    The mean over the phrase's stemmed words of each word's BM25 weight,
    scaled so a single mention in an average-length CV counts as full credit
    for that word. A two-word phrase with one word present scores ~0.5 —
    partial credit for partial evidence, which is the whole point.
    """
    stems = [_stem(t) for t in normalize(phrase).split() if t]
    if not stems:
        return 0.0
    total = 0.0
    for stem in stems:
        weight = _bm25_term_weight(doc_stem_counts.get(stem, 0), doc_len)
        total += min(1.0, weight / _BM25_SINGLE_MENTION)
    return total / len(stems)


def _stem_counts(text: str) -> tuple[dict[str, int], int]:
    """Stemmed term frequencies for a document, plus its length in tokens."""
    tokens = [_stem(t) for t in tokenize(text)]
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    return counts, len(tokens)


# A phrase is "covered" once most of its words are genuinely present. 0.6
# keeps a two-word phrase needing both words (0.5 alone is not enough) while
# letting a three-word phrase through on two — which is the realistic case
# where a JD pads a skill name with a word the CV words differently.
PHRASE_COVERAGE_THRESHOLD = 0.6


def bm25_match_rate(
    phrases: list[str],
    text: str,
    threshold: float = PHRASE_COVERAGE_THRESHOLD,
) -> tuple[float, list[str]]:
    """
    Which of `phrases` the text covers, by BM25 partial-phrase coverage.
    Returns: (rate 0-1, matched list). Replaces semantic_keyword_match_rate.
    """
    counts, doc_len = _stem_counts(text)
    matched = [p for p in phrases if phrase_coverage(p, counts, doc_len) >= threshold]
    rate = len(matched) / len(phrases) if phrases else 1.0
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
    # Exact pass first (now includes variant/equivalent recognition — see
    # exact_keyword_match_rate above)
    exact_rate_h, matched_h, unmatched_h = exact_keyword_match_rate(high_keywords, cv_text)
    exact_rate_m, matched_m, unmatched_m = exact_keyword_match_rate(medium_keywords, cv_text)

    # BM25 partial-phrase pass on what the exact pass missed. This is the
    # layer that used to be cosine and never fired — see the note above it.
    _, sem_matched_h = bm25_match_rate(unmatched_h, cv_text)
    _, sem_matched_m = bm25_match_rate(unmatched_m, cv_text)

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
    effective_skills: dict
) -> tuple[float, list[str], list[str]]:
    """
    Check required skills against the candidate's skills.

    BUG FIX: this used to always read facts_json.get("skills", {}) directly
    — the RAW, pre-tailoring skills extracted by cv_parser.py. That means
    it completely ignored tailored_skills from tailoring_engine.py, which
    is the actual skills content that ends up rendered on the CV (and,
    since a recent fix, the only place skills get inferred at all for a
    CV that listed none). A CV could look complete with a full Skills
    section and still score 0 here, because this function was scoring
    against what the candidate originally wrote, not what's actually on
    their tailored CV. Caller now passes whichever skills dict is
    actually authoritative (tailored if present, else raw) — see
    calculate_ats_score below.

    Returns: (rate 0-1, matched, missing)
    """
    all_candidate_skills = []
    for category in effective_skills.values():
        if isinstance(category, list):
            all_candidate_skills.extend([normalize(s) for s in category])

    candidate_skill_stems = {_stem(t) for s in all_candidate_skills for t in s.split()}

    matched = []
    missing = []
    for skill in required_skills:
        skill_norm = normalize(skill)

        if skill_norm in all_candidate_skills:
            matched.append(skill)
            continue

        equivalents = _KNOWN_EQUIVALENTS.get(skill_norm, set())
        if any(eq in all_candidate_skills for eq in equivalents):
            matched.append(skill)
            continue

        if _stemmed_phrase_match(skill_norm, candidate_skill_stems):
            matched.append(skill)
            continue

        # BM25 partial-phrase fallback across the candidate's whole skills
        # list. The old cosine version here got HARDER the more skills a
        # candidate listed (0.447 at 5 skills, 0.131 at 35), which punished
        # exactly the people with the most to show. BM25's length term
        # removes that.
        _, sem_match = bm25_match_rate([skill], " ".join(all_candidate_skills))
        if sem_match:
            matched.append(skill)
        else:
            missing.append(skill)

    rate = len(matched) / len(required_skills) if required_skills else 1.0
    return rate, matched, missing


# ─── EDUCATION MATCH ──────────────────────────────────────────────────────────

# Words that describe the LEVEL or the shape of a qualification rather than
# its subject. Stripped from both sides so what remains is the field itself.
_DEGREE_STOPWORDS = {
    "bachelor", "bachelors", "bsc", "bs", "ba", "master", "masters", "msc", "ms", "ma",
    "phd", "doctorate", "doctoral", "mba", "diploma", "degree", "certificate",
    "undergraduate", "postgraduate", "graduate", "honours", "honors",
    "in", "of", "or", "and", "a", "an", "the", "field", "study", "studies",
    "related", "equivalent", "relevant", "similar", "preferred", "required",
    "minimum", "least", "at", "with", "any",
}


def _field_terms(text: str) -> set[str]:
    """The subject words of a degree or a degree requirement, stemmed."""
    return {
        _stem(token)
        for token in normalize(text).split()
        if token and token not in _DEGREE_STOPWORDS and not token.isdigit()
    }


def education_match_score(
    education_requirement: str,
    facts_json: dict
) -> float:
    """
    How well the candidate's best degree matches the requirement's FIELD.

    FIELD-AGNOSTIC, and that is the fix. This used to test the requirement
    against a hardcoded list — "computer science", "software", "data",
    "engineering", "ai" — and the degree against a matching list. Any
    candidate outside software therefore had no path to a full score: a BSc
    Nursing against a nursing requirement, or a PhD Molecular Biology
    against a molecular biology requirement, scored 0.5, the same as "has a
    degree, field unknown". Worse, an UNRELATED degree against a vague
    requirement scored 0.8 — higher than an exact match — because the
    "related/equivalent" branch fired first.

    Now both sides are reduced to their subject words and compared directly,
    so an exact field match reaches 1.0 whatever the field is, and the
    software allowlist is gone. The `ai` entry in that list is also gone,
    which quietly fixes a second bug: it was a substring test, so it matched
    the "ai" inside "tr-ai-ning" and "av-ai-lable".

    Returns 0.0-1.0.
    """
    if not education_requirement:
        return 1.0

    education = facts_json.get("education") or []
    if not education:
        return 0.0

    required = _field_terms(education_requirement)
    req_norm = normalize(education_requirement)
    # "or related field" / "or equivalent" is the requirement explicitly
    # widening itself, so an off-field degree is still acceptable to it.
    accepts_related = "related" in req_norm or "equivalent" in req_norm

    best = 0.0
    for edu in education:
        # `or ""`, not a .get() default — see normalize()'s docstring for why
        # the default never fires on a model_dump()ed Optional field.
        degree_text = " ".join(filter(None, [
            edu.get("degree") or "",
            # Coursework is real evidence of field, and it is the only field
            # signal at all for an entry that lists an institution but no
            # degree title.
            " ".join(edu.get("relevant_coursework") or []),
        ]))
        if not degree_text.strip():
            best = max(best, 0.4 if accepts_related else 0.3)
            continue

        held = _field_terms(degree_text)
        if not required:
            # A requirement with no subject words ("Bachelor's degree") asks
            # only that a degree exists, and one does.
            best = max(best, 1.0)
            continue

        overlap = len(required & held) / len(required)
        if overlap >= 0.6:
            score = 1.0                      # same field
        elif overlap > 0:
            score = 0.75 if accepts_related else 0.65   # adjacent field
        else:
            score = 0.5 if accepts_related else 0.35    # different field
        best = max(best, score)

    return best


# ─── EXPERIENCE YEARS MATCH ───────────────────────────────────────────────────

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_ONGOING = ("present", "current", "ongoing", "now", "today", "date")
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")


def _parse_endpoint(text: str, default_month: int) -> tuple[int, int] | None:
    """(year, month) from one side of a date range, or None if there's no year."""
    year_match = _YEAR_RE.search(text)
    if not year_match:
        return None
    month = default_month
    lowered = text.lower()
    for name, number in _MONTHS.items():
        if name in lowered:
            month = number
            break
    return int(year_match.group(1)), month


def parse_date_range_months(dates: str, today: tuple[int, int] | None = None) -> int | None:
    """
    Length of one role in months, or None when the dates can't be read.

    Handles the shapes cv_parser actually returns: "Jan 2019 - Dec 2024",
    "2017 - 2019", "2014-2024", "Mar 2016 - Present", "2022-Current".
    A single bare date ("2024") has no measurable span and returns None
    rather than a guess.
    """
    text = (dates or "").strip()
    if not text:
        return None

    now = today or (date.today().year, date.today().month)

    # Split on the usual range separators, including the en/em dashes the
    # parser preserves verbatim from the source CV.
    parts = re.split(r"\s*(?:-|–|—|to|until|through)\s*", text, flags=re.IGNORECASE)
    parts = [p for p in parts if p.strip()]
    if not parts:
        return None

    start = _parse_endpoint(parts[0], default_month=1)
    if not start:
        return None

    if len(parts) == 1:
        return None  # a single date is a point, not a span

    tail = " ".join(parts[1:])
    if any(word in tail.lower() for word in _ONGOING):
        end = now
    else:
        # December, so "2017 - 2019" counts as through the end of 2019 —
        # the same reading a human gives a year-only range.
        end = _parse_endpoint(tail, default_month=12)
        if not end:
            return None

    months = (end[0] - start[0]) * 12 + (end[1] - start[1]) + 1
    return months if months > 0 else None


def _merge_months(spans: list[tuple[int, int]]) -> int:
    """Total months covered by these (start, end) absolute-month spans,
    counting overlapping roles once."""
    total = 0
    current_start = current_end = None
    for start, end in sorted(spans):
        if current_end is None or start > current_end + 1:
            if current_end is not None:
                total += current_end - current_start + 1
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_end is not None:
        total += current_end - current_start + 1
    return total


def total_experience_years(facts_json: dict, today: tuple[int, int] | None = None) -> tuple[float, bool]:
    """
    (years, measured) — real elapsed years from the CV's own date ranges.

    `measured` is False when nothing could be parsed, so the caller knows to
    fall back rather than treating 0.0 as "no experience".

    Concurrent roles are merged instead of summed: someone who consulted
    while employed has not lived through both spans twice.
    """
    spans: list[tuple[int, int]] = []
    now = today or (date.today().year, date.today().month)

    for exp in facts_json.get("experience") or []:
        months = parse_date_range_months(exp.get("dates") or "", today=now)
        if months is None:
            continue
        start = _parse_endpoint(re.split(r"\s*(?:-|–|—|to|until|through)\s*",
                                         (exp.get("dates") or "").strip(),
                                         flags=re.IGNORECASE)[0], default_month=1)
        if not start:
            continue
        start_abs = start[0] * 12 + start[1]
        spans.append((start_abs, start_abs + months - 1))

    if spans:
        return round(_merge_months(spans) / 12, 1), True

    # No readable RANGES, but bare years are still real evidence: the span
    # from the earliest to the latest year mentioned bounds the career. This
    # tier matters because without it the caller falls through to counting
    # rows, which is the exact inversion this function exists to remove —
    # sixteen roles all dated "2021" would otherwise read as eight years
    # instead of one.
    years_seen = {
        int(y)
        for exp in facts_json.get("experience") or []
        for y in _YEAR_RE.findall(exp.get("dates") or "")
    }
    if years_seen:
        return float(max(years_seen) - min(years_seen) + 1), True

    return 0.0, False


def experience_years_match(
    years_required: int,
    facts_json: dict
) -> float:
    """
    How much of the required experience the candidate actually has.

    MEASURED FROM DATES, NOT FROM ENTRY COUNT — that inversion was the bug.
    The old version estimated years as `max(len(experience) * 0.5, ...)`, so
    it rewarded having MANY rows rather than having a long career:

        one 10-year role   -> 0.5 "years" -> 0.30   (worst bucket)
        two 6-year roles   -> 1.0 "years" -> 0.30
        sixteen brief roles-> 8.0 "years" -> 1.00   (perfect)

    A twelve-year veteran scored the floor while a job-hopper scored full
    marks. Now the real spans are parsed and merged, and the score is the
    honest fraction of the requirement met. The entry-count heuristic
    survives only as the fallback for a CV whose dates genuinely cannot be
    read, where a rough estimate still beats scoring someone zero.
    """
    if not years_required or years_required == 0:
        return 1.0

    years, measured = total_experience_years(facts_json)

    if not measured:
        experience = facts_json.get("experience") or []
        projects = facts_json.get("projects") or []
        if not experience and not projects:
            return 0.0
        years = min(max(len(experience) * 0.5, len(projects) * 0.2), 10)

    return round(min(1.0, years / years_required), 3)


# ─── JOB TITLE & SENIORITY MATCH ──────────────────────────────────────────────
#
# NEW COMPONENT. jd_analyzer has always produced job_title and
# seniority_level and the scorer read neither, which was the single largest
# gap against how real ATS platforms rank: Workday-style engines weight
# title-and-level match heavily, because a title is the most reliable
# statement of what someone actually did. A CV can carry every keyword in a
# posting and still be the wrong person for it.
#
# This scores the candidate's OWN titles, taken verbatim from their CV. It
# infers nothing about roles they did not hold.

_SENIORITY_RANK = {
    "intern": 0, "internship": 0, "trainee": 0,
    "junior": 1, "entry": 1, "graduate": 1, "assistant": 1,
    "mid": 2, "intermediate": 2, "associate": 2,
    "senior": 3, "sr": 3, "specialist": 3,
    "lead": 4, "principal": 4, "staff": 4, "head": 4, "manager": 4, "director": 4,
}

# Level words are matched separately, so they must not also count as part of
# the title's subject — otherwise "Senior Nurse" vs "Nurse" looks like a
# half-match on the wrong axis.
_TITLE_LEVEL_WORDS = set(_SENIORITY_RANK)


def _seniority_rank(text: str) -> int | None:
    for token in normalize(text).split():
        if token in _SENIORITY_RANK:
            return _SENIORITY_RANK[token]
    return None


def _title_subject(text: str) -> str:
    return " ".join(t for t in normalize(text).split() if t not in _TITLE_LEVEL_WORDS)


def title_match_score(job_title: str, seniority_level: str, facts_json: dict) -> float:
    """
    How close the candidate's real job titles are to the one being applied
    for, on two axes: the ROLE itself and its LEVEL.

    Returns 0.0-1.0, or 1.0 when the JD names no title (nothing to fail).
    """
    if not (job_title or "").strip():
        return 1.0

    titles = [
        str(exp.get("title") or "").strip()
        for exp in (facts_json.get("experience") or [])
        if str(exp.get("title") or "").strip()
    ]
    if not titles:
        return 0.0

    # ROLE: the best partial-phrase coverage of the JD's title across every
    # title the candidate has actually held.
    subject = _title_subject(job_title)
    if subject:
        role = max(
            (phrase_coverage(subject, *_stem_counts(_title_subject(t))) for t in titles),
            default=0.0,
        )
    else:
        role = 1.0  # a title that is only a level, e.g. "Senior"

    # LEVEL: how far apart the two sit on the ladder. The JD's declared
    # seniority_level wins over whatever adjective is in the title string.
    wanted = _seniority_rank(seniority_level or "") or _seniority_rank(job_title)
    held = max((r for r in (_seniority_rank(t) for t in titles) if r is not None), default=None)
    if wanted is None or held is None:
        level = 0.75  # unstated on one side: neither credit nor penalty
    else:
        gap = abs(wanted - held)
        level = {0: 1.0, 1: 0.8, 2: 0.55}.get(gap, 0.3)

    return round(0.7 * min(1.0, role) + 0.3 * level, 3)


# ─── FINAL ATS SCORE ─────────────────────────────────────────────────────────

def _dedupe_keywords(keywords: list[str], skills: list[str]) -> list[str]:
    """
    Drop keywords that are already being scored as skills.

    jd_analyzer emits the same term into both lists constantly ("React" is a
    required skill AND an ats_keyword_high), so without this the same piece
    of evidence is counted twice — rewarded twice when present, punished
    twice when absent. Whatever survives here is the JD's own language that
    is not a named skill, which is the only thing the keyword component can
    tell us that the skills component cannot.
    """
    skill_norms = {normalize(s) for s in skills if normalize(s)}
    return [k for k in keywords if normalize(k) not in skill_norms]


def calculate_ats_score(
    facts_json: dict,
    weight_factors: dict,
    tailored_cv_text: str,  # Full text of the tailored CV (bullets joined)
    tailored_skills: dict | None = None,
) -> dict:
    """
    Master function. Calculates the full ATS score breakdown.
    Returns the score_breakdown dict that Agent 5 (Claude) uses for gap analysis.
    """
    # Prefer tailoring_engine.py's cleaned/inferred skills (what's actually
    # on the rendered CV) over the raw facts_json extraction — see the bug
    # note on required_skills_match_rate above.
    #
    # resolve_skills, not `or`: Agent 3 returns all five categories present
    # and empty when it produced no skills, and that shell is truthy. It won
    # the `or` and zeroed this sub-score against a CV that had 35 real
    # skills on it. See utils/skills.py.
    effective_skills = resolve_skills(tailored_skills, facts_json.get("skills"))

    required = weight_factors.get("required_skills") or []
    preferred = weight_factors.get("preferred_skills") or []

    # 1. Keyword match, over JD language that ISN'T already a scored skill.
    kw_rate, matched_kw, unmatched_kw = combined_keyword_rate(
        high_keywords=_dedupe_keywords(weight_factors.get("ats_keywords_high") or [], required + preferred),
        medium_keywords=_dedupe_keywords(weight_factors.get("ats_keywords_medium") or [], required + preferred),
        cv_text=tailored_cv_text
    )

    # 2. Skills: required in full, preferred at partial credit.
    #
    # preferred_skills were parsed and then thrown away. A JD saying "nice to
    # have: GraphQL" is real, scoreable signal when the candidate genuinely
    # has it — so it now earns credit, at a fifth of the weight of a required
    # skill, and NEVER costs anything when absent: a candidate missing a
    # nice-to-have has not failed a requirement. That asymmetry is why the
    # blend only applies when preferred skills exist at all.
    skills_rate, matched_skills, missing_skills = required_skills_match_rate(
        required_skills=required,
        effective_skills=effective_skills
    )
    preferred_rate, matched_preferred, _ = required_skills_match_rate(
        required_skills=preferred,
        effective_skills=effective_skills
    )
    # Applied to the REMAINING HEADROOM, so a nice-to-have can only ever
    # lift the score toward the requirements the candidate did meet. A blend
    # (0.8*required + 0.2*preferred) would have taken a candidate who met
    # every requirement from 100 down to 90 for lacking an optional extra —
    # penalising them for a skill the JD itself called optional.
    if preferred:
        skills_rate = min(1.0, skills_rate + (1 - skills_rate) * 0.25 * preferred_rate)

    # 3. Education match
    edu_score = education_match_score(
        education_requirement=weight_factors.get("education_requirement", ""),
        facts_json=facts_json
    )

    # 4. Experience, from real date ranges
    exp_score = experience_years_match(
        years_required=weight_factors.get("years_experience_required", 0),
        facts_json=facts_json
    )

    # 5. Title and seniority
    title_score = title_match_score(
        job_title=weight_factors.get("job_title", "") or "",
        seniority_level=weight_factors.get("seniority_level", "") or "",
        facts_json=facts_json,
    )

    # 6. Weighted total.
    #
    # When de-duplication leaves NO keywords to score (every ats_keyword was
    # also a named skill), the keyword component has nothing to say. Scoring
    # it as 1.0 would hand out free points, so its weight is redistributed
    # across the components that do have evidence instead.
    components = {
        "skills_match": skills_rate,
        "keyword_match": kw_rate,
        "title_match": title_score,
        "experience_match": exp_score,
        "education_match": edu_score,
    }
    active = {k: v for k, v in components.items()
              if not (k == "keyword_match" and not (matched_kw or unmatched_kw))}
    total_weight = sum(WEIGHTS[k] for k in active) or 1.0
    ats_score = int(round(
        sum(v * WEIGHTS[k] for k, v in active.items()) / total_weight * 100
    ))

    return {
        "ats_score": ats_score,
        "score_breakdown": {
            "keyword_match":    int(kw_rate * 100),
            "skills_match":     int(skills_rate * 100),
            "title_match":      int(title_score * 100),
            "education_match":  int(edu_score * 100),
            "experience_match": int(exp_score * 100),
            # Sent through so the frontend's "how ATS is calculated" explainer
            # always shows the real weights instead of a hardcoded guess.
            "weights": {k: int(v * 100) for k, v in WEIGHTS.items()},
        },
        "matched_keywords": matched_kw,
        "unmatched_keywords": unmatched_kw,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "matched_preferred_skills": matched_preferred,
    }


# ─── LANGGRAPH NODE WRAPPER ───────────────────────────────────────────────────

def run_ats_scorer(state: dict) -> dict:
    """
    LangGraph node. Wraps calculate_ats_score above — pure Python matching,
    no LLM call, so it's instant and immune to Gemini/Claude rate limits
    or billing issues entirely.
    """
    from loguru import logger

    if state.get("error"):
        return {}

    logger.info("📋 Computing ATS score (keyword + skills + education + experience match)...")

    facts_json       = state.get("facts_json", {}) or {}
    weight_factors   = state.get("weight_factors", {}) or {}
    tailored_bullets = state.get("tailored_bullets", []) or []
    tailored_summary = state.get("tailored_summary", "") or ""

    # IMPORTANT: this must include every piece of text that actually ends up
    # rendered in the CV (see pdf_generator.py), or the score would be capped
    # below what the candidate's real, truthful CV content earns. Previously
    # this only looked at summary + bullets, so keywords Agent 3 correctly
    # surfaced in project descriptions or the skills list were invisible to
    # the scorer even though they're genuinely on the CV.
    tailored_projects = state.get("tailored_projects", []) or []
    tailored_volunteer_work = state.get("tailored_volunteer_work", []) or []
    tailored_skills = state.get("tailored_skills") or {}

    # Fall back to raw facts_json content wherever Agent 3 didn't produce a
    # tailored version (partial failure, etc.) — same fallback pdf_generator.py
    # uses, so the scorer always reflects exactly what's on the actual CV.
    project_text = " ".join(
        p.get("tailored_description", "") for p in tailored_projects
    ) or " ".join(
        (p.get("description") or "") for p in (facts_json.get("projects", []) or [])
    )
    volunteer_text = " ".join(tailored_volunteer_work) or " ".join(
        facts_json.get("volunteer_work", []) or []
    )
    # Same empty-shell trap as in calculate_ats_score — see utils/skills.py.
    skills_source = resolve_skills(tailored_skills, facts_json.get("skills"))
    skills_text = " ".join(
        item
        for category in skills_source.values()
        if isinstance(category, list)
        for item in category
    )

    tailored_cv_text = " ".join(filter(None, [
        tailored_summary,
        " ".join(b.get("tailored", "") for b in tailored_bullets),
        project_text,
        volunteer_text,
        skills_text,
    ]))

    # BUG FIX (Arabic CVs scored 0% keywords / 0% skills):
    #
    # An ATS score is a keyword-overlap measure between the JOB DESCRIPTION
    # and the CV. The job description is written in English; an Arabic CV's
    # rendered text is not. Comparing the two is guaranteed to find nothing,
    # so every Arabic run reported 0% keyword match and 0% skills match and
    # a badly deflated total, regardless of how well the candidate actually
    # fit the role.
    #
    # tailoring_engine.py now keeps the English text it generated before
    # translating it (ats_source_text / ats_source_skills) purely so this
    # comparison stays meaningful. The score then measures what it's
    # supposed to measure — does this CV's CONTENT cover what the JD asks
    # for — instead of measuring which alphabet it's written in.
    #
    # English CVs are completely unaffected: ats_source_text is empty for
    # them, so the branch below is skipped and the rendered text is scored
    # exactly as before.
    scoring_text = tailored_cv_text
    scoring_skills = skills_source
    ats_source_text = (state.get("ats_source_text") or "").strip()
    if ats_source_text:
        scoring_text = ats_source_text
        scoring_skills = state.get("ats_source_skills") or skills_source
        logger.info("📋 Arabic CV — scoring against the pre-translation English text so JD keywords can match.")

    result = calculate_ats_score(facts_json, weight_factors, scoring_text, tailored_skills=scoring_skills)

    logger.info(f"📋 ATS score: {result['ats_score']}/100")

    return {
        "ats_score": result["ats_score"],
        "score_breakdown": {
            **result["score_breakdown"],
            "matched_keywords":   result["matched_keywords"],
            "unmatched_keywords": result["unmatched_keywords"],
            "matched_skills":     result["matched_skills"],
            "missing_skills":     result["missing_skills"],
        },
    }
