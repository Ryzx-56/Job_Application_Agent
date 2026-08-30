# agents/tailoring_engine.py
import json
import re
from loguru import logger
from pydantic import ValidationError
from core.state import AgentState
from core.llm_config import generate_claude_text, claude_budget, ClaudeTruncationError
from core.humanizer import HUMANIZER_RULES
from schemas.tailored_cv_schema import TailoredCV
from utils.arabic_localizer import (
    build_glossary,
    find_latin_terms,
    iter_strings,
    localize_structure,
    whole_latin_values,
)

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

READ-ONLY FIELDS — PRINTED VERBATIM, NEVER YOURS TO REWRITE:
  These FACTS_JSON fields are rendered onto the finished CV EXACTLY as they were extracted,
  and there is no slot for them in the JSON you return:
    major_achievements, training_courses, participation, publications,
    teaching_and_editorial, awards, certifications, education, additional_sections
  - Do NOT return them. Do NOT produce rewritten versions of them. Nothing you write about
    them reaches the document.
  - additional_sections is the CV's own sections that no other field covers — a surgeon's
    procedure counts, a pilot's flight hours, a researcher's grant totals. It is raw source
    data under the candidate's own headings, and it carries hard numbers that were checked by
    nobody but the candidate. NEVER restate, round, reformat, convert, re-derive or summarize
    any figure from it anywhere in your output. A paraphrased number is a fabricated number.
  - What these fields ARE for you: evidence. Read them to understand what this candidate has
    actually done, and let that inform the professional summary, the bullets you emphasize,
    and which JD keywords you can honestly cover. A skill demonstrated by a publication, a
    course or a committee role is a real skill and may go in tailored_skills.

FACTS_JSON.summary — the candidate's own profile paragraph from their CV:
  - Treat it as the primary source for "professional_summary". Cover its substance: the
    seniority, specialism, sector and focus it states are facts about this candidate, and
    losing them to a shorter, blander three-liner is a failure of this task.
  - Rewrite it for this specific job, in your own words and register — do not copy it back
    verbatim, and do not repeat any claim it makes that FACTS_JSON does not support elsewhere.

