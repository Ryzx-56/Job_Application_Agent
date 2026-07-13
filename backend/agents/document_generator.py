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

Structure (3 paragraphs only):
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
  - Sign off with the candidate's actual name from FACTS_JSON
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


def generate_cover_letter(state: AgentState) -> str:
    """
    Agent 4a — Cover Letter Writer (Claude Sonnet 4.6).
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

    logger.info("✍️  Agent 4a — Generating cover letter via Claude Sonnet 4.6...")

    try:
        text = generate_claude_text(prompt, max_tokens=800).strip()
        # Defensive cleanup: strip any em/en dashes that slip through despite
        # the prompt rule, replacing with a comma so sentences stay readable
        # instead of just deleting the character and running words together.
        text = text.replace(" — ", ", ").replace(" – ", ", ").replace("—", ",").replace("–", "-")
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