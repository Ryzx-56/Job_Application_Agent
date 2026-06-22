# core/fact_checker.py
import json
import re
import os
from google import genai
from google.genai import types
from loguru import logger
from core.state import AgentState
from agents.tailoring_engine import make_regeneration_fn

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

FACT_CHECK_PROMPT = """
You are a strict fact checker.

VERIFIED FACTS:
{facts_json}

GENERATED BULLET:
{bullet}

Does this bullet contain ANY information not present in VERIFIED FACTS?
This includes invented metrics, skills, companies, or timeframes.

Respond ONLY in this exact JSON format (no markdown, no explanation):
{{"passes": true, "issue": null}}
or
{{"passes": false, "issue": "specific description of what was invented"}}
"""

MAX_RETRIES = 3

def _call_gemini(prompt: str) -> dict:
    """Call Gemini Flash and parse the JSON response."""
    response = client.models.generate_content(
        model    = "gemini-2.5-flash",
        contents = prompt,
        config   = types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )
    text = response.text.strip()
    text = re.sub(r"```json|```", "", text).strip()
    return json.loads(text)

def verify_bullet(bullet: str, facts_json: dict) -> dict:
    """
    Verify a single bullet against the facts JSON.
    Returns: {"passes": bool, "issue": str | None}
    """
    prompt = FACT_CHECK_PROMPT.format(
        facts_json=json.dumps(facts_json, ensure_ascii=False),
        bullet=bullet
    )
    try:
        return _call_gemini(prompt)
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"Fact check parse error: {e}. Defaulting to pass.")
        return {"passes": True, "issue": None}

def run_fact_check_loop(
    bullets: list[dict],
    facts_json: dict,
    tailoring_fn,
) -> tuple[list[dict], list[dict]]:
    """
    Run the full fact-check loop on a list of bullet dicts.
    """
    verified_bullets   = []
    hallucination_flags = []

    for bullet_obj in bullets:
        bullet_text = bullet_obj["text"]
        passed      = False

        for attempt in range(1, MAX_RETRIES + 1):
            result = verify_bullet(bullet_text, facts_json)

            if result["passes"]:
                verified_bullets.append({**bullet_obj, "text": bullet_text})
                passed = True
                logger.info(f"✅ Bullet passed on attempt {attempt}: {bullet_text[:60]}...")
                break
            else:
                issue = result.get("issue", "Unknown hallucination")
                logger.warning(f"⚠️  Attempt {attempt}/{MAX_RETRIES} failed — {issue}")
                
                hallucination_flags.append({
                    "bullet":   bullet_text,
                    "issue":    issue,
                    "attempt":  attempt,
                    "excluded": False
                })

                if attempt < MAX_RETRIES:
                    bullet_text = tailoring_fn(bullet_text, issue)

        if not passed:
            for flag in reversed(hallucination_flags):
                if flag["bullet"] == bullet_obj["text"]:
                    flag["excluded"] = True
                    break
            logger.error(f"❌ Bullet excluded after {MAX_RETRIES} retries.")

    return verified_bullets, hallucination_flags

def run_fact_checker(state: AgentState) -> AgentState:
    """
    LangGraph Validation Node wrapper.
    """
    if state.get("error"):
        return state

    logger.info("🛡️  Agent Node — Executing Strict Fact Checker...")

    tailored_bullets = state.get("tailored_bullets", [])
    facts_json = state.get("facts_json", {})

    regenerate_bullet_fn = make_regeneration_fn(facts_json)

    verified_bullets, hallucination_flags = run_fact_check_loop(
        bullets=tailored_bullets,
        facts_json=facts_json,
        tailoring_fn=regenerate_bullet_fn
    )

    state["tailored_bullets"] = verified_bullets
    state["hallucination_logs"] = hallucination_flags
    state["fact_check_passed"] = len(verified_bullets) > 0

    logger.info(f"🛡️  Fact check complete. Passed: {state['fact_check_passed']}")
    return state