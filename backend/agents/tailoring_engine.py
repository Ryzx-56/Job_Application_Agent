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

STRICT RULES:
  - You MAY rephrase existing bullets using JD keywords
  - You MAY re-order bullets to lead with the most relevant ones
  - You MAY restructure sentences for better impact
  - You MAY fix capitalization and remove clearly unprofessional filler
  - You MUST NOT add any skill, metric, company, or achievement not present in FACTS_JSON or RAW_ADDITIONAL_INFO
  - You MUST NOT invent percentages, numbers, or timeframes
  - If the candidate lacks a required skill, DO NOT mention it. It will be flagged in gap analysis.

WRITING STYLE:
  - NEVER use em dashes (—) or en dashes ( – as a standalone punctuation mark) anywhere in your output.
  - Write in plain, direct, human resume language. Avoid generic filler phrases and empty buzzwords.

{language_instruction}

KEYWORD COVERAGE — this directly determines the candidate's ATS score, so it matters a lot:
  - Cross-reference every keyword in WEIGHT_FACTORS.ats_keywords_high, WEIGHT_FACTORS.ats_keywords_medium, and WEIGHT_FACTORS.required_skills against FACTS_JSON.
  - For every one of those keywords the candidate genuinely has real evidence for, work that keyword's EXACT wording into your output at least once. Exact wording matters: scoring is literal text matching.
  - Do NOT force in a keyword the candidate has zero genuine evidence for. That is fabrication and is forbidden.
  - Try to maximize the keywords used from the canditate's real experience, but never add any new skills or claims that aren't already present in FACTS_JSON or RAW_ADDITIONAL_INFO.

ADDITIONAL INFO PLACEMENT:
  RAW_ADDITIONAL_INFO must NOT become its own isolated CV section. Instead:
  - If it adds context that belongs in the overall narrative, weave it into "professional_summary".
  - If it's clearly about a specific project already in FACTS_JSON.projects, fold the relevant detail into that project's "tailored_description" instead.
  - If it describes a general competency, add it as a cleaned-up entry in the appropriate "tailored_skills" category instead.

SKILLS CLEANUP:
  FACTS_JSON.skills was extracted verbatim and may contain unprofessional filler. For "tailored_skills":
  - Return the SAME categories as FACTS_JSON.skills (languages, frameworks, tools, soft_skills, other).
  - DROP entries that are not genuine skills, competencies, or tools.
  - Fix capitalization and light phrasing on entries you keep (e.g. "fixing computers" -> "Computer hardware troubleshooting") — but do not invent skills that weren't already listed.

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
  - "display_name": a properly capitalized, resume-ready version of the name.
  - "tailored_description": 1-2 professional, resume-style sentences.

For FACTS_JSON.volunteer_work (a list of raw strings, if any), rewrite each entry into one polished, resume-style sentence. Return the SAME NUMBER of items, IN THE SAME ORDER, in "tailored_volunteer_work".

Return ONLY a JSON object in this exact format (no markdown):
{{
  "professional_summary": "3-sentence summary here",
  "bullets": [
    {{
      "original": "original bullet text here",
      "tailored": "rewritten bullet text here",
      "relevance_score": 0.9
    }}
  ],
  "tailored_projects": [
    {{
      "name": "Project name exactly as in facts_json",
      "display_name": "Properly Capitalized Name",
      "tailored_description": "Polished professional description here."
    }}
  ],
  "tailored_volunteer_work": ["Polished sentence for volunteer entry 1"],
  "tailored_skills": {{
    "languages": ["cleaned entries"],
    "frameworks": ["cleaned entries"],
    "tools": ["cleaned entries"],
    "soft_skills": ["cleaned entries"],
    "other": ["cleaned entries"]
  }}
}}
"""

REGENERATION_PROMPT = """
The following bullet was REJECTED because it contains invented information:

BULLET: {bullet}
ISSUE: {issue}

Rewrite this bullet using ONLY facts from this JSON:
{facts_json}

Never use em dashes (—) or en dashes as punctuation. Use a comma or write two sentences instead.

{language_line}

