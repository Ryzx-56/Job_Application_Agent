# core/fact_checker.py
import json
import re
import os
import time
from google import genai
from google.genai import types
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from core.state import AgentState
from agents.tailoring_engine import make_regeneration_fn

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Batched prompt: checks ALL bullets in a single Gemini call instead of one call per bullet.
BATCH_FACT_CHECK_PROMPT = """
You are a strict fact checker.

VERIFIED FACTS:
{facts_json}

Below is a JSON array of bullets to check, each with an "id".
For EACH bullet, determine if it contains ANY information not present in VERIFIED FACTS.
This includes invented metrics, skills, companies, or timeframes.

BULLETS:
{bullets_json}

Respond ONLY with a JSON array (no markdown, no explanation), one object per bullet id, in this exact format:
[
  {{"id": 0, "passes": true, "issue": null}},
  {{"id": 1, "passes": false, "issue": "specific description of what was invented"}}
]
"""

MAX_RETRIES = 3  # rounds of batch re-checking for bullets that fail

# Retries the raw Gemini call itself on transient/rate-limit errors, with exponential backoff.
# NOTE: swap `Exception` below for the SDK's specific rate-limit error class if you want to
# avoid retrying on non-transient errors (e.g. genai.errors.ClientError).
@retry(
    retry=retry_if_exception_type(Exception),
    wait=wait_exponential(multiplier=2, min=4, max=60),
    stop=stop_after_attempt(4),
    reraise=True
)
def _call_gemini_raw(prompt: str) -> str:
    response = client.models.generate_content(
        model    = "gemini-2.5-flash",
        contents = prompt,
        config   = types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )
    return response.text.strip()


def _call_gemini_batch(bullet_objs: list[dict], facts_json: dict) -> dict:
    """
    Sends ALL bullets in one Gemini call.
    bullet_objs: list of {"id": int, "text": str}
    Returns: dict mapping id -> {"passes": bool, "issue": str|None}
    """
    prompt = BATCH_FACT_CHECK_PROMPT.format(
        facts_json=json.dumps(facts_json, ensure_ascii=False),
        bullets_json=json.dumps(
            [{"id": b["id"], "text": b["text"]} for b in bullet_objs],
            ensure_ascii=False
        )
    )

    try:
        text = _call_gemini_raw(prompt)
        text = re.sub(r"```json|```", "", text).strip()
        results = json.loads(text)
        return {r["id"]: {"passes": r["passes"], "issue": r.get("issue")} for r in results}
    except Exception as e:
        logger.error(f"Batch fact check failed after retries: {e}. Marking all as UNVERIFIED.")
        # Do NOT silently pass — mark everything in this batch as failed/unverified instead.
        return {b["id"]: {"passes": False, "issue": "unverified — Gemini API unavailable after retries"} for b in bullet_objs}


def run_fact_check_loop(
    bullets: list[dict],
    facts_json: dict,
    tailoring_fn,
) -> tuple[list[dict], list[dict]]:
    """
    Batched fact-check loop.
    Round 1: check ALL bullets in a single Gemini call.
    Each subsequent round: only re-check bullets that failed, still batched into one call.
    """
    verified_bullets    = []
    hallucination_flags = []

    # Working set: id -> current bullet text/obj, tracks what's still unverified
    pending = {i: {**b, "id": i, "current_text": b["text"]} for i, b in enumerate(bullets)}

    for attempt in range(1, MAX_RETRIES + 1):
        if not pending:
            break

        batch_input = [{"id": i, "text": p["current_text"]} for i, p in pending.items()]
        logger.info(f"🛡️  Batch fact-check round {attempt}/{MAX_RETRIES} — checking {len(batch_input)} bullet(s) in 1 call...")

        results = _call_gemini_batch(batch_input, facts_json)
        time.sleep(2)  # small proactive gap even for batched calls

        still_pending = {}
        for i, p in pending.items():
            result = results.get(i, {"passes": False, "issue": "no result returned"})

            if result["passes"]:
                verified_bullets.append({**p, "text": p["current_text"]})
                logger.info(f"✅ Bullet {i} passed on round {attempt}: {p['current_text'][:60]}...")
            else:
                issue = result.get("issue") or "Unknown hallucination"
                logger.warning(f"⚠️  Bullet {i} round {attempt}/{MAX_RETRIES} failed — {issue}")

                hallucination_flags.append({
                    "bullet":   p["current_text"],
                    "issue":    issue,
                    "attempt":  attempt,
                    "excluded": False
                })

                if attempt < MAX_RETRIES:
                    p["current_text"] = tailoring_fn(p["current_text"], issue)
                    still_pending[i] = p
                else:
                    for flag in reversed(hallucination_flags):
                        if flag["bullet"] == p["current_text"]:
                            flag["excluded"] = True
                            break
                    logger.error(f"❌ Bullet {i} excluded after {MAX_RETRIES} rounds.")

        pending = still_pending

    return verified_bullets, hallucination_flags


def run_fact_checker(state: AgentState) -> AgentState:
    """
    LangGraph Validation Node wrapper.
    """
    if state.get("error"):
        return state

    logger.info("🛡️  Agent Node — Executing Strict Fact Checker (batched)...")

    tailored_bullets = state.get("tailored_bullets", []) or []
    facts_json = state.get("facts_json", {}) or {}

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