WHAT YOU SHOULD DO — BE BOLD HERE, THIS IS WHERE MOST OF YOUR VALUE IS:
  - Reword every bullet significantly — different verbs, different sentence shape, not a
    keyword swapped into an otherwise-untouched sentence. A bullet that still reads almost
    identically to the original is a failure of this task even if it's technically accurate.
    Rule of thumb: if more than a couple of words in a row still match the original verbatim
    (excluding proper nouns, numbers, and tool/skill names), rewrite it again.
  - LEAD WITH SCOPE OR OUTCOME, NOT THE TASK. Restructure each bullet so the first few words
    say what the candidate OWNED or what CHANGED, then how. The raw fact usually arrives as a
    flat activity ("Managed reception operations, ticket sales, and visitor check-in"); the
    tailored version should open on ownership and scale that is already implicit in that fact
    ("Ran front-of-house operations end to end for a high-traffic museum, covering ticketing,
    visitor check-in, and daily reception flow"). Nothing new was asserted there — the same
    facts were reordered and framed. Do this on EVERY bullet.
  - UPGRADE THE WHOLE SENTENCE, NOT JUST THE VERB. All four of these are phrasing changes, not
    new claims, and all four are explicitly wanted:
      * VERBS — "managed" -> "owned"/"ran"/"directed"; "helped with" -> "drove"/"supported
        delivery of"; "worked on" -> the specific action actually performed.
      * ADJECTIVES — characterize the work truthfully: "high-traffic", "customer-facing",
        "end-to-end", "day-to-day", "hands-on", "cross-functional", "production". Use them
        where the facts genuinely support them.
      * ADVERBS — describe how the work was done: "consistently", "directly", "proactively",
        "independently", "closely". These add texture without adding facts.
      * NOUNS — name things the way a professional CV would: "customers" -> "clients" /
        "visitors" / "stakeholders"; "reception work" -> "front-of-house operations";
        "fixing bugs" -> "defect resolution".
    The rule for all of these is identical: a word that RENAMES or CHARACTERIZES something
    already in FACTS_JSON is allowed. A word that introduces a number, a name, a tool, a team,
    a date, or an outcome that isn't in FACTS_JSON is not.
  - CALIBRATE THE SIZE OF THE CHANGE. Compare your "tailored" text against "original" before
    you return it. If a reader who saw both would call the second one "the same sentence,
    lightly edited", it is not finished. The intended distance is "clearly the same facts,
    obviously rewritten by a different and better writer."
  - What you must NOT do while being bold: add a number, a team size, a percentage, a duration,
    a tool, a client, or an outcome that is not already in FACTS_JSON or RAW_ADDITIONAL_INFO.
    Scope and framing are yours to shape. Facts are not.
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

<<HUMANIZER_RULES>>

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

FINAL CONSISTENCY CHECK before you output:
  - Skim what you're about to return as if you were reading the finished CV top to bottom. Bullets,
    project descriptions, and skills should read like one coherent document, not independently
    rewritten fragments — consistent tense (past tense for past roles), no two bullets claiming
    contradictory things, no term used one way in Skills and a different way in a bullet.
  - This is a coherence check on wording only, not a chance to add new claims — every fact still
    has to trace back to FACTS_JSON exactly as the rest of this prompt requires.

Tailor the CV to match this job. Follow the strict rules.

For each work-experience bullet, include:
  - "original": the exact original bullet text from FACTS_JSON
  - "tailored": your rewritten version using JD keywords
  - "relevance_score": a float from 0.0 to 1.0 rating how relevant this bullet is to the job description

For each project in FACTS_JSON.projects (if any), return in "tailored_projects":
  - "name": the project's name EXACTLY as given in FACTS_JSON (used to match it back up — do not alter this one)
  - "display_name": a resume-ready version of the name. Two different cases:
      1. If the original name is already a real, specific title (a product name, a branded project
         name, something with actual identity), just fix capitalization/spacing — do not rewrite it.
      2. If the original name is really just a vague description of what was done rather than an
         actual title (e.g. "i created a website", "made a todo app", "school project 3"), rewrite
         it into a short, proper title that names what the thing IS, grounded only in what
         "description" and "tech_stack" actually say it does — e.g. "i created a website" with a
         description mentioning a portfolio becomes "Personal Portfolio Website", not a generic
         invented name unrelated to the actual project. Never invent a purpose or feature that
         isn't in the description just to make the title sound more impressive.
  - "tailored_description": 1-2 professional, resume-style sentences.
  - "tech_stack": the technologies/tools used on this project. Start from FACTS_JSON.projects[].tech_stack
    if it has entries. If it's empty or thin, infer additional entries from what the project's own
    "description" text actually says was built or used — same grounded-inference rule as SKILLS
    CLEANUP below (a specific sentence in FACTS_JSON must support each entry; do not guess a
    technology that was never named or clearly implied). Do not leave "tech_stack" empty if the
    project description gives you anything concrete to work with.

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
      "tailored_description": "2-3 polished, resume-style sentences here.",
      "tech_stack": ["Technology 1", "Technology 2"]
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

# The anti-AI-writing rules are shared with the cover letter and the LinkedIn
# generator so all three hold one standard, and are spliced in here rather than
# copied into the string above. Substituted once at import: the result is
# byte-identical on every call, which is what keeps this block cacheable (see
# the note above and generate_claude_text's `system` docstring).
TAILORING_SYSTEM_PROMPT = TAILORING_SYSTEM_PROMPT.replace("<<HUMANIZER_RULES>>", HUMANIZER_RULES)

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

_SKILL_CATEGORIES = ("languages", "frameworks", "tools", "soft_skills", "other")

# facts_json fields that get RENDERED on the CV but that no agent
# translates — employer names, universities, degree titles, certifications,
# the candidate's city. These were the largest remaining source of English
# on an "Arabic" CV: the bullets came back in Arabic while the company and
# university sitting directly above them stayed in English. Their terms are
# folded into the same glossary so the whole document localizes together.
# Deliberately EXCLUDES personal.email / linkedin / github / phone —
# identifiers must render byte-for-byte.
def _facts_strings_for_glossary(facts_json: dict, include_name: bool = False) -> list[str]:
    facts_json = facts_json or {}
    personal = facts_json.get("personal", {}) or {}
    out: list[str] = []

    # personal.name is EXCLUDED BY DEFAULT.
    #
    # A name is not a translation problem. "Abdulmalik Hawsawi" has several
    # defensible Arabic spellings and only its owner knows which is theirs —
    # machine-transliterating it produced names that were simply wrong. The
    # name normally comes verbatim from profiles.name_ar / profiles.name_en
    # (see core/profile_names.py), on the same "preserve as-is" path that
    # already protects email, phone, LinkedIn and GitHub.
    #
    # include_name is the ONE exception: the user had no name saved for this
    # language and explicitly chose "generate without it". That's the legacy
    # path, and on it a transliterated name still beats a Latin name sitting
    # alone on an otherwise fully-Arabic CV. main.py sets name_fallback_used
    # in exactly that case, and nowhere else.
    if include_name and personal.get("name"):
        out.append(str(personal["name"]))
    if personal.get("location"):
        out.append(str(personal["location"]))

    for edu in facts_json.get("education", []) or []:
        for key in ("institution", "degree"):
            if edu.get(key):
                out.append(str(edu[key]))
        for key in ("distinctions", "relevant_coursework"):
            out.extend(str(item) for item in (edu.get(key) or []) if item)

    for exp in facts_json.get("experience", []) or []:
        for key in ("company", "title"):
            if exp.get(key):
                out.append(str(exp[key]))
        # cv_parser appends a venue/location sub-line onto `company`
        # ("TeamLab - Borderless Museum, Jeddah"). A tailored bullet
        # naturally refers to just the employer ("TeamLab"), which the full
        # composite string doesn't cover — so seed the bare name too, or the
        # employer stays in Latin everywhere it's mentioned in prose.
        company = str(exp.get("company") or "")
        for separator in (" - ", " — ", " – ", ","):
            if separator in company:
                head = company.split(separator)[0].strip()
                if head:
                    out.append(head)
                break

    out.extend(str(cert) for cert in (facts_json.get("certifications", []) or []) if cert)
    out.extend(str(v) for v in (facts_json.get("volunteer_work", []) or []) if v)
    if facts_json.get("summary"):
        out.append(str(facts_json["summary"]))

    # The named fields added for the content real CVs carry: achievements,
    # awards, teaching/editorial boards, courses, participation. All of these
    # RENDER, and no agent translates them — so without seeding their terms
    # here they would sit in English on an otherwise Arabic CV, which is the
    # exact bug the employer / university / certification lines above were
    # added to fix.
    #
    # DELIBERATELY ABSENT: publications and additional_sections. Those two
    # render verbatim in their original script even on an Arabic CV, and the
    # reasoning lives with the decision, in utils/cv_context.py — in short, a
    # translated citation can't be looked up, and phrase-level substitution
    # turned a "30-day complication rate" into a "daily" one. Not seeding
    # their terms is what makes that guarantee cheap AND real: no translation
    # is even requested for text that must not change, and the glossary stays
    # smaller (build_glossary caps at 120 terms, so a long publication list
    # would otherwise crowd out the employer and degree names that DO need
    # translating).
    out.extend(str(a) for a in (facts_json.get("major_achievements", []) or []) if a)
    out.extend(str(a) for a in (facts_json.get("awards", []) or []) if a)
    out.extend(str(t) for t in (facts_json.get("teaching_and_editorial", []) or []) if t)
    # Human languages now render too (see cv_context), and "Arabic (native)"
    # sitting in Latin script on an Arabic CV is the same leak as an
    # untranslated employer name.
    out.extend(str(lang) for lang in (facts_json.get("languages_spoken", []) or []) if lang)

    for course in facts_json.get("training_courses", []) or []:
        for key in ("name", "provider"):
            if course.get(key):
                out.append(str(course[key]))

    for item in facts_json.get("participation", []) or []:
        for key in ("title", "role", "organization", "scope"):
            if item.get(key):
                out.append(str(item[key]))

    for proj in facts_json.get("projects", []) or []:
        for key in ("name", "description"):
            if proj.get(key):
                out.append(str(proj[key]))
        out.extend(str(t) for t in (proj.get("tech_stack") or []) if t)

    for category in (facts_json.get("skills", {}) or {}).values():
        if isinstance(category, list):
            out.extend(str(s) for s in category if s)

    return out


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


def _enforce_arabic_purity(
    core_data: dict,
    usage_counters: dict,
    cv_language: str = "ar",
    facts_json: dict | None = None,
    include_name: bool = False,
) -> tuple[dict, dict]:
    """
    Localizes any leftover Latin text in an Arabic CV, and returns
    (localized_core_data, glossary).

    REWRITTEN: this used to re-send the entire tailored JSON and ask for a
    fully translated copy back. See utils/arabic_localizer.py's module
    docstring for why that was replaced — in short it was expensive enough
    to truncate (so the pass was billed and then discarded), it could
    reshape the JSON or reword an already-fact-checked claim, and it only
    ever covered the GENERATED fields while employer names, universities,
    degrees and certifications rendered on the same page stayed in English.

    Now: collect the distinct Latin terms from the generated fields AND from
    the raw facts fields that get rendered, translate them once as a small
    term glossary, and substitute deterministically. Structure cannot change,
    no claim can be reworded, and the returned glossary is reused by
    cv_context.py (for the raw facts) and document_generator.py (for the
    cover letter) so all three localize identically.

    usage_counters is mutated in place, same contract as before.
    """
    generated_strings = list(iter_strings({k: v for k, v in core_data.items() if k != "bullets"}))
    # bullets[].original is ground truth and must stay untranslated, so only
    # the tailored side of each bullet contributes terms.
    for bullet in core_data.get("bullets", []) or []:
        if isinstance(bullet, dict):
            generated_strings.append(bullet.get("tailored") or "")

    facts_strings = _facts_strings_for_glossary(facts_json or {}, include_name=include_name)
    all_strings = generated_strings + facts_strings

    # Whole short field values first (they're longer, and apply_glossary
    # substitutes longest-first, so a complete "B.Sc. Artificial
    # Intelligence" beats its own fragments) — then every sub-term found
    # anywhere, which is what catches tool names embedded mid-sentence.
    terms = whole_latin_values(facts_strings)
    for term in find_latin_terms(all_strings):
        if term not in terms:
            terms.append(term)
    terms.sort(key=len, reverse=True)

    if not terms:
        logger.info("✅ Arabic output is already fully Arabic — no localization pass needed.")
        return core_data, {}

    usage_counters["arabic_purity_fired"] = True
    logger.warning(f"🔤 Arabic localization: {len(terms)} Latin term(s) found (e.g. {terms[:6]}) — building glossary...")

    glossary = build_glossary(terms, on_usage=_make_usage_recorder(usage_counters))
    if not glossary:
        usage_counters["arabic_purity_still_bad"] = True
        logger.error("🔤 Glossary came back empty — proceeding with best-effort untranslated terms.")
        return core_data, {}

    localized = localize_structure(core_data, glossary, skip_keys=("original", "name"))

    # "name" is skipped above because tailored_projects[].name is the
    # join key cv_context.py matches back against facts_json.projects[].name
    # — translating it would silently orphan every project. The user-visible
    # "display_name" is localized normally.
    still_latin = find_latin_terms(
        [s for s in iter_strings({k: v for k, v in localized.items() if k != "bullets"})]
        + [(b.get("tailored") or "") for b in localized.get("bullets", []) or [] if isinstance(b, dict)]
    )
    usage_counters["arabic_purity_still_bad"] = bool(still_latin)
    if still_latin:
        logger.warning(f"🔤 Still Latin after localization: {still_latin[:6]} — proceeding with best-effort result.")
    else:
        logger.info("✅ Arabic localization complete — all generated fields are now fully Arabic.")

    return localized, glossary


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
                max_tokens=claude_budget(cv_language, "tailoring"),
                max_tokens_ceiling=claude_budget(cv_language, "tailoring_ceiling"),
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

            # Arabic localization — see _enforce_arabic_purity. No-op for
            # English CVs. The glossary rides through state so cv_context.py
            # can localize the raw facts fields and document_generator.py
            # can localize the cover letter with the SAME translations.
            arabic_glossary: dict = {}
            # ATS SCORING SOURCE — captured BEFORE Arabic localization.
            #
            # The ATS scorer matches the job description's keywords (English,
            # since that's what the JD is written in) against the CV's text.
            # Once the CV is translated to Arabic, that comparison can never
            # match anything, so every Arabic run scored 0% keywords and
            # 0% skills no matter how well the CV actually covered the role.
            # Keeping the English text the model produced, purely as scoring
            # input, makes the score reflect real coverage again. It is never
            # rendered — only utils/ats_scorer.py reads it.
            ats_source_text = ""
            ats_source_skills: dict = {}
            if cv_language == "ar":
                ats_source_text = " ".join(
                    s for s in iter_strings({k: v for k, v in core_data.items() if k != "bullets"}) if s
                ) + " " + " ".join(
                    (b.get("tailored") or "") for b in core_data.get("bullets", []) or [] if isinstance(b, dict)
                )
                raw_pre = core_data.get("tailored_skills", {}) or {}
                ats_source_skills = {
                    cat: [str(s) for s in items if str(s).strip()]
                    for cat, items in raw_pre.items() if isinstance(items, list)
                }

                core_data, arabic_glossary = _enforce_arabic_purity(
                    core_data,
                    usage_counters,
                    cv_language,
                    facts_json,
                    # Only true when the user generated without a saved
                    # Arabic name — see _facts_strings_for_glossary.
                    include_name=bool(state.get("name_fallback_used")),
                )

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
                raw_tech = p.get("tech_stack", [])
                tech_stack = (
                    [_strip_dashes(str(t).strip()) for t in raw_tech if str(t).strip()]
                    if isinstance(raw_tech, list) else []
                )
                if name and desc:
                    tailored_projects.append({
                        "name": name,
                        "display_name": display_name,
                        "tailored_description": desc,
                        "tech_stack": tech_stack,
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
                "arabic_glossary": arabic_glossary,
                "ats_source_text": ats_source_text,
                "ats_source_skills": ats_source_skills,
                "tailoring_attempts": attempts,
                "error": None,
                **_cumulative_usage_fields(),
            }

        # FAIL FAST: a response that overflowed the ceiling will overflow it
        # again on an identical prompt. Retrying was pure waste — it was the
        # single biggest source of burned tokens on failed Arabic runs (two
        # full generations, each escalating its budget, all discarded). Stop
        # on the first one and let the pipeline abort.
        except ClaudeTruncationError as e:
            logger.error(f"❌ Agent 3 output exceeded the max token budget and cannot be retried: {e}")
            return {
                "tailoring_attempts": attempts,
                "error": f"Agent 3 failed (output exceeded token budget): {e}",
                "fatal_error_code": "tailoring_failed",
                **_cumulative_usage_fields(),
                "hit_max_retries": True,
            }

        except (json.JSONDecodeError, KeyError, ValidationError) as e:
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — bad output: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (invalid output): {e}",
                    "fatal_error_code": "tailoring_failed",
                    **_cumulative_usage_fields(),
                    "hit_max_retries": True,
                }
        except Exception as e:
            logger.warning(f"Agent 3 attempt {attempt}/{MAX_RETRIES} failed — API error: {e}")
            if attempt == MAX_RETRIES:
                return {
                    "tailoring_attempts": attempts,
                    "error": f"Agent 3 failed after {MAX_RETRIES} retries (API error): {e}",
                    "fatal_error_code": "tailoring_failed",
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
        # the actual sentence. Arabic gets double, for the same
        # tokens-per-character reason as the main generation budgets.
        budget = 2000 if cv_language == "ar" else 1000
        return generate_claude_text(
            prompt, max_tokens=budget, max_tokens_ceiling=budget * 2, on_usage=on_usage
        ).strip()

    return regenerate
