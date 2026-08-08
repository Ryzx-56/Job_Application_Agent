# agents/match_scorer.py
import json
import re
from loguru import logger
from core.state import AgentState
from core.llm_config import generate_claude_text, ClaudeTruncationError

MATCH_SCORER_PROMPT = """
You are an expert recruiter and career coach.

Using the candidate's tailored CV, the job description, and the ATS gaps below, complete these tasks:

1. Give an overall candidate-to-job match score from 0 to 100. Use ATS Score: {ats_score} as one signal, but independently judge technical fit, experience fit, education fit, and project relevance. The final score does NOT have to equal ATS.
2. Write a reason explaining the score. Cover BOTH sides: what genuinely supports the candidate (specific transferable skills, relevant experience, or strengths) AND what specifically works against them (the concrete gaps, missing direct experience, or mismatches with core duties). Name real specifics from the CV and job description, not generic phrases.
3. Generate 3 to 5 CV improvement suggestions, ordered from most important to least important. Base these on the Missing Skills / Missing Keywords below. If there are fewer than 3 genuine gaps, it's fine to return fewer, but never return an empty list if any missing skills or keywords exist.
4. Write ONE overall recommendation for this application, direct and actionable.

RULES:

- Never invent experience, achievements, certifications, employers, technologies, or skills.
- Never suggest the candidate lie or exaggerate.
- If a gap cannot honestly be closed, recommend a truthful alternative such as a project, coursework, certification, or better wording of existing experience.
- Prioritize required skills over preferred skills.
- Ignore gaps that already appear in the CV.
- Be specific — name the actual skill, tool, duty, or experience gap rather than giving generic advice.

{language_instruction}

WRITING STYLE:

- Clear and complete, not padded. Say what's actually useful, don't cut it short just to hit a word count.
- The "reason" should be 2-3 full sentences (roughly 50-90 words) — enough to cover both the strengths and the gaps with real specifics, not just one or the other.
- Each "how_to_close" should be 1 sentence (roughly 15-30 words) — enough room to name the concrete action, not just the gap.
- The "overall_recommendation" should be 2-3 sentences (roughly 40-70 words).
- Never use em dashes (—) or en dashes (–). Use commas or periods instead.
- Do not include markdown.
- Return ONLY valid JSON.

CV Summary:
{cv_content}

Job Description:
{jd_content}

Missing Skills:
{missing_skills}

Missing Keywords:
{unmatched_keywords}

Candidate Skills:
{current_skills}

Return EXACTLY this JSON structure:

{{
  "score": 0,
  "reason": "",
  "gap_analysis": [
    {{
      "skill": "",
      "importance": "required",
      "how_to_close": ""
    }}
  ],
  "overall_recommendation": ""
}}
"""

# BUG FIX: this node had no language instruction at all, so its output was
# always English. On an Arabic CV the user saw an Arabic dashboard with an
# English match-score explanation and English improvement tips sitting
# inside it. The JD is usually still English, so the model has to be told
# explicitly to answer in the CV's language rather than the input's.
_AR_SCORER_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE — MANDATORY:

- Write "reason", every "skill", every "how_to_close", and "overall_recommendation" entirely in
  fluent Modern Standard Arabic. The job description and the CV data below may be in English;
  answer in Arabic regardless.
- "skill" names a gap the candidate should close. Write it in Arabic, but keep a widely-used
  technology or tool name in its original form inside the Arabic phrase if translating it would
  make it unrecognizable to a recruiter (e.g. "خبرة في Docker").
- Keep the JSON keys themselves exactly as given in English. Only the VALUES are translated.
- "importance" must stay exactly "required" or "preferred" in English — it is a machine-read enum,
  not display text."""

_EN_SCORER_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE:

- Write all output in professional English, regardless of what language the CV or job description
  are written in."""


def _strip_dashes(text: str) -> str:
    """Defensive safety net — see tailoring_engine.py's version of this for why."""
    if not text:
        return text
    return text.replace(" — ", ", ").replace(" – ", ", ").replace("—", ",").replace("–", ",")


