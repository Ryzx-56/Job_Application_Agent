# utils/arabic_localizer.py
"""
Shared Arabic localization for the CV, the raw extracted facts, and the
cover letter.

WHY A GLOSSARY INSTEAD OF RE-GENERATING THE DOCUMENT
----------------------------------------------------
The previous Arabic purity fix sent the ENTIRE tailored JSON back to Claude
and asked for a fully translated copy. That had three problems:

  1. Cost — it re-emitted every field to fix a handful of stray words, and on
     a long CV the response was large enough to truncate, which meant the
     corrective pass was paid for and then discarded.
  2. Risk — a full re-emission can silently reshape the JSON, drop a bullet,
     or reword a claim that had already passed fact-checking.
  3. Coverage — it only ever saw tailoring_engine's GENERATED fields. The
     rendered CV also contains raw facts_json values that no agent
     translates: employer names, university names, degree titles,
     certifications, the candidate's city. Those stayed in English on every
     Arabic CV no matter how well the purity pass worked.

This module instead extracts the distinct Latin terms actually present,
asks for ONE small term -> term glossary, and applies it by deterministic
string replacement. The response is a few hundred tokens instead of
thousands, the document structure is untouchable by construction, no claim
can be reworded, and the same glossary localizes the CV, the facts, and the
cover letter consistently — so the same tool never appears as "بايثون" in
one document and "Python" in the other.

WHAT DELIBERATELY STAYS IN LATIN SCRIPT
---------------------------------------
Emails, URLs, and social handles are identifiers, not prose. Translating
them breaks them. They're excluded from extraction here, and the callers
additionally never feed those fields in. Everything else is fair game.
"""

import json
import re
from loguru import logger

from core.llm_config import generate_claude_text

# One "term" is a run of Latin words: letters, digits, and the punctuation
# that legitimately appears INSIDE a technology name (Next.js, Scikit-learn,
# C++, C#, Node.js). Capturing multi-word runs ("Multi Agent Systems") rather
# than single words matters — a term translated as a phrase reads far better
# in Arabic than three independently translated words.
_TERM_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#]*(?:[.\-][A-Za-z0-9+#]+)*(?:\s+[A-Za-z][A-Za-z0-9+#]*(?:[.\-][A-Za-z0-9+#]+)*)*")

# Anything matching these is an identifier and must survive byte-for-byte.
_IDENTIFIER_RE = re.compile(r"(https?://|www\.|@|\.com|\.net|\.org|\.io|\.sa)", re.IGNORECASE)

# Whole emails / URLs / handles, matched so they can be REMOVED before term
# extraction runs. Testing the extracted term alone isn't enough: _TERM_RE
# splits "abdulmalikhawsawi0@gmail.com" at the "@" and hands back the bare
# local part "abdulmalikhawsawi0", which contains no identifier marker and
# would sail through the per-term check into the glossary. Same for "https"
# out of a URL and "Ryzx-56" out of a GitHub path.
_IDENTIFIER_SPAN_RE = re.compile(
    r"""(
        https?://\S+                                   # full URLs
      | www\.\S+                                       # bare www. hosts
      | [A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}   # emails
      | \b[A-Za-z0-9.\-]+\.(?:com|net|org|io|sa|co|dev|ai)(?:/\S*)?  # domains + paths
    )""",
    re.IGNORECASE | re.VERBOSE,
)

# Single Latin letters (a degree's "B" in "B.Sc", an initial) aren't worth a
# glossary entry and translating them in isolation produces nonsense.
_MIN_TERM_LEN = 2

GLOSSARY_PROMPT = """You are translating individual CV terms from English into Modern Standard Arabic.

For EACH term below, give the Arabic equivalent that a professional Arabic CV would actually use:
  - Technology, framework, language and tool names: use the established Arabic rendering if one exists,
    otherwise a standard Arabic transliteration (e.g. "Python" -> "بايثون", "React" -> "رياكت").
  - Acronyms: translate the expanded meaning (e.g. "API" -> "واجهة برمجة التطبيقات",
    "ML" -> "التعلم الآلي").
  - Company, university and organization names: transliterate into Arabic script
    (e.g. "TeamLab" -> "تيم لاب"). Do not translate the meaning of a brand name.
  - Degrees, job titles and field names: translate the meaning
    (e.g. "B.Sc. Artificial Intelligence" -> "بكالوريوس العلوم في الذكاء الاصطناعي").
  - Cities and countries: use the standard Arabic name (e.g. "Jeddah" -> "جدة").

RULES:
  - Every value must be entirely in Arabic script. No Latin characters in any value.
  - Return a translation for EVERY term given, with the key EXACTLY as provided.
  - Do not add terms that were not asked for.
  - Never return an empty string as a value.

TERMS:
{terms}

Return ONLY a JSON object mapping each original term to its Arabic equivalent, no markdown:
{{"Python": "بايثون", "Jeddah": "جدة"}}
"""


