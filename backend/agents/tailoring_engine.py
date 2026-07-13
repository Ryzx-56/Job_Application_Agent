# agents/tailoring_engine.py
import json
import re
from loguru import logger
from pydantic import ValidationError
from core.state import AgentState
from core.llm_config import generate_claude_text
from schemas.tailored_cv_schema import TailoredCV

TAILORING_PROMPT = """
You are a senior CV writer with 15 years of experience.

YOUR ONLY SOURCES OF TRUTH ARE:
  1. The FACTS_JSON provided below (extracted facts — experience, projects, skills, etc.)
  2. The WEIGHT_FACTORS provided below (what this specific job cares about)
  3. The RAW_ADDITIONAL_INFO provided below — free-text notes the candidate typed themselves
     (context about a gap, extra volunteer work, awards, anything not already captured above)

STRICT RULES:
  - You MAY rephrase existing bullets using JD keywords
  - You MAY re-order bullets to lead with the most relevant ones
  - You MAY restructure sentences for better impact
  - You MAY fix capitalization and remove clearly unprofessional filler (e.g. "im cool", "super chill")
  - You MUST NOT add any skill, metric, company, or achievement not present in FACTS_JSON or RAW_ADDITIONAL_INFO
  - You MUST NOT invent percentages, numbers, or timeframes
  - If the candidate lacks a required skill, DO NOT mention it. It will be flagged in gap analysis.

REWRITING RAW TEXT — this matters:
  FACTS_JSON.projects[].description and FACTS_JSON.volunteer_work are extracted verbatim from whatever
  the candidate typed, often casually or unprofessionally. RAW_ADDITIONAL_INFO is the same — raw,
  unedited candidate notes. You MUST rewrite all of these into polished, concise, resume-appropriate
  language — same rules as above: reword and restructure freely, but never add facts, skills, numbers,
  or claims that aren't already present in what the candidate wrote.

ADDITIONAL INFO PLACEMENT — this matters:
  RAW_ADDITIONAL_INFO must NOT become its own isolated CV section. Instead:
  - If it adds context that belongs in the overall narrative, weave it into "professional_summary".
  - If it's clearly about a specific project already in FACTS_JSON.projects, fold the relevant detail
    into that project's "tailored_description" instead.
  - If it describes a general competency (e.g. hardware repair, a tool, a skill), add it as a cleaned-up
    entry in the appropriate "tailored_skills" category instead.
  A CV reader should never see a section literally titled "Additional Information" — everything genuinely
  CV-worthy should already be integrated into summary / projects / skills by the time you're done.

SKILLS CLEANUP — this matters:
  FACTS_JSON.skills was extracted verbatim and may contain unprofessional filler that isn't a real skill
  at all (e.g. "im cool", "super chill", "lol", personality remarks). For "tailored_skills":
  - Return the SAME categories as FACTS_JSON.skills (languages, frameworks, tools, soft_skills, other).
  - DROP entries that are not genuine skills, competencies, or tools — filler, jokes, or personality
    remarks do not belong on a CV.
  - Fix capitalization and light phrasing on entries you keep (e.g. "fixing computers" ->
    "Computer hardware troubleshooting", "hard worker" -> "Hardworking") — but do not invent skills
    that weren't already listed.

FACTS_JSON:
{facts_json}

WEIGHT_FACTORS:
{weight_factors}

RAW_ADDITIONAL_INFO:
{additional_info}

Tailor the CV to match this job. Follow the strict rules.

For each work-experience bullet, include:
  - "original": the exact original bullet text from FACTS_JSON
  - "tailored": your rewritten version using JD keywords
  - "relevance_score": a float from 0.0 to 1.0 rating how relevant this bullet is to the job description

For each project in FACTS_JSON.projects (if any), return in "tailored_projects":
  - "name": the project's name EXACTLY as given in FACTS_JSON (used to match it back up — do not alter this one)
  - "display_name": a properly capitalized, resume-ready version of the name (e.g. "flight route demand
    prediction" -> "Flight Route Demand Prediction"). Preserve acronyms and intentional stylization
    (e.g. "API", "CV") as-is.
  - "tailored_description": 1-2 professional, resume-style sentences (fold in any relevant
    RAW_ADDITIONAL_INFO detail about this exact project here, per the rule above)

For FACTS_JSON.volunteer_work (a list of raw strings, if any), rewrite each entry into one polished,
resume-style sentence. Return the SAME NUMBER of items, IN THE SAME ORDER, in "tailored_volunteer_work" —
do not merge, drop, or add entries.

Return ONLY a JSON object in this exact format (no markdown):
{{
  "professional_summary": "3-sentence summary here — weave in relevant RAW_ADDITIONAL_INFO context per the rule above",
  "bullets": [
    {{"original": "original bullet text here", "tailored": "rewritten bullet text here", "relevance_score": 0.9}}
  ],
  "tailored_projects": [
    {{"name": "Project name exactly as in facts_json", "display_name": "Properly Capitalized Name", "tailored_description": "Polished professional description here."}}
  ],
  "tailored_volunteer_work": ["Polished sentence for volunteer entry 1", "Polished sentence for volunteer entry 2"],
  "tailored_skills": {{
    "languages": ["cleaned entries"],
    "frameworks": ["cleaned entries"],
    "tools": ["cleaned entries"],
    "soft_skills": ["cleaned entries"],
    "other": ["cleaned entries, junk removed"]
  }}
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

_SKILL_CATEGORIES = ("languages", "frameworks", "tools", "soft_skills", "other")


def run_tailoring_engine(state: AgentState) -> dict:
    """
    Agent 3 — Tailoring Engine (Claude Sonnet 4.6 — the main brain).
    """
    if state.get("error"):
        return {}

    facts_json      = state["facts_json"]
    weight_factors   = state["weight_factors"]
    additional_info  = state.get("additional_info", "") or ""
    attempts         = state.get("tailoring_attempts", 0) + 1

    prompt = TAILORING_PROMPT.format(
        facts_json      = json.dumps(facts_json, ensure_ascii=False),
        weight_factors  = json.dumps(weight_factors, ensure_ascii=False),
        additional_info = additional_info if additional_info.strip() else "(none provided)",
    )

    logger.info("🧠 Agent 3 — Tailoring Engine running (Claude Sonnet 4.6)...")

    MAX_RETRIES = 3
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            raw  = generate_claude_text(prompt, max_tokens=2800)
            raw  = re.sub(r"```json|```", "", raw).strip()
            data = json.loads(raw)

            # Validate the core schema-bound fields so malformed LLM output never
            # silently flows downstream to the fact-checker / PDF generator.
            # tailored_projects / tailored_volunteer_work / tailored_skills are
            # validated manually below since they're not yet part of TailoredCV
            # — see note at bottom of this file if you want them added to the
            # pydantic schema too.
            core_data = {
                "professional_summary": data.get("professional_summary", ""),
                "bullets": data.get("bullets", []),
            }
            validated = TailoredCV.model_validate(core_data)

            bullets = [b.model_dump() for b in validated.bullets]

            # Manual validation for the new fields (defensive — never let a
            # bad shape from the LLM break the pipeline).
            tailored_projects = []
            for p in data.get("tailored_projects", []):
                if not isinstance(p, dict):
                    continue
                name = str(p.get("name", "")).strip()
                display_name = str(p.get("display_name", "")).strip() or name
                desc = str(p.get("tailored_description", "")).strip()
                if name and desc:
                    tailored_projects.append({
                        "name": name,
                        "display_name": display_name,
                        "tailored_description": desc,
                    })

            tailored_volunteer_work = [
                str(v).strip() for v in data.get("tailored_volunteer_work", []) if str(v).strip()
            ]

            raw_skills = data.get("tailored_skills", {})
            tailored_skills = {}
            if isinstance(raw_skills, dict):
                for cat in _SKILL_CATEGORIES:
                    items = raw_skills.get(cat, [])
                    if isinstance(items, list):
                        tailored_skills[cat] = [str(s).strip() for s in items if str(s).strip()]

            logger.info(
                f"✅ Agent 3 complete — {len(bullets)} bullets, "
                f"{len(tailored_projects)} projects, "
                f"{len(tailored_volunteer_work)} volunteer entries, "
                f"skills cleaned: {bool(tailored_skills)}."
            )

            return {
                "tailored_bullets": bullets,
                "tailored_summary": validated.professional_summary,
                "tailored_projects": tailored_projects,
                "tailored_volunteer_work": tailored_volunteer_work,
                "tailored_skills": tailored_skills,
                "tailoring_attempts": attempts,
                "error": None,
            }

        except (json.JSONDecodeError, KeyError, ValidationError) as e:
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — bad output: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (invalid output): {e}",
                }

        except Exception as e:
            # Catches API/network failures (rate limits, auth errors, timeouts)
            # so a transient issue triggers a retry instead of crashing the pipeline.
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — API error: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (API error): {e}",
                }


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

# ─── NOTES ────────────────────────────────────────────────────────────────────
# 1. additional_info is read from state["additional_info"] directly, NOT from
#    facts_json["additional_info"] — that key never exists. cv_parser.py's
#    Agent 1 (Gemini) is deliberately forbidden from rephrasing anything, so
#    when additional_info gets appended to raw_cv_text before Agent 1 runs, it
#    gets absorbed verbatim into whatever facts_json categories fit (awards,
#    certifications, volunteer_work) — it doesn't survive as its own field.
#
# 2. tailored_additional_info was removed from this version's output on
#    purpose — the whole point of this revision is that additional info no
#    longer renders as its own CV section (see ADDITIONAL INFO PLACEMENT rule
#    in the prompt above). If your state.py / pdf_generator.py still reference
#    tailored_additional_info from an earlier version, they can be left as
#    dead code or cleaned up — nothing downstream depends on it anymore.
