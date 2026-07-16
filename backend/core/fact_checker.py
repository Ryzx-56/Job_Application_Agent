# core/fact_checker.py
import json
import re
import os
import time
from google import genai
from google.genai import types
from loguru import logger
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

MAX_RETRIES = 2  # rounds of batch re-checking for bullets that fail — kept low so a
                  # single generation run can't spiral into minutes of retries

_GEMINI_MAX_ATTEMPTS = 3   # attempts for a single Gemini call before giving up
_GEMINI_MAX_WAIT     = 12  # seconds — appropriate for a burst limit, not a daily quota


def _extract_retry_delay(exc: Exception, default: float = 3.0) -> float:
    """
    Google's 429 errors usually include the exact wait it wants
    (e.g. "Please retry in 12.35s"). Honor that instead of guessing —
    it's both faster on average and less likely to re-trigger the
    burst-limit guard than blind exponential backoff.
    """
    match = re.search(r"retry in ([\d.]+)s", str(exc))
    if match:
        return float(match.group(1)) + 0.5  # small safety buffer
    return default


def _is_daily_quota_exhausted(exc: Exception) -> bool:
    """
    A $0-balance Gemini account has two different failure modes:
      1. Burst limit — too many concurrent requests in the same second.
         Transient, clears in seconds, worth a short retry.
      2. Daily free-tier quota — a hard cap that doesn't reset until
         tomorrow. Retrying this (even with backoff) is pure wasted time.
    This distinguishes the two so we never wait on a wall that isn't moving.
    """
    msg = str(exc)
    return "RESOURCE_EXHAUSTED" in msg and "PerDay" in msg


def _call_gemini_raw(prompt: str) -> str:
    last_exc = None
    for attempt in range(1, _GEMINI_MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model    = "gemini-3.1-flash-lite",
                contents = prompt,
                config   = types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            return response.text.strip()
        except Exception as e:
            last_exc = e
            if _is_daily_quota_exhausted(e):
                logger.error("🚫 Gemini daily quota exhausted — skipping retries, won't reset until tomorrow.")
                raise
            if attempt == _GEMINI_MAX_ATTEMPTS:
                raise
            delay = min(_extract_retry_delay(e), _GEMINI_MAX_WAIT)
            logger.warning(f"Gemini burst-limited, retrying in {delay:.1f}s (attempt {attempt}/{_GEMINI_MAX_ATTEMPTS})...")
            time.sleep(delay)
    raise last_exc


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
    # Fact-checking runs against "tailored" (the rewritten text) — "original" is
    # the ground-truth source bullet, not something that needs verifying.
    pending = {i: {**b, "id": i, "current_text": b["tailored"]} for i, b in enumerate(bullets)}

    for attempt in range(1, MAX_RETRIES + 1):
        if not pending:
            break

        batch_input = [{"id": i, "text": p["current_text"]} for i, p in pending.items()]
        logger.info(f"🛡️  Batch fact-check round {attempt}/{MAX_RETRIES} — checking {len(batch_input)} bullet(s) in 1 call...")

        results = _call_gemini_batch(batch_input, facts_json)

        still_pending = {}
        for i, p in pending.items():
            result = results.get(i, {"passes": False, "issue": "no result returned"})

            if result["passes"]:
                verified_bullets.append({
                    "original": p["original"],
                    "tailored": p["current_text"],
                    "relevance_score": p.get("relevance_score"),
                })
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


def run_fact_checker(state: AgentState) -> dict:
    """
    LangGraph Validation Node wrapper.
    """
    if state.get("error"):
        return {}

    logger.info("🛡️  Agent Node — Executing Strict Fact Checker (batched)...")

    tailored_bullets = state.get("tailored_bullets", []) or []
    facts_json = state.get("facts_json", {}) or {}

    regenerate_bullet_fn = make_regeneration_fn(facts_json)

    verified_bullets, hallucination_flags = run_fact_check_loop(
        bullets=tailored_bullets,
        facts_json=facts_json,
        tailoring_fn=regenerate_bullet_fn
    )

    fact_check_passed = len(verified_bullets) > 0
    logger.info(f"🛡️  Fact check complete. Passed: {fact_check_passed}")

    return {
        "tailored_bullets": verified_bullets,
        "hallucination_flags": hallucination_flags,
        "fact_check_passed": fact_check_passed,
    }