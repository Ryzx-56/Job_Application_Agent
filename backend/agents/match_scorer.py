# agents/match_scorer.py
import json
import re
from loguru import logger
from core.state import AgentState
from core.llm_config import generate_claude_text

def run_match_scorer(state: AgentState) -> AgentState:
    """
    Agent 5 — Match Scorer (Claude Sonnet 4.6).
    Calculates the alignment between the tailored CV and the job description.
    Uses Claude because scoring requires semantic reasoning (e.g. recognizing
    that "built neural networks" satisfies "deep learning experience"),
    not just keyword counting.
    """
    if state.get("error"):
        return state

    logger.info("🎯 Agent 5 — Scoring match (Claude Sonnet 4.6)...")

    # Combine data for the prompt
    cv_content = state.get("tailored_summary", "")
    jd_content = state.get("job_description", "Not provided")

    prompt = f"""
    You are an expert recruiter. Given this candidate's summary and the job description, 
    provide a match score from 0-100 and a brief reason.

    CV Summary: {cv_content}
    Job Description: {jd_content}

    Return ONLY JSON, no markdown fences: {{"score": 85, "reason": "Reason here"}}
    """

    try:
        raw = generate_claude_text(prompt, max_tokens=300)
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)

        match_score = data.get("score", 0)
        match_reason = data.get("reason", "No analysis provided.")

        logger.info(f"🎯 Job Match Score: {match_score}/100")
        return {
            "job_match_score": match_score,
            "job_match_reason": match_reason,
        }

    except Exception as e:
        logger.error(f"Match scoring failed: {e}")
        return {
            "job_match_score": 0,
            "job_match_reason": "Scoring failed.",
        }