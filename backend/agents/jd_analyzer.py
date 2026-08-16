import json
import random
import time

from loguru import logger
from pydantic import ValidationError

from core.llm_config import generate_gemini_json, generate_gemini_text
from schemas.jd_schema import WeightFactors
from core.state import AgentState


def _candidate_location(state: AgentState) -> str | None:
    """
    Where the candidate is, for location-qualifying the posting search.

    Best-effort and optional: with no location the search simply isn't
    location-qualified, which is the right behaviour rather than guessing a
    country. Reads the parsed CV first, since that's the candidate's own
    stated location.

    NOTE this runs in the same LangGraph superstep as cv_parser, so
    facts_json is usually still empty here — the profile location is what
    normally answers. Both are checked so the function is correct whichever
    order the graph ends up running in.
    """
    facts = state.get("facts_json") or {}
    parsed = ((facts.get("personal") or {}).get("location") or "").strip()
    if parsed:
        return parsed
    try:
        from agents.jobs_finder import _fetch_profile_location

        return _fetch_profile_location(state.get("user_id"))
    except Exception:
        return None

JD_ANALYSIS_PROMPT = """
You are an expert job description analyst.

Your task: extract structured data from the job description below.

RULES:
- Separate REQUIRED skills (explicitly stated as required/must-have) from PREFERRED skills (nice-to-have/bonus)
- ATS keywords HIGH = exact phrases an ATS system would scan for (copy phrasing from the JD)
- ATS keywords MEDIUM = related terms that appear in the JD but less critical
- Culture signals = tone words like "fast-paced", "ownership", "collaborative", "startup", "enterprise"
- Red flags = things like "10+ years required for a junior role", "unpaid", "equity only"
- Cover letter tone = a one-sentence instruction for how the cover letter should sound
- If company is not mentioned, use "Unknown"

JOB DESCRIPTION:
{job_description}

Respond ONLY in valid JSON matching this exact structure:
{{
  "job_title": "...",
  "company": "...",
  "seniority_level": "junior|mid|senior|lead",
  "required_skills": [...],
  "preferred_skills": [...],
  "years_experience_required": null or integer,
  "ats_keywords_high": [...],
  "ats_keywords_medium": [...],
  "culture_signals": [...],
  "education_requirement": "...",
  "red_flags": [...],
  "cover_letter_tone": "..."
}}
"""


# ─── TITLE-ONLY SUBMISSIONS ─────────────────────────────────────────────────
#
# Plenty of people paste "Data Analyst" into the job description box and press
# go. Analysing that directly returns a nearly empty WeightFactors — no
# required skills, no ATS keywords, no seniority, no culture signals — and
# every stage after this one is only as good as what it was handed:
# tailoring_engine has nothing to tailor toward, ats_scorer has no keywords to
# match, match_scorer compares the CV to two words.
#
# So a bare title is turned into a REPRESENTATIVE COMPOSITE of what that role
# actually asks for, built from real current postings pulled through the same
# search lanes the similar-jobs feature uses (see
# jobs_finder.fetch_postings_for_title).
#
# WHAT THIS IS AND ISN'T. The composite describes a ROLE, not a vacancy. It
# never names a company (company stays "Unknown"), never invents a specific
# employer's requirements, and is never shown to the user as a real posting.
# It is input to the tailoring stage, in the same slot a pasted JD would
# occupy. The fact-checker's guarantees are unaffected: they constrain what
# may be written about the CANDIDATE, and nothing here touches facts_json.
#
# The length ceiling is what separates "a title" from "a description". Real
# pasted JDs run to thousands of characters; a title is a line. A short but
# genuine JD fragment (say 200 characters of requirements) is left alone —
# it has real content to work from, and replacing it would discard what the
# user actually asked for.
_TITLE_ONLY_MAX_CHARS = 120

