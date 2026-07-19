# agents/document_generator.py
import json
from loguru import logger
from core.state import AgentState
from core.llm_config import generate_claude_text
import anthropic

COVER_LETTER_PROMPT = """
Write a cover letter for {job_title} at {company}.

Tone guidance from JD: {culture_signals}
  - If culture is 'fast-paced startup': write direct, confident, minimal fluff
  - If culture is 'corporate / enterprise': write slightly more formal
  - If culture is 'research / academic': lead with curiosity and depth

Structure (3 paragraphs only, body text ONLY — see HARD RULES below):
  Paragraph 1: Why THIS company specifically. Use the company name.
               Reference something real about them if possible.
  Paragraph 2: 2 specific achievements from FACTS_JSON that
               directly answer the JD requirements.
  Paragraph 3: Short, confident close. No 'I look forward to hearing'.

HARD RULES:
  - Never start with 'I am writing to express my interest' (or the equivalent stock opening in whatever
    language you're writing in)
  - Never use the phrase 'passion for' (or its equivalent)
  - Never write more than 3 paragraphs
  - Every achievement mentioned must come from FACTS_JSON
  - Do NOT include a greeting or salutation line (e.g. "Dear Hiring Manager," / "Dear Hiring Team,").
    Start directly with paragraph 1's content. The document template adds the greeting separately —
    if you include one too, it will appear twice in the final letter.
  - Do NOT include a complimentary close, sign-off, or the candidate's name anywhere in your output
    (e.g. no "Sincerely," and no name at the end). The document template adds this separately. End
    paragraph 3 with the actual closing sentence and stop there, do not add anything after it.
  - Output ONLY the 3 body paragraphs, nothing else, no header, no date, no subject line, no greeting,
    no sign-off.
  - NEVER use em dashes (—) or en dashes as punctuation, anywhere in the letter. This reads as generic
    AI-generated text. Use a comma, period, colon, or "and" instead. Write two sentences if you need to.
    Ordinary hyphens inside compound words are fine (e.g. "well-suited"), just not as a standalone dash.

{language_instruction}

FACTS_JSON: {facts_json}
WEIGHT_FACTORS: {weight_factors}
"""

_AR_COVER_LETTER_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE — READ CAREFULLY:
  - Write the entire letter in Modern Standard Arabic, in natural professional business-letter register,
    not a literal word-for-word translation of a typical English cover letter.
  - FACTS_JSON and WEIGHT_FACTORS may contain English or Arabic text. Regardless of source language,
    write your output entirely in Arabic; do not leave sentences untranslated.
  - Keep company names, product/tool names, and technical terms/acronyms in their original Latin script
    inline (e.g. "Python", "AWS", "React") — this is standard on Arabic business letters. Keep the
    candidate's name as it appears in FACTS_JSON.
  - Numbers and dates stay as normal digits, not spelled out."""

_EN_COVER_LETTER_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE:
  - Write the entire letter in professional English, regardless of what language FACTS_JSON or
    WEIGHT_FACTORS are written in. Translate any non-English source content into natural English."""


_GREETING_PREFIXES = ("dear ", "السادة", "عزيزي", "الأفاضل")
_SIGNOFF_MARKERS = ("sincerely", "regards", "best regards", "مع خالص التقدير", "مع تحياتي", "وتفضلوا بقبول")


def _strip_leaked_greeting_and_signoff(text: str, candidate_name: str) -> str:
    """
    Defensive safety net — mirrors the em-dash stripping below. The prompt
    now tells Claude not to write a greeting/sign-off (the PDF/DOCX template
    already adds both), but LLM output isn't 100% guaranteed to follow that,
    so this catches a leaked "Dear ..." opening paragraph or a leaked
    "Sincerely, {name}" closing paragraph without touching real body content.
    """
    if not text:
        return text

    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    if not paragraphs:
        return text

    # Drop a leading greeting paragraph, e.g. "Dear Hiring Manager,"
    if paragraphs and paragraphs[0].lower().startswith(_GREETING_PREFIXES):
        paragraphs = paragraphs[1:]

    # Drop trailing sign-off paragraph(s): a "Sincerely,"-style line, and/or
    # a short final line that's just the candidate's name (or a fragment of
    # it, e.g. a truncated "S" from a cut-off signature).
    name_norm = (candidate_name or "").strip().lower()
    while paragraphs:
        last = paragraphs[-1].strip().rstrip(",")
        last_lower = last.lower()
        is_signoff_word = any(m in last_lower for m in _SIGNOFF_MARKERS)
        is_name_fragment = bool(last) and len(last) <= max(len(name_norm), 3) and (
            name_norm.startswith(last_lower) or last_lower == name_norm
        )
        if is_signoff_word or is_name_fragment:
            paragraphs.pop()
        else:
            break

    return "\n".join(paragraphs).strip()


def generate_cover_letter(state: AgentState) -> str:
    """
    Agent 4a — Cover Letter Writer (Claude Sonnet 5).
    Retry/backoff logic for transient errors lives in generate_claude_text.
    """
    weight_factors = state["weight_factors"]
    facts_json     = state["facts_json"]
    cv_language    = state.get("cv_language", "en") or "en"

    language_instruction = (
        _AR_COVER_LETTER_LANGUAGE_INSTRUCTION
        if cv_language == "ar"
        else _EN_COVER_LETTER_LANGUAGE_INSTRUCTION
    )

    prompt = COVER_LETTER_PROMPT.format(
        job_title       = weight_factors.get("job_title", "the role"),
        company         = weight_factors.get("company", "your company"),
        culture_signals = ", ".join(weight_factors.get("culture_signals", [])),
        facts_json      = json.dumps(facts_json, ensure_ascii=False),
        weight_factors  = json.dumps(weight_factors, ensure_ascii=False),
        language_instruction = language_instruction,
    )

    logger.info("✍️  Agent 4a — Generating cover letter via Claude Sonnet 5...")

    try:
        # 800 -> 2000: on Sonnet 5, adaptive thinking runs by default and its
        # tokens count against max_tokens (thinking + visible text share one
        # budget). 800 was sized for Sonnet 4.6, which didn't think unless
        # asked. generate_claude_text also auto-escalates further if this
        # still isn't enough, so this is a safe starting point, not a hard
        # ceiling.
        text = generate_claude_text(prompt, max_tokens=2000).strip()
        # Defensive cleanup: strip any em/en dashes that slip through despite
        # the prompt rule, replacing with a comma so sentences stay readable
        # instead of just deleting the character and running words together.
        text = text.replace(" — ", ", ").replace(" – ", ", ").replace("—", ",").replace("–", "-")
        candidate_name = (facts_json.get("personal", {}) or {}).get("name", "")
        text = _strip_leaked_greeting_and_signoff(text, candidate_name)
        logger.info("✅ Cover letter generated.")
        return text
    except anthropic.APIError as e:
        logger.error(f"Critical Claude API error during cover letter generation: {e}")
        raise RuntimeError(f"Cover letter generation failed: {e}")
    except Exception as e:
        logger.error(f"Execution handling error: {e}")
        raise e


def run_document_generator(state: AgentState) -> dict:
    """
    LangGraph node for Agent 4.
    Generates cover letter text and stores it in state.
    PDF/DOCX rendering handled by utils/pdf_generator.py and utils/docx_generator.py.
    """
    cover_letter_text = generate_cover_letter(state)
    return {"cover_letter_text": cover_letter_text}
