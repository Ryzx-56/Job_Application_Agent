# agents/match_scorer.py
import json
import re
from loguru import logger
from core.state import AgentState
from core.llm_config import generate_claude_text

MATCH_SCORER_PROMPT = """
You are an expert recruiter and career coach. Given the candidate's tailored CV summary,
the job description, and specific gaps already identified by an automated ATS scorer, do three things:

1. Score how well the candidate's real background fits this specific role (0-100) and give a short reason.
2. Turn the gaps below into a prioritized "how to improve your CV" list (max 5 items, most impactful first).
   For each gap, state what's missing and one concrete, honest way to close it — either by genuinely
   adding a skill/project/certification, or by rephrasing existing real experience to surface it.
   NEVER suggest the candidate claim something they don't have. If a gap can't be closed honestly,
   suggest the closest truthful alternative (e.g. "mention any coursework or personal project involving X").
3. Write one short (1-2 sentence) overall recommendation for this specific application.

CV Summary: {cv_content}
Job Description: {jd_content}

Missing skills (from ATS scoring): {missing_skills}
Unmatched keywords (from ATS scoring): {unmatched_keywords}
Candidate's current skills: {current_skills}

Return ONLY JSON, no markdown fences, in exactly this shape:
{{
  "score": 85,
  "reason": "Reason here",
  "gap_analysis": [
    {{"skill": "SQL", "importance": "required", "how_to_close": "Add a project or course where you queried or cleaned data — even a class assignment counts if it's real."}}
  ],
  "overall_recommendation": "One or two sentence takeaway."
}}
"""


def run_match_scorer(state: AgentState) -> AgentState:
    """
    Agent 5 — Match Scorer (Claude Sonnet 4.6).
    Calculates alignment between the tailored CV and the job description, AND
    turns Agent 2's (ats_scorer.py) raw missing_skills / unmatched_keywords into
    actionable "how to improve your CV" guidance the frontend renders directly.

    NOTE: this node must run AFTER run_ats_scorer in the graph, since it reads
    state["score_breakdown"] which run_ats_scorer populates.
    """
    if state.get("error"):
        return state

    logger.info("🎯 Agent 5 — Scoring match + building improvement guidance (Claude Sonnet 4.6)...")

    cv_content = state.get("tailored_summary", "")
    jd_content = state.get("job_description", "Not provided")

    score_breakdown = state.get("score_breakdown", {}) or {}
    missing_skills = score_breakdown.get("missing_skills", [])
    unmatched_keywords = score_breakdown.get("unmatched_keywords", [])

    facts_json = state.get("facts_json", {}) or {}
    current_skills = []
    for category in (facts_json.get("skills", {}) or {}).values():
        if isinstance(category, list):
            current_skills.extend(category)

    prompt = MATCH_SCORER_PROMPT.format(
        cv_content=cv_content,
        jd_content=jd_content,
        missing_skills=json.dumps(missing_skills, ensure_ascii=False),
        unmatched_keywords=json.dumps(unmatched_keywords, ensure_ascii=False),
        current_skills=json.dumps(current_skills, ensure_ascii=False),
    )

    try:
        raw = generate_claude_text(prompt, max_tokens=900)
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)

        match_score = data.get("score", 0)
        match_reason = data.get("reason", "No analysis provided.")
        raw_gaps = data.get("gap_analysis", [])
        overall_recommendation = data.get("overall_recommendation", "")

        # Defensive normalization — a malformed gap item from the LLM should
        # never break the frontend or crash the pipeline.
        clean_gaps = []
        for g in raw_gaps:
            if not isinstance(g, dict):
                continue
            skill = str(g.get("skill", "")).strip()
            how_to_close = str(g.get("how_to_close", "")).strip()
            if not skill or not how_to_close:
                continue
            importance = g.get("importance") if g.get("importance") in ("required", "preferred") else "preferred"
            clean_gaps.append({
                "skill": skill,
                "importance": importance,
                "how_to_close": how_to_close,
            })

        logger.info(f"🎯 Job Match Score: {match_score}/100 — {len(clean_gaps)} improvement tips generated")

        return {
            "job_match_score": match_score,
            "job_match_reason": match_reason,
            "gap_analysis": clean_gaps,
            "overall_recommendation": overall_recommendation,
        }

    except Exception as e:
        logger.error(f"Match scoring failed: {e}")
        return {
            "job_match_score": 0,
            "job_match_reason": "Scoring failed.",
            "gap_analysis": [],
            "overall_recommendation": "",
        }
