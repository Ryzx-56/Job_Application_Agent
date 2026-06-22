# agents/tailoring_engine.py
import json
import re
import os
from google import genai
from google.genai import types
from loguru import logger
from core.state import AgentState

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

TAILORING_PROMPT = """
You are a senior CV writer with 15 years of experience.

YOUR ONLY SOURCES OF TRUTH ARE:
  1. The FACTS_JSON provided below
  2. The WEIGHT_FACTORS provided below

STRICT RULES:
  - You MAY rephrase existing bullets using JD keywords
  - You MAY re-order bullets to lead with the most relevant ones
  - You MAY restructure sentences for better impact
  - You MUST NOT add any skill, metric, company, or achievement not in FACTS_JSON
  - You MUST NOT invent percentages, numbers, or timeframes
  - If the candidate lacks a required skill, DO NOT mention it. It will be flagged in gap analysis.

FACTS_JSON:
{facts_json}

WEIGHT_FACTORS:
{weight_factors}

Tailor the CV bullets and summary to match this job. Follow the strict rules.

Return ONLY a JSON object in this exact format (no markdown):
{{
  "professional_summary": "3-sentence summary here",
  "bullets": [
    {{"section": "experience", "text": "bullet text here"}},
    {{"section": "project", "text": "bullet text here"}}
  ]
}}
"""

REGENERATION_PROMPT = """
The following bullet was REJECTED because it contains invented information:

BULLET: {bullet}
ISSUE: {issue}

Rewrite this bullet using ONLY facts from this JSON:
{facts_json}

Return ONLY the corrected bullet text, nothing else.
"""


def run_tailoring_engine(state: AgentState) -> AgentState:
    """
    Agent 3 — Tailoring Engine (Gemini Flash swap).
    NOTE: When Anthropic credits are restored, replace client.models.generate_content()
    with anthropic_client.messages.create(model='claude-sonnet-4-6', ...)
    """
    if state.get("error"):
        return state

    facts_json     = state["facts_json"]
    weight_factors = state["weight_factors"]

    prompt = TAILORING_PROMPT.format(
        facts_json     = json.dumps(facts_json, ensure_ascii=False),
        weight_factors = json.dumps(weight_factors, ensure_ascii=False),
    )

    logger.info("🧠 Agent 3 — Tailoring Engine running (Gemini Flash swap)...")

    MAX_RETRIES = 3
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model    = "gemini-2.5-flash",
                contents = prompt,
                config   = types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            raw  = response.text.strip()
            raw  = re.sub(r"```json|```", "", raw).strip()
            data = json.loads(raw)

            state["tailored_bullets"] = data.get("bullets", [])
            state["tailored_summary"] = data.get("professional_summary", "")
            state["error"]            = None

            logger.info(f"✅ Agent 3 complete — {len(state['tailored_bullets'])} bullets generated.")
            return state

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed: {e}")
            if attempt == MAX_RETRIES:
                state["error"] = f"Agent 3 failed after {MAX_RETRIES} retries: {e}"
                return state


def make_regeneration_fn(facts_json: dict):
    """
    Returns a callable used by the fact-check loop to regenerate a failed bullet.
    Signature: (bullet: str, issue: str) -> str
    """
    def regenerate(bullet: str, issue: str) -> str:
        prompt = REGENERATION_PROMPT.format(
            bullet     = bullet,
            issue      = issue,
            facts_json = json.dumps(facts_json, ensure_ascii=False)
        )
        response = client.models.generate_content(
            model    = "gemini-2.5-flash",
            contents = prompt,
        )
        return response.text.strip()

    return regenerate