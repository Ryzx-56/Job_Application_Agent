# agents/tailoring_engine.py
import json
import re
from loguru import logger
from pydantic import ValidationError
from core.state import AgentState
from core.llm_config import generate_claude_text
from schemas.tailored_cv_schema import TailoredCV

# Split into a static system block (identical on every single call —
# English or Arabic, retry or first attempt — so it's what actually
# benefits from cache_control in generate_claude_text) and a small dynamic
# user block below (TAILORING_USER_TEMPLATE) carrying the parts that
# genuinely change per request: language_instruction (2 fixed variants) and
# the three data blobs. Keeping FACTS_JSON/WEIGHT_FACTORS/additional_info
# OUT of this block is what makes it cacheable — if per-request data were
# spliced in here, every call would be a fresh cache write instead of a
# hit, and none of the saving would materialize. See the `system` param
# docstring on generate_claude_text (core/llm_config.py) for how the cache
# actually gets applied.
TAILORING_SYSTEM_PROMPT = """
You are a senior CV writer with 15 years of experience.

YOUR ONLY SOURCES OF TRUTH ARE:
  1. The FACTS_JSON provided below (extracted facts — experience, projects, skills, etc.)
  2. The WEIGHT_FACTORS provided below (what this specific job cares about)
  3. The RAW_ADDITIONAL_INFO provided below — free-text notes the candidate typed themselves

STRICT RULES — DO NOT CROSS THESE:
  - You MUST NOT add any skill, metric, company, or achievement not present in FACTS_JSON or RAW_ADDITIONAL_INFO
  - You MUST NOT invent percentages, numbers, timeframes, team sizes, or outcomes
  - If the candidate lacks a required skill, DO NOT mention it. It will be flagged in gap analysis.

WHAT YOU SHOULD DO — BE BOLD HERE, THIS IS WHERE MOST OF YOUR VALUE IS:
  - Reword every bullet significantly — different verbs, different sentence shape, not a
    keyword swapped into an otherwise-untouched sentence. A bullet that still reads almost
    identically to the original is a failure of this task even if it's technically accurate.
    Rule of thumb: if more than a couple of words in a row still match the original verbatim
    (excluding proper nouns, numbers, and tool/skill names), rewrite it again.
  - Reframe implementation details as business outcomes and strategic decisions wherever
    that framing is honestly supported. "Set up a payment gateway" can become "owned
    payment infrastructure decisions to enable monetization" — same fact, elevated framing.
  - Reorder freely, both bullets within a section and which facts lead a sentence, to put
    the strongest, most relevant material first.
  - Write in a confident, polished, executive register — the way a senior consultant would
    describe their own work, not the way the candidate first typed it.
  - Merge, restructure, or split sentences as needed for impact. You are not restricted to
    a 1:1 sentence structure with the original.
  - The test for "is this allowed" is never "does this exact phrase appear in FACTS_JSON."
    It's "is this claim TRUE according to FACTS_JSON."

WRITING STYLE:
  - NEVER use em dashes (—) or en dashes ( – as a standalone punctuation mark) anywhere in your output.
  - Write in plain, direct, human resume language. Avoid generic filler phrases and empty buzzwords.

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
  - Fix capitalization and light phrasing on entries you keep (e.g. "fixing computers" -> "Computer hardware troubleshooting") — but do not invent a skill that has zero support anywhere in FACTS_JSON.

  MISSING/EMPTY SKILLS — infer from evidence, do not leave it blank:
  - If FACTS_JSON.skills is empty or very thin (fewer than ~3 total entries across all categories),
    you MUST still populate "tailored_skills" by inferring skills that are clearly and specifically
    demonstrated in FACTS_JSON.experience, FACTS_JSON.projects, or RAW_ADDITIONAL_INFO — even though
    they weren't listed under skills. Example: a bullet or project description saying "built a
    website" supports adding "HTML" and "CSS"; "analyzed sales data in spreadsheets" supports
    "Microsoft Excel" or "Data analysis"; it does NOT support adding "Python" unless a
    language/tool is actually named or unambiguously implied.
  - This is NOT an exception to the no-fabrication rule — it's the same "is this claim TRUE
    according to FACTS_JSON" test used everywhere else in this prompt, just reading the evidence
    from a different field. Every inferred skill must be traceable to a specific sentence in
    FACTS_JSON if someone asked you to justify it. If you can't point to that sentence, leave the
    skill out.
  - "tailored_skills" being completely empty across every category is only acceptable if
    FACTS_JSON.skills, FACTS_JSON.experience, FACTS_JSON.projects, and RAW_ADDITIONAL_INFO all
    genuinely contain nothing to infer a skill from — this should be rare in practice.

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

For each entry in FACTS_JSON.experience (if any), return in "tailored_experience_titles":
  - "company": the "company" field EXACTLY as given in FACTS_JSON for that entry (used to match it back up — do not alter this one, including any " — venue" suffix it may have)
  - "title": the job title, localized/translated per the OUTPUT LANGUAGE instruction below. In English output this can be the same title cleaned up for capitalization; in Arabic output this MUST be an actual Arabic translation of the title, not the English title left as-is.

Return ONLY a JSON object in this exact format (no markdown):
{{
  "professional_summary": "3-5 sentence summary here, confident and specific, not generic filler",
  "bullets": [
    {{
      "original": "original bullet text here",
      "tailored": "rewritten bullet text here, meaningfully reworded, not a near-copy",
      "relevance_score": 0.9
    }}
  ],
  "tailored_projects": [
    {{
      "name": "Project name exactly as in facts_json",
      "display_name": "Properly Capitalized Name",
      "tailored_description": "2-3 polished, resume-style sentences here."
    }}
  ],
  "tailored_volunteer_work": ["Polished sentence for volunteer entry 1"],
  "tailored_experience_titles": [
    {{
      "company": "Company field exactly as in facts_json",
      "title": "Localized/translated job title"
    }}
  ],
  "tailored_skills": {{
    "languages": ["cleaned entries"],
    "frameworks": ["cleaned entries"],
    "tools": ["cleaned entries"],
    "soft_skills": ["cleaned entries"],
    "other": ["cleaned entries"]
  }}
}}
"""

