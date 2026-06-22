# agents/match_scorer.py
import json
import os
from google import genai
from loguru import logger
from core.state import AgentState

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

def run_match_scorer(state: AgentState) -> AgentState:
    """
    Agent 5 — Match Scorer.
    Calculates the alignment between the tailored CV and the job description.
    """
    if state.get("error"):
        return state

    logger.info("🎯 Agent 5 — Scoring match...")

    # Combine data for the prompt
    cv_content = state.get("tailored_summary", "")
    jd_content = state.get("job_description", "Not provided")

    prompt = f"""
    You are an expert recruiter. Given this candidate's summary and the job description, 
    provide a match score from 0-100 and a brief reason.

    CV Summary: {cv_content}
    Job Description: {jd_content}

    Return ONLY JSON: {{"score": 85, "reason": "Reason here"}}
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        
        # Clean and parse
        raw = response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)

        state["match_score"] = data.get("score", 0)
        state["match_reason"] = data.get("reason", "No analysis provided.")
        
        logger.info(f"🎯 Match Score: {state['match_score']}/100")
        return state

    except Exception as e:
        logger.error(f"Match scoring failed: {e}")
        state["match_score"] = 0
        state["match_reason"] = "Scoring failed."
        return state