# agents/tailoring_engine.py
import json
import re
from loguru import logger
from core.state import AgentState
from core.llm_config import generate_claude_text

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
    Agent 3 — Tailoring Engine (Claude Sonnet 4.6 — the main brain).
    """
    if state.get("error"):
        return state

    facts_json     = state["facts_json"]
    weight_factors = state["weight_factors"]

    prompt = TAILORING_PROMPT.format(
        facts_json     = json.dumps(facts_json, ensure_ascii=False),
        weight_factors = json.dumps(weight_factors, ensure_ascii=False),
    )

    logger.info("🧠 Agent 3 — Tailoring Engine running (Claude Sonnet 4.6)...")

    MAX_RETRIES = 3
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            raw  = generate_claude_text(prompt, max_tokens=2000)
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
        return generate_claude_text(prompt, max_tokens=300).strip()

    return regenerate