# The dynamic half of the tailoring call — everything here changes per
# request, so none of it belongs in the cached system block above.
# language_instruction only has 2 possible values (en/ar) but is still kept
# here rather than in the system block, so that TAILORING_SYSTEM_PROMPT
# stays byte-identical across every call regardless of language — that's
# what makes English AND Arabic requests both hit the same cache instead of
# splitting into two separately-cached variants.
TAILORING_USER_TEMPLATE = """
{language_instruction}

FACTS_JSON:
{facts_json}

WEIGHT_FACTORS:
{weight_factors}

RAW_ADDITIONAL_INFO:
{additional_info}

Tailor the CV to match this job now, following the rules and output format given above.
"""

REGENERATION_PROMPT = """
The following bullet was REJECTED because it contains a claim not supported by VERIFIED FACTS:

BULLET: {bullet}
ISSUE: {issue}

Rewrite this bullet using ONLY facts from this JSON:
{facts_json}

Remove or fix specifically the unsupported claim described in ISSUE. Do NOT
otherwise flatten the bullet back toward the original phrasing, and do not
just swap out the one offending word or number while leaving the rest of the
sentence untouched. Rewrite the whole bullet with a different structure and
different verbs. The goal is a bullet that is fully supported by the facts
above AND still reads like a strong, elevated, thoroughly reworded resume
line, not a literal restatement of the source data with a minor edit.

Never use em dashes (—) or en dashes as punctuation. Use a comma or write two sentences instead.

{language_line}

Return ONLY the corrected bullet text, nothing else.
"""

# Second-pass corrective prompt — only used when an Arabic generation still
# has leftover Latin-script words after the first pass (see
# _find_latin_leaks / _enforce_arabic_purity below). Sends back exactly the
# JSON that was produced plus a pointer to which fields still have Latin
# text, and asks for ONLY a translation fix — not a full regeneration — so
# it can't accidentally re-introduce a fabrication the first pass avoided.
ARABIC_PURITY_FIX_PROMPT = """
You previously produced this JSON for an Arabic-language CV, but some fields
still contain English/Latin-script words that must not be there.

RULE: every string value in this JSON must be fully Modern Standard Arabic.
Technical terms, tool names, and framework names must be translated into
Arabic (e.g. "بايثون" not "Python", "واجهة برمجة التطبيقات" not "API").
Do not translate or alter anything under the "original" key of any bullet —
leave those exactly as they are. Do not add, remove, or invent any new
information — this is a translation pass only, not a rewrite.

FIELDS STILL CONTAINING LATIN TEXT: {offending_fields}

CURRENT JSON:
{current_json}

Return the corrected JSON in the exact same structure, with every remaining
Latin word replaced by its Arabic equivalent. Return ONLY the JSON, no
markdown, no explanation.
"""