Return ONLY the corrected bullet text, nothing else.
"""

_SKILL_CATEGORIES = ("languages", "frameworks", "tools", "soft_skills", "other")


def _build_language_instruction(cv_language: str) -> str:
    if cv_language == "ar":
        return """OUTPUT LANGUAGE — MANDATORY ARABIC RULES:
  - You MUST write ALL values completely in fluent, professional Modern Standard Arabic.
  - Absolutely NO English or Latin script characters are allowed in the generated fields.
  - Translate everything: Job titles (e.g., "مساعد مبيعات وخدمة عملاء"), Company names (e.g., "تيم لاب"), Project names, and Frameworks/Languages (e.g., write "بايثون" instead of "Python", and "واجهة برمجة التطبيقات" instead of "API").
  - Do not mix English words into Arabic strings as it breaks layout rendering engines.
  - Numbers, years, and GPAs must stay as regular numerical digits (e.g., "2025", "4.27").
  - "original" inside each bullet object must remain exactly as it appears in FACTS_JSON without translation."""
    
    return """OUTPUT LANGUAGE:
  - Write ALL generated text in professional English, regardless of what language FACTS_JSON or RAW_ADDITIONAL_INFO are written in."""


def _strip_dashes(text: str) -> str:
    if not text:
        return text
    return text.replace(" — ", ", ").replace(" – ", ", ").replace("—", ",").replace("–", ",")


def run_tailoring_engine(state: AgentState) -> dict:
    if state.get("error"):
        return {}

    facts_json      = state["facts_json"]
    weight_factors   = state["weight_factors"]
    additional_info  = state.get("additional_info", "") or ""
    cv_language      = state.get("cv_language", "en") or "en"
    attempts         = state.get("tailoring_attempts", 0) + 1

    prompt = TAILORING_PROMPT.format(
        facts_json      = json.dumps(facts_json, ensure_ascii=False),
        weight_factors  = json.dumps(weight_factors, ensure_ascii=False),
        additional_info = additional_info if additional_info.strip() else "(none provided)",
        language_instruction = _build_language_instruction(cv_language),
    )

    logger.info("🧠 Agent 3 — Tailoring Engine running (Claude Sonnet 5)...")

    MAX_RETRIES = 3
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            raw = generate_claude_text(prompt, max_tokens=3600)

            print("\n========== RAW CLAUDE ==========\n")
            print(raw)
            print("\n===============================\n")

            raw = re.sub(r"```json|```", "", raw).strip()

            data = json.loads(raw)

            core_data = {
                "professional_summary": _strip_dashes(data.get("professional_summary") or ""),
                "bullets": [
                    {
                        **b,
                        "tailored": _strip_dashes(
                            b.get("tailored") or b.get("original") or ""
                        ),
                    }
                    for b in data.get("bullets", [])
                    if isinstance(b, dict)
                ],
            }
            validated = TailoredCV.model_validate(core_data)
            bullets = [b.model_dump() for b in validated.bullets]

            tailored_projects = []
            for p in data.get("tailored_projects", []):
                if not isinstance(p, dict):
                    continue
                name = str(p.get("name", "")).strip()
                display_name = _strip_dashes(str(p.get("display_name", "")).strip()) or name
                desc = _strip_dashes(str(p.get("tailored_description", "")).strip())
                if name and desc:
                    tailored_projects.append({
                        "name": name,
                        "display_name": display_name,
                        "tailored_description": desc,
                    })

            tailored_volunteer_work = [
                _strip_dashes(str(v).strip()) for v in data.get("tailored_volunteer_work", []) if str(v).strip()
            ]

            raw_skills = data.get("tailored_skills", {})
            tailored_skills = {}
            if isinstance(raw_skills, dict):
                for cat in _SKILL_CATEGORIES:
                    items = raw_skills.get(cat, [])
                    if isinstance(items, list):
                        tailored_skills[cat] = [_strip_dashes(str(s).strip()) for s in items if str(s).strip()]

            logger.info(f"✅ Agent 3 complete — {len(bullets)} tailored bullets generated.")

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
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — API error: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (API error): {e}",
                }


def make_regeneration_fn(facts_json: dict, cv_language: str = "en"):
    language_line = (
        "Write the corrected bullet completely in Modern Standard Arabic. Do not use English characters."
        if cv_language == "ar"
        else "Write the corrected bullet in English."
    )

    def regenerate(bullet: str, issue: str) -> str:
        prompt = REGENERATION_PROMPT.format(
            bullet         = bullet,
            issue          = issue,
            facts_json     = json.dumps(facts_json, ensure_ascii=False),
            language_line  = language_line,
        )
        return generate_claude_text(prompt, max_tokens=300).strip()

    return regenerate