# Words that mean the text is describing a job rather than naming one. Any of
# these and it's treated as a real (if short) description, whatever its length.
_JD_STRUCTURE_MARKERS = (
    "responsib", "requirement", "qualificat", "experience", "skills",
    "we are looking", "you will", "about the role", "job description",
    "benefits", "salary", "duties", "المسؤول", "المتطلبات", "المؤهلات",
    "الخبرة", "المهارات", "الوصف الوظيفي", "المهام",
)

JD_SYNTHESIS_PROMPT = """
You are writing ONE representative job description for the role titled below,
based on several real, current postings for that same role.

WHAT TO PRODUCE:
A single job description of the length and shape a TYPICAL posting for this role
has: a short role summary, a responsibilities section, a required-qualifications
section, and a preferred-qualifications section.

THE MOST IMPORTANT RULE — WRITE THE TYPICAL POSTING, NOT ALL OF THEM COMBINED:
You are describing what this role USUALLY asks for, not everything any employer
has ever asked for. Merging every requirement from every source produces a role
no real candidate matches, which is worse than useless here.
- Include a requirement ONLY if it appears in AT LEAST HALF of the source
  postings. Drop anything that appears in only one or two of them, however
  reasonable it sounds.
- List AT MOST 6 required qualifications and AT MOST 4 preferred ones. That is
  what one real posting contains. If you have more, you have merged rather than
  summarised — cut to the most commonly required.
- Aim for roughly 200 to 300 words in total.

NAME THINGS, DON'T DESCRIBE THEM:
This description is matched against a real CV afterwards, so its vocabulary is
what decides whether a qualified candidate is recognised as one. Every
qualification must name the concrete tool, language, platform, degree or
credential the sources name.
- Write "SQL", "Power BI", "Excel", "Tableau", "Python".
- Do NOT write "data extraction", "data manipulation", "data visualisation
  competency", "analytical thinking", "stakeholder communication" or similar
  abstract capability phrases. A CV lists tools; a description written in
  abstractions cannot be matched against one, and a genuinely qualified
  candidate then scores as unqualified.
- If a source describes a capability without naming a tool, either name the tool
  the other sources use for it, or leave it out.

OTHER HARD RULES:
- Do NOT name any company, and do not describe any one employer's specifics.
  This describes the ROLE in general.
- Only use responsibilities, skills and qualifications that actually appear in
  the SOURCE POSTINGS below. Do not add requirements from your own knowledge of
  the field.
- Keep the seniority level the sources indicate. Do not turn a junior role into
  a senior one or vice versa.
- Prefer the sources' own everyday wording for skills and tools ("SQL", "Power
  BI", "Excel") over abstract restatements ("data querying competency"). The
  wording is what later gets matched against a CV, so plain terms matter.
- Do not invent salary figures, benefits, headcount, or locations that no source
  mentions.
- Write in English regardless of the language of the sources.
- Output ONLY the job description text. No preamble, no commentary, no markdown
  headings with '#', no mention of these instructions or of the sources.

ROLE TITLE: {job_title}

SOURCE POSTINGS:
{sources}
"""


def looks_like_bare_title(job_description: str) -> bool:
    """
    True when the "job description" is really just a job title.

    Deliberately conservative — it takes both a short length AND the absence
    of any JD-shaped wording. Getting this wrong in the permissive direction
    would replace a real (short) description the user chose to submit, which
    is worse than leaving a thin title-only run alone.
    """
    text = (job_description or "").strip()
    if not text or len(text) > _TITLE_ONLY_MAX_CHARS:
        return False
    if "\n" in text.strip():
        # More than one line means structure — a title is one line.
        lines = [line for line in text.splitlines() if line.strip()]
        if len(lines) > 1:
            return False
    lowered = text.lower()
    return not any(marker in lowered for marker in _JD_STRUCTURE_MARKERS)


def _format_sources(postings: list[dict], per_posting_chars: int = 2500) -> str:
    """The sourced postings as prompt text, each truncated so a handful of
    long pages can't blow the input budget."""
    blocks = []
    for index, posting in enumerate(postings, start=1):
        content = (posting.get("content") or "")[:per_posting_chars]
        blocks.append(
            f"--- SOURCE {index} ({posting.get('source') or 'unknown source'}) ---\n"
            f"Posting title: {posting.get('title') or ''}\n{content}"
        )
    return "\n\n".join(blocks)