_SKILL_CATEGORIES = ("languages", "frameworks", "tools", "soft_skills", "other")

# Matches any run of Latin letters. Used only for the Arabic-purity check —
# never applied to English-mode output.
_LATIN_WORD_RE = re.compile(r"[A-Za-z]{2,}")


def _build_language_instruction(cv_language: str) -> str:
    if cv_language == "ar":
        return """OUTPUT LANGUAGE — MANDATORY ARABIC RULES:
  - You MUST write ALL values completely in fluent, professional Modern Standard Arabic.
  - Absolutely NO English or Latin script characters are allowed in the generated fields.
  - Translate everything: Job titles (e.g., "مساعد مبيعات وخدمة عملاء"), Company names (e.g., "تيم لاب"), Project names, and Frameworks/Languages (e.g., write "بايثون" instead of "Python", and "واجهة برمجة التطبيقات" instead of "API"). This includes every "title" in "tailored_experience_titles" — do not leave a job title in English.
  - Do not mix English words into Arabic strings as it breaks layout rendering engines.
  - Numbers, years, and GPAs must stay as regular numerical digits (e.g., "2025", "4.27").
  - "original" inside each bullet object must remain exactly as it appears in FACTS_JSON without translation.
  - This rule matters MORE than fluent phrasing — if you are ever unsure how to translate a term, still translate it as best you can rather than leaving it in English. A slightly awkward Arabic phrase is always better than any English word appearing in the output."""
    
    return """OUTPUT LANGUAGE:
  - Write ALL generated text in professional English, regardless of what language FACTS_JSON or RAW_ADDITIONAL_INFO are written in."""


def _strip_dashes(text: str) -> str:
    if not text:
        return text
    return text.replace(" — ", ", ").replace(" – ", ", ").replace("—", ",").replace("–", ",")


def _find_latin_leaks(core_data: dict) -> list[str]:
    """
    Scans every generated field (except bullets[].original, which must stay
    untranslated on purpose) for leftover Latin-script words. Returns the
    list of field labels that still have Latin text, e.g.
    ["professional_summary", "bullets[2].tailored", "tailored_skills.tools"].
    Empty list means the output is clean.
    """
    offenders = []

    if _LATIN_WORD_RE.search(core_data.get("professional_summary") or ""):
        offenders.append("professional_summary")

    for i, b in enumerate(core_data.get("bullets", [])):
        if _LATIN_WORD_RE.search(b.get("tailored") or ""):
            offenders.append(f"bullets[{i}].tailored")

    for i, p in enumerate(core_data.get("tailored_projects", [])):
        if _LATIN_WORD_RE.search(p.get("display_name") or "") or _LATIN_WORD_RE.search(p.get("tailored_description") or ""):
            offenders.append(f"tailored_projects[{i}]")

    for i, v in enumerate(core_data.get("tailored_volunteer_work", [])):
        if _LATIN_WORD_RE.search(v or ""):
            offenders.append(f"tailored_volunteer_work[{i}]")

    for i, t in enumerate(core_data.get("tailored_experience_titles", [])):
        if _LATIN_WORD_RE.search(t.get("title") or ""):
            offenders.append(f"tailored_experience_titles[{i}].title")

    tailored_skills = core_data.get("tailored_skills", {}) or {}
    for cat, items in tailored_skills.items():
        if isinstance(items, list) and any(_LATIN_WORD_RE.search(str(item)) for item in items):
            offenders.append(f"tailored_skills.{cat}")

    return offenders


def _make_usage_recorder(usage_counters: dict):
    """
    Returns an on_usage callback for generate_claude_text that accumulates
    into usage_counters in place. usage_counters is a plain dict (not a
    class) so it survives being read after the function that created it
    returns, and so run_tailoring_engine can fold its final values straight
    into the dict it returns to LangGraph (see bottom of this file for why
    state updates are plain dicts, not live objects).
    """
    def _record(input_tokens: int, output_tokens: int):
        usage_counters["calls"] += 1
        usage_counters["input_tokens"] += input_tokens
        usage_counters["output_tokens"] += output_tokens
    return _record


def _enforce_arabic_purity(core_data: dict, usage_counters: dict) -> dict:
    """
    If the initial generation still has Latin-script leaks, sends ONE
    corrective pass asking Claude to translate only the offending fields,
    then re-parses and re-validates the result. If the fix call itself
    fails or still doesn't come back clean, logs it and returns the best
    version available rather than blocking the whole pipeline — same
    best-effort philosophy as the rest of this file.

    usage_counters is mutated in place: "arabic_purity_fired" is set True
    the moment we decide to run the corrective pass (regardless of whether
    it ends up succeeding), and "arabic_purity_still_bad" reflects whether
    leaks remained afterward.
    """
    offenders = _find_latin_leaks(core_data)
    if not offenders:
        return core_data

    usage_counters["arabic_purity_fired"] = True
    logger.warning(f"🔤 Arabic purity check found leftover Latin text in: {offenders} — running corrective pass...")

    prompt = ARABIC_PURITY_FIX_PROMPT.format(
        offending_fields=json.dumps(offenders, ensure_ascii=False),
        current_json=json.dumps(core_data, ensure_ascii=False),
    )

    try:
        raw = generate_claude_text(prompt, max_tokens=6000, on_usage=_make_usage_recorder(usage_counters))
        raw = re.sub(r"```json|```", "", raw).strip()
        fixed = json.loads(raw)

        # Only accept the fix if it's still the same shape (same bullet
        # count etc.) — if the model reshaped the JSON unexpectedly, keep
        # the original rather than risk corrupting the structure.
        if (
            isinstance(fixed, dict)
            and len(fixed.get("bullets", [])) == len(core_data.get("bullets", []))
        ):
            still_offending = _find_latin_leaks(fixed)
            usage_counters["arabic_purity_still_bad"] = bool(still_offending)
            if still_offending:
                logger.warning(f"🔤 Corrective pass still has Latin text in: {still_offending} — proceeding with best-effort result.")
            else:
                logger.info("✅ Arabic purity corrective pass succeeded — all fields now fully Arabic.")
            return fixed
        else:
            usage_counters["arabic_purity_still_bad"] = True
            logger.warning("🔤 Corrective pass returned an unexpected shape — keeping original output.")
            return core_data

    except Exception as e:
        usage_counters["arabic_purity_still_bad"] = True
        logger.error(f"🔤 Arabic purity corrective pass failed: {e} — proceeding with best-effort original output.")
        return core_data


def run_tailoring_engine(state: AgentState) -> dict:
    if state.get("error"):
        return {}

    facts_json      = state["facts_json"]
    weight_factors   = state["weight_factors"]
    additional_info  = state.get("additional_info", "") or ""
    cv_language      = state.get("cv_language", "en") or "en"
    attempts         = state.get("tailoring_attempts", 0) + 1

    # Accumulates across every generate_claude_text call this node makes
    # (main tailoring pass + Arabic purity pass, across however many of
    # the MAX_RETRIES loop below actually fire) — folded into the return
    # dict at the bottom so it merges into AgentState like everything else
    # this node already returns. See usage_tracker.py / UsageEvent for how
    # main.py reads these back out after the graph finishes.
    usage_counters = {
        "calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "arabic_purity_fired": False,
        "arabic_purity_still_bad": False,
    }

    def _cumulative_usage_fields() -> dict:
        """
        Builds the usage_* fields to return, ADDING this invocation's
        usage_counters on top of whatever was already in state — not
        replacing it. Needed because the fact-checker can loop back into
        this node up to MAX_TAILORING_ATTEMPTS times (see orchestrator.py),
        and LangGraph overwrites state keys on each node return rather than
        summing them (same reason `attempts` above is computed as
        state.get(...) + 1 instead of just returning 1). Without this,
        only the LAST round's token counts would survive in the final
        state, silently undercounting total spend on any multi-round run.
        arabic_purity_fired/still_bad are OR'd across rounds instead of
        summed, since they're flags, not counts — once true, stays true.
        """
        return {
            "usage_tailoring_calls": state.get("usage_tailoring_calls", 0) + usage_counters["calls"],
            "usage_tailoring_input_tokens": state.get("usage_tailoring_input_tokens", 0) + usage_counters["input_tokens"],
            "usage_tailoring_output_tokens": state.get("usage_tailoring_output_tokens", 0) + usage_counters["output_tokens"],
            "usage_arabic_purity_fired": bool(state.get("usage_arabic_purity_fired", False)) or usage_counters["arabic_purity_fired"],
            "usage_arabic_purity_still_bad": bool(state.get("usage_arabic_purity_still_bad", False)) or usage_counters["arabic_purity_still_bad"],
        }

    prompt = TAILORING_USER_TEMPLATE.format(
        facts_json      = json.dumps(facts_json, ensure_ascii=False),
        weight_factors  = json.dumps(weight_factors, ensure_ascii=False),
        additional_info = additional_info if additional_info.strip() else "(none provided)",
        language_instruction = _build_language_instruction(cv_language),
    )

    logger.info("🧠 Agent 3 — Tailoring Engine running (Claude Sonnet 5)...")

    
    MAX_RETRIES = 2
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # 3600 -> 6000: this is the single most content-heavy generation
            # in the pipeline (summary + every bullet + every project +
            # volunteer work + skills, all as one JSON object), and on
            # Sonnet 5, adaptive thinking (on by default) shares this same
            # budget with the visible output. generate_claude_text will
            # keep escalating automatically if 6000 still isn't enough for
            # a particularly long CV.
            #
            # system=TAILORING_SYSTEM_PROMPT: this is the prompt-caching
            # wire-up. Every call (English, Arabic, retry 1/2/3) sends the
            # exact same static instruction block here, so after the first
            # call in a ~5min window, subsequent calls read it from cache
            # instead of paying full input-token price for it again.
            raw = generate_claude_text(
                prompt,
                max_tokens=6000,
                on_usage=_make_usage_recorder(usage_counters),
                system=TAILORING_SYSTEM_PROMPT,
            )

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
                "tailored_projects": data.get("tailored_projects", []),
                "tailored_volunteer_work": data.get("tailored_volunteer_work", []),
                "tailored_experience_titles": data.get("tailored_experience_titles", []),
                "tailored_skills": data.get("tailored_skills", {}),
            }

            # Arabic-purity check + one corrective pass — see
            # _enforce_arabic_purity docstring. No-op for English CVs.
            if cv_language == "ar":
                core_data = _enforce_arabic_purity(core_data, usage_counters)

            validated = TailoredCV.model_validate({
                "professional_summary": core_data["professional_summary"],
                "bullets": core_data["bullets"],
            })
            bullets = [b.model_dump() for b in validated.bullets]

            tailored_projects = []
            for p in core_data.get("tailored_projects", []):
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
                _strip_dashes(str(v).strip()) for v in core_data.get("tailored_volunteer_work", []) if str(v).strip()
            ]

            tailored_experience_titles = []
            for t in core_data.get("tailored_experience_titles", []):
                if not isinstance(t, dict):
                    continue
                company = str(t.get("company", "")).strip()
                title = _strip_dashes(str(t.get("title", "")).strip())
                if company and title:
                    tailored_experience_titles.append({"company": company, "title": title})

            raw_skills = core_data.get("tailored_skills", {})
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
                "tailored_experience_titles": tailored_experience_titles,
                "tailored_skills": tailored_skills,
                "tailoring_attempts": attempts,
                "error": None,
                **_cumulative_usage_fields(),
            }

        except (json.JSONDecodeError, KeyError, ValidationError) as e:
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — bad output: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (invalid output): {e}",
                    **_cumulative_usage_fields(),
                    "hit_max_retries": True,
                }
        except Exception as e:
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — API error: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (API error): {e}",
                    **_cumulative_usage_fields(),
                    "hit_max_retries": True,
                }


def make_regeneration_fn(facts_json: dict, cv_language: str = "en", on_usage=None):
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
        # 300 -> 1000: same Sonnet 5 thinking-shares-the-budget issue as the
        # main call above. A single rewritten bullet is short, but if
        # thinking eats most of a 300-token budget there's nothing left for
        # the actual sentence.
        return generate_claude_text(prompt, max_tokens=1000, on_usage=on_usage).strip()

    return regenerate