def _is_translatable(term: str) -> bool:
    stripped = term.strip()
    if len(stripped.replace(" ", "")) < _MIN_TERM_LEN:
        return False
    if _IDENTIFIER_RE.search(stripped):
        return False
    return True


def iter_strings(value):
    """Yields every string inside an arbitrarily nested dict/list structure."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from iter_strings(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from iter_strings(v)


def find_latin_terms(strings) -> list[str]:
    """
    Distinct Latin terms across the given strings, longest first.

    Longest-first ordering is what makes replacement safe later: replacing
    "Machine Learning" before "Learning" prevents a half-translated
    "Machine التعلم" from ever being produced.
    """
    seen: dict[str, None] = {}
    for text in strings:
        if not text or not isinstance(text, str):
            continue
        # Blank out emails/URLs/domains first so their internal fragments
        # never become glossary terms — see _IDENTIFIER_SPAN_RE.
        cleaned = _IDENTIFIER_SPAN_RE.sub(" ", text)
        for match in _TERM_RE.findall(cleaned):
            term = match.strip().strip(".-")
            if _is_translatable(term) and term not in seen:
                seen[term] = None
    return sorted(seen.keys(), key=len, reverse=True)


def whole_latin_values(strings, max_words: int = 10) -> list[str]:
    """
    Short field values that are ENTIRELY Latin — a degree, an employer, a
    university, a certification — returned as complete units.

    These are seeded into the glossary alongside the sub-terms found by
    find_latin_terms so a value translates as one coherent phrase.
    "B.Sc. Artificial Intelligence" handled as a unit becomes
    "بكالوريوس العلوم في الذكاء الاصطناعي"; handled as the fragments _TERM_RE
    produces ("B.Sc", "Artificial Intelligence") it becomes
    "بكالوريوس. الذكاء الاصطناعي", which is understandable but reads like a
    machine assembled it. Because apply_glossary substitutes longest-first,
    the whole value always wins over its own fragments.

    Capped by word count so a whole sentence never becomes a "term" —
    these are field values, not prose.
    """
    out: dict[str, None] = {}
    for text in strings:
        if not text or not isinstance(text, str):
            continue
        value = text.strip()
        if not value or len(value.split()) > max_words:
            continue
        if _IDENTIFIER_SPAN_RE.search(value):
            continue
        # Entirely Latin/ASCII-punctuation: no Arabic already mixed in.
        if not re.fullmatch(r"[A-Za-z0-9 .,\-&/()+#']+", value):
            continue
        if not re.search(r"[A-Za-z]{2,}", value):
            continue
        out.setdefault(value, None)
    return list(out.keys())


def build_glossary(terms: list[str], on_usage=None, max_terms: int = 120) -> dict[str, str]:
    """
    One Claude call turning Latin terms into Arabic equivalents. Returns
    {} on any failure — callers treat an empty glossary as "leave the text
    as it is" rather than failing the run, matching the best-effort
    philosophy the rest of the Arabic path already uses.

    max_terms caps a pathological CV from producing an enormous prompt; the
    terms are longest-first, so the cap drops the least significant ones.
    """
    if not terms:
        return {}

    capped = terms[:max_terms]
    try:
        raw = generate_claude_text(
            GLOSSARY_PROMPT.format(terms=json.dumps(capped, ensure_ascii=False)),
            max_tokens=6000,
            max_tokens_ceiling=12000,
            on_usage=on_usage,
        )
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
        if not isinstance(data, dict):
            logger.warning("🔤 Glossary response wasn't a JSON object — skipping Arabic term localization.")
            return {}

        glossary = {}
        for term, translation in data.items():
            if not isinstance(term, str) or not isinstance(translation, str):
                continue
            translation = translation.strip()
            # Reject a "translation" that is still Latin — otherwise a
            # passthrough answer would be applied as if it were a fix, and
            # the leak would look resolved when it isn't.
            if not translation or _TERM_RE.fullmatch(translation):
                continue
            glossary[term] = translation

        logger.info(f"🔤 Arabic glossary built: {len(glossary)}/{len(capped)} terms translated.")
        return glossary
    except Exception as e:
        logger.error(f"🔤 Failed to build Arabic glossary: {e} — leaving Latin terms as-is.")
        return {}


def apply_glossary(text: str, glossary: dict[str, str]) -> str:
    """
    Deterministic term replacement. Case-insensitive and whole-term only, so
    "Python" inside "Pythonic" is left alone.

    Identifiers (emails/URLs) are protected: any string that IS one is
    returned untouched. Callers should also simply not pass identifier
    fields in.
    """
    if not text or not glossary or not isinstance(text, str):
        return text
    if _IDENTIFIER_RE.search(text):
        return text

    result = text
    # Longest first — see find_latin_terms.
    for term in sorted(glossary.keys(), key=len, reverse=True):
        translation = glossary[term]
        pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", re.IGNORECASE)
        result = pattern.sub(lambda _m: translation, result)
    return result


def localize_structure(value, glossary: dict[str, str], skip_keys: tuple[str, ...] = ()):
    """
    Recursively applies the glossary to every string in a nested structure,
    returning a NEW structure (never mutates the input).

    skip_keys names dict keys whose values must be left exactly as they are —
    used for bullets[].original, which is ground-truth source text that the
    fact checker matches against and must never be translated.
    """
    if isinstance(value, str):
        return apply_glossary(value, glossary)
    if isinstance(value, dict):
        return {
            k: (v if k in skip_keys else localize_structure(v, glossary, skip_keys))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [localize_structure(v, glossary, skip_keys) for v in value]
    return value


def remaining_latin_terms(value, glossary: dict[str, str] | None = None) -> list[str]:
    """Latin terms still present after localization — used for logging and
    for deciding whether a second pass is worth making."""
    return find_latin_terms(iter_strings(value))


# ─── DATES ──────────────────────────────────────────────────────────────────
# Month names and digits are a CONTENT decision, not a shaping one, so they
# need explicit translation. This used to live only in pdf_generator.py,
# which meant an Arabic DOCX printed "June 2025 - August 2025" while the PDF
# of the same CV printed "يونيو ٢٠٢٥ - أغسطس ٢٠٢٥". Shared here so both
# generators produce identical text.

EASTERN_ARABIC_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")

MONTH_AR = {
    "january": "يناير", "february": "فبراير", "march": "مارس", "april": "أبريل",
    "may": "مايو", "june": "يونيو", "july": "يوليو", "august": "أغسطس",
    "september": "سبتمبر", "october": "أكتوبر", "november": "نوفمبر", "december": "ديسمبر",
    "jan": "يناير", "feb": "فبراير", "mar": "مارس", "apr": "أبريل",
    "jun": "يونيو", "jul": "يوليو", "aug": "أغسطس", "sep": "سبتمبر",
    "sept": "سبتمبر", "oct": "أكتوبر", "nov": "نوفمبر", "dec": "ديسمبر",
    "present": "حتى الآن", "current": "حتى الآن", "ongoing": "حتى الآن",
    "to": "إلى", "now": "حتى الآن",
}

# Longest first so "sept" wins over "sep" and "june" over "jun".
_MONTH_RE = re.compile(
    r"\b(" + "|".join(sorted(MONTH_AR, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def to_eastern_arabic_numerals(text: str) -> str:
    return (text or "").translate(EASTERN_ARABIC_DIGITS)


def translate_date_terms(date_str: str) -> str:
    """Month names and Present/Current/Ongoing -> Arabic. Idempotent: run it
    on already-translated text and nothing matches, so it's safe if a caller
    ends up applying it twice."""
    if not date_str:
        return date_str
    return _MONTH_RE.sub(lambda m: MONTH_AR[m.group(1).lower()], str(date_str))


def localize_date(date_str: str) -> str:
    """Month names translated AND digits transliterated — what a date field
    on an Arabic CV should look like."""
    if not date_str:
        return date_str
    return to_eastern_arabic_numerals(translate_date_terms(str(date_str)))
