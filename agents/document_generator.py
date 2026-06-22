# agents/document_generator.py
import json
import os
import time
import random
from google import genai
from google.genai import types
from google.genai.errors import ServerError
from loguru import logger
from core.state import AgentState

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

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
  - Never start with 'I am writing to express my interest'
  - Never use the phrase 'passion for'
  - Never write more than 3 paragraphs
  - Every achievement mentioned must come from FACTS_JSON
  - Sign off with the candidate's actual name from FACTS_JSON

FACTS_JSON: {facts_json}
WEIGHT_FACTORS: {weight_factors}
"""


def generate_cover_letter(state: AgentState) -> str:
    """
    Agent 4a — Cover Letter Writer (Gemini Flash).
    To swap back to Claude later: replace client.models.generate_content()
    with anthropic_client.messages.create(model='claude-sonnet-4-6', ...)
    """
    weight_factors = state["weight_factors"]
    facts_json     = state["facts_json"]

    prompt = COVER_LETTER_PROMPT.format(
        job_title       = weight_factors.get("job_title", "the role"),
        company         = weight_factors.get("company", "your company"),
        culture_signals = ", ".join(weight_factors.get("culture_signals", [])),
        facts_json      = json.dumps(facts_json, ensure_ascii=False),
        weight_factors  = json.dumps(weight_factors, ensure_ascii=False),
    )

    logger.info("✍️  Agent 4a — Generating cover letter via Gemini Flash...")

    MAX_RETRIES = 3
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model    = "gemini-2.5-flash",
                contents = prompt,
            )
            text = response.text.strip()
            logger.info("✅ Cover letter generated.")
            return text
            
        except ServerError as e:
            # Catch transient 503 backend strain issues specifically
            if e.code == 503 and attempt < MAX_RETRIES:
                sleep_time = (2 ** attempt) + random.uniform(0.1, 0.9)
                logger.warning(
                    f"⚠️ Gemini backend experiencing heavy load (503). "
                    f"Retrying in {sleep_time:.2f}s... (Attempt {attempt}/{MAX_RETRIES})"
                )
                time.sleep(sleep_time)
            else:
                logger.error(f"Critical Gemini Server Error during generation: {e}")
                raise RuntimeError(f"Cover letter generation failed after {MAX_RETRIES} retries due to server constraints: {e}")
                
        except Exception as e:
            # Instantly fail and raise for local exceptions (syntax, bad credentials, validation errors)
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