def synthesize_jd_from_title(job_title: str, location: str | None = None) -> tuple[str, int]:
    """
    Builds a representative JD for a bare title out of real postings.

    Returns (composite_jd_text, postings_used). ("", 0) when nothing usable
    could be sourced or the composition call failed — the caller then falls
    back to analysing the bare title, which is the pre-existing behaviour and
    still produces a CV.
    """
    # Imported here rather than at module scope: jobs_finder imports the ATS
    # scorer and the Tavily client, and jd_analyzer runs on every request
    # including the ones that never need any of that.
    from agents.jobs_finder import fetch_postings_for_title

    postings = fetch_postings_for_title(job_title, location=location)
    if not postings:
        logger.warning(
            f"🧾 No usable postings found for title '{job_title}' — analysing the bare title instead."
        )
        return "", 0

    try:
        composite = generate_gemini_text(
            JD_SYNTHESIS_PROMPT.format(
                job_title=job_title.strip(),
                sources=_format_sources(postings),
            )
        ).strip()
    except Exception as e:
        logger.error(f"🧾 JD synthesis call failed for '{job_title}': {e}")
        return "", 0

    if len(composite) < 200:
        logger.warning(f"🧾 JD synthesis for '{job_title}' returned too little text — ignoring it.")
        return "", 0

    logger.info(
        f"🧾 Synthesized a representative JD for '{job_title}' from {len(postings)} real posting(s) "
        f"({len(composite)} chars)."
    )
    return composite, len(postings)


def run_jd_analyzer(state: AgentState) -> dict:
    job_description = state["job_description"]
    max_retries = 3
    last_error = None

    # A bare title becomes a representative JD before anything is analysed,
    # so every downstream stage sees JD-shaped content. The composite is
    # written back onto state["job_description"] (see the return below), which
    # is what gives match_scorer real text to compare against and what gets
    # stored on the resume — Interview Prep later refuses a resume whose
    # job_description is too short to work from.
    synthesized_from_title = False
    postings_used = 0
    if looks_like_bare_title(job_description):
        logger.info(f"🧾 Agent 2 — '{job_description.strip()}' looks like a title, not a description. Sourcing real postings...")
        location = _candidate_location(state)
        composite, postings_used = synthesize_jd_from_title(job_description, location=location)
        if composite:
            job_description = composite
            synthesized_from_title = True

    # cv_parser fires its Gemini call in the same LangGraph step. A $0-balance
    # account enforces a burst limit on concurrent requests within the same
    # second — this small jitter desyncs the two calls to avoid tripping it.
    time.sleep(random.uniform(0.6, 1.4))

    for attempt in range(1, max_retries + 1):
        try:
            raw_text = generate_gemini_json(
                JD_ANALYSIS_PROMPT.format(job_description=job_description)
            )
            data = json.loads(raw_text)
            weight_factors = WeightFactors.model_validate(data)

            print(f"[Agent 2] JD analyzed successfully on attempt {attempt}")
            update = {"weight_factors": weight_factors.model_dump(), "error": None}
            if synthesized_from_title:
                # Replace the bare title with the composite for every stage
                # after this one. match_scorer reads job_description directly,
                # main.py stores it on the resume, and Interview Prep later
                # reads it back off that row — all three would otherwise be
                # working from two words.
                update["job_description"] = job_description
                update["jd_synthesized_from_title"] = True
                update["jd_source_postings"] = postings_used
            return update

        except (json.JSONDecodeError, ValidationError) as e:
            last_error = e
            print(f"[Agent 2] Attempt {attempt} failed validation: {e}")

        except Exception as e:
            last_error = e
            print(f"[Agent 2] Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                time.sleep(3)  # short, burst-limit-appropriate pause before retrying

    return {"error": f"Agent 2 failed after {max_retries} attempts: {last_error}"}