def run_match_scorer(state: AgentState) -> AgentState:
    """
    Agent 5 — Match Scorer (Claude Sonnet 5).
    Calculates alignment between the tailored CV and the job description, AND
    turns Agent 2's (ats_scorer.py) raw missing_skills / unmatched_keywords into
    actionable "how to improve your CV" guidance the frontend renders directly.

    NOTE: this node must run AFTER run_ats_scorer in the graph, since it reads
    state["score_breakdown"] (and now state["ats_score"]) which run_ats_scorer
    populates. In orchestrator.py this is wired as a direct sequential edge
    (ats_scorer -> match_scorer), NOT part of the parallel fan-out — do not
    move this back into the fan-out list, or it'll silently read stale state
    again (see the note there for why).
    """
    if state.get("error"):
        return state

    logger.info("🎯 Agent 5 — Scoring match + building improvement guidance (Claude Sonnet 5)...")

    cv_content = {
    "summary": state.get("tailored_summary"),
    "projects": state.get("tailored_projects"),
    "skills": state.get("tailored_skills"),
    "experience": state.get("tailored_bullets"),
    }
    cv_content=json.dumps(cv_content, ensure_ascii=False)
    jd_content = state.get("job_description", "Not provided")

    score_breakdown = state.get("score_breakdown", {}) or {}
    missing_skills = score_breakdown.get("missing_skills", [])
    unmatched_keywords = score_breakdown.get("unmatched_keywords", [])
    ats_score = state.get("ats_score", 0)

    facts_json = state.get("facts_json", {}) or {}
    current_skills = []
    for category in (facts_json.get("skills", {}) or {}).values():
        if isinstance(category, list):
            current_skills.extend(category)

    is_arabic = str(state.get("cv_language", "en")).lower().startswith("ar")

    prompt = MATCH_SCORER_PROMPT.format(
        ats_score=ats_score,
        language_instruction=(
            _AR_SCORER_LANGUAGE_INSTRUCTION if is_arabic else _EN_SCORER_LANGUAGE_INSTRUCTION
        ),
        cv_content=cv_content,
        jd_content=jd_content,
        missing_skills=json.dumps(missing_skills, ensure_ascii=False),
        unmatched_keywords=json.dumps(unmatched_keywords, ensure_ascii=False),
        current_skills=json.dumps(current_skills, ensure_ascii=False),
    )

    # 900 -> 2500: on Sonnet 5, adaptive thinking runs by default and its
    # tokens count against max_tokens. This task needs the model to
    # actually reason about fit before answering (that's the point of
    # Agent 5), so we keep thinking ON rather than disabling it — just
    # give it enough headroom that reasoning doesn't crowd out the JSON
    # it still has to return. generate_claude_text auto-escalates further
    # if even this gets truncated.
    #
    # Arabic gets more room for the same reason the tailoring budgets do
    # (see CLAUDE_BUDGETS in core/llm_config.py): this node writes its
    # "reason" and "how_to_close" text in whatever language the CV is in,
    # and Arabic costs roughly 2-3x the tokens. At a flat 2500 an Arabic
    # run could truncate, fall into the except below, and report a 0% match
    # score on an otherwise perfectly good CV.
    budget = 5000 if str(state.get("cv_language", "en")).lower().startswith("ar") else 2500

    try:
        raw = generate_claude_text(prompt, max_tokens=budget, max_tokens_ceiling=12000)
        #logger.debug(f"Agent 5 raw response:\n{raw}")
        raw = re.sub(r"```json|```", "", raw).strip()
        MAX_RETRIES = 3

        for attempt in range(MAX_RETRIES):
            try:
                data = json.loads(raw)
                break
            except json.JSONDecodeError:
                if attempt == MAX_RETRIES - 1:
                    raise

                logger.warning(
                    f"Agent 5 JSON parse failed ({attempt+1}/{MAX_RETRIES}), retrying..."
                )

                raw = generate_claude_text(prompt, max_tokens=budget, max_tokens_ceiling=12000)
                raw = re.sub(r"```json|```", "", raw).strip()

        match_score = data.get("score", 0)
        match_reason = _strip_dashes(data.get("reason", "No analysis provided."))
        raw_gaps = data.get("gap_analysis", [])
        overall_recommendation = _strip_dashes(data.get("overall_recommendation", ""))

        # Defensive normalization — a malformed gap item from the LLM should
        # never break the frontend or crash the pipeline.
        clean_gaps = []
        for g in raw_gaps:
            if not isinstance(g, dict):
                continue
            skill = str(g.get("skill", "")).strip()
            how_to_close = _strip_dashes(str(g.get("how_to_close", "")).strip())
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

    except ClaudeTruncationError as e:
        # Retrying an identical prompt that already overflowed the ceiling
        # just spends more tokens to reach the same place. Log it distinctly
        # so a recurring truncation here is visible as a budget problem
        # rather than hiding among generic scoring failures.
        logger.error(f"Match scoring hit the token ceiling and was not retried: {e}")
        return {
            "job_match_score": 0,
            "job_match_reason": "Scoring failed.",
            "gap_analysis": [],
            "overall_recommendation": "",
        }
    except Exception as e:
        logger.error(f"Match scoring failed: {e}")
        return {
            "job_match_score": 0,
            "job_match_reason": "Scoring failed.",
            "gap_analysis": [],
            "overall_recommendation": "",
        }
