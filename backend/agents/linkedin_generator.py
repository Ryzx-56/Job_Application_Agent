# agents/linkedin_generator.py
#
# The LinkedIn add-on's only agent. ONE Claude Sonnet call over the
# facts_json a CV generation already produced — deliberately not a pipeline.
# Nothing in the existing CV graph (core/orchestrator.py) runs for this
# feature and nothing here is wired into that graph; this module is called
# directly by core/linkedin.py's /linkedin/generate endpoint.
#
# WHAT IT CONSUMES: facts_json, exactly as cv_parser.py produced it and as
# it was stored on resumes.generation_snapshot. It is read-only input here —
# no agent in the CV pipeline is modified, called, or re-run.
#
# ENGLISH, ALWAYS: every copy-paste field this returns is English even when
# the source CV is Arabic, because that is how LinkedIn is actually used in
# Saudi/MENA — profiles stay in English for reach. The Arabic facts get
# translated as part of generation. The results PAGE still follows the
# site's language toggle; only this output is fixed.
import json
import re

from loguru import logger

from core.llm_config import generate_claude_text, ClaudeTruncationError
from core.profile_names import has_arabic
from schemas.linkedin_schema import (
    ABOUT_BEST_RANGE,
    ABOUT_SKILLS_COUNT,
    ABOUT_VISIBLE_BEFORE_SEE_MORE,
    CONTENT_LIMITS,
    NOT_AVAILABLE,
    POST_IDEAS_COUNT,
    LinkedInContent,
)


class LinkedInGenerationError(RuntimeError):
    """Generation produced nothing usable. The caller marks the generation
    row 'failed', which by design does NOT consume the purchase — see the
    partial unique index in 008_linkedin_addon.sql — so the buyer can retry
    without paying again."""


class LinkedInLanguageError(LinkedInGenerationError):
    """Output still contained Arabic in copy-paste fields after a retry.
    Failing is the right outcome: half-Arabic content pasted into an English
    LinkedIn profile is worse than a retry, and the purchase survives."""


# ─── SHARED SKILLS-INFERENCE RULE ────────────────────────────────────────────
#
# The spec for the About box's 5 skills says: if the CV lists no skills,
# infer them from experience/projects "the same way the pipeline already
# does — reuse that logic, don't rewrite it".
#
# That logic is not a function. It lives as a block of prompt text inside
# tailoring_engine.py's TAILORING_SYSTEM_PROMPT (the "MISSING/EMPTY SKILLS"
# section), because the inference is done by the model, not by code. So it's
# reused the only way a prompt fragment can be: sliced out of the original
# string at import time. tailoring_engine.py is imported, never modified.
#
# If that section is ever renamed the slice fails, and rather than silently
# dropping the rule (or duplicating it here, which is the thing this avoids)
# we fall back to a one-line pointer at the same standard and log loudly so
# the drift is visible.
_SKILLS_RULE_START = "MISSING/EMPTY SKILLS"
_SKILLS_RULE_END = "FINAL CONSISTENCY CHECK"

_SKILLS_RULE_FALLBACK = (
    "  - If the CV lists no skills, infer them only from skills that are clearly and specifically\n"
    "    demonstrated by a sentence in FACTS_JSON.experience or FACTS_JSON.projects. Every inferred\n"
    "    skill must be traceable to a specific sentence. If you cannot point to that sentence,\n"
    "    leave the skill out."
)


def _shared_skills_inference_rule() -> str:
    """The canonical evidence-traceable skills-inference rule, quoted from
    the CV tailoring prompt so both features hold skills to one standard."""
    try:
        from agents.tailoring_engine import TAILORING_SYSTEM_PROMPT

        start = TAILORING_SYSTEM_PROMPT.index(_SKILLS_RULE_START)
        end = TAILORING_SYSTEM_PROMPT.index(_SKILLS_RULE_END, start)
        block = TAILORING_SYSTEM_PROMPT[start:end].strip()
        if not block:
            raise ValueError("empty skills-inference block")
        return block
    except Exception as e:
        logger.warning(
            "⚠️ Could not quote the shared skills-inference rule from "
            f"tailoring_engine.TAILORING_SYSTEM_PROMPT ({e}). Using the short fallback — "
            f"check whether the '{_SKILLS_RULE_START}' section was renamed."
        )
        return _SKILLS_RULE_FALLBACK


# ─── PROMPT ─────────────────────────────────────────────────────────────────
#
# Built with <<TOKEN>> placeholders and str.replace rather than str.format,
# because the prompt contains a large literal JSON example and doubling every
# brace to survive .format makes it unreadable and easy to break.
#
# The result is assembled ONCE at import time and is byte-identical on every
# call, which is what lets it be sent as generate_claude_text's cached
# `system` block. Nothing per-request is spliced into it — the CV goes in the
# user turn below.

_LINKEDIN_SYSTEM_TEMPLATE = """
You are an expert LinkedIn profile writer. You turn a candidate's verified CV data into
ready-to-paste LinkedIn profile content: the exact text they will paste into each box on
LinkedIn, plus clear instructions for the sections LinkedIn makes them type in themselves.

Your audience is a professional in Saudi Arabia / the wider MENA region applying to roles
where recruiters read LinkedIn in English.

OUTPUT LANGUAGE — MANDATORY, NO EXCEPTIONS:

- EVERY value you return is in professional English. Every headline, every line of the About
  text, every skill, every job title, every company name, every description, every post idea.
- The CV data may be written in Arabic. If it is, TRANSLATE it into English as part of your
  work. Never pass Arabic text through into any field.
- Arabic organization, university, city and job-title names must be rendered in English —
  use the organization's own official English name when it has a well-known one (for example
  "جامعة الملك عبدالعزيز" is "King Abdulaziz University"), otherwise a faithful English
  rendering. Do not leave the Arabic, and do not put the Arabic in brackets next to it.
- The only exception is a proper name that is genuinely written in Latin script already —
  keep it as-is.

FACTUAL RULES — THESE OVERRIDE EVERY STYLE INSTRUCTION:

- Never invent a company, job title, date, degree, certification, metric, tool or skill.
  If FACTS_JSON does not contain it, it does not exist.
- Where a structured field has no data in FACTS_JSON, return exactly "<<NA>>". Do not guess a
  plausible employment type, a likely city, or a probable date range.
- You may rewrite, reframe, sharpen and reorder what IS there, and you may translate it.
  You may not add facts.
- CANDIDATE_FIRST_NAME and CANDIDATE_LAST_NAME are given to you in the user message. Use
  them exactly as given for the name fields. Never transliterate or re-spell a person's name.

LINKEDIN CHARACTER LIMITS — these are real limits enforced by LinkedIn, and they are also
validated after you answer. Content over the limit gets cut, so write inside them:

- Headline: <<HEADLINE_LIMIT>> characters maximum.
- About / Summary: <<ABOUT_LIMIT>> characters maximum. Aim for <<ABOUT_BEST_MIN>>-<<ABOUT_BEST_MAX>>
  characters — that is the range that reads as substantial without becoming a wall of text.
- Experience description, per role: <<EXPERIENCE_LIMIT>> characters maximum.
- Any position/job title: <<TITLE_LIMIT>> characters maximum.
- Any single skill: <<SKILL_LIMIT>> characters maximum.

SECTION-BY-SECTION INSTRUCTIONS:

1. INTRO ("intro") — this mirrors LinkedIn's "Edit intro" box. Pull it from FACTS_JSON, do not
   invent it:
   - first_name / last_name: exactly as given in the user message.
   - headline: the one field that decides whether a recruiter keeps reading. Write a specific,
     role-focused headline naming what they do and their strongest specialization or domain.
     No "passionate about", no "aspiring", no buzzword strings, no emoji.
   - current_position: their most recent role's title if FACTS_JSON shows one, else "<<NA>>".
   - industry: the LinkedIn-style industry that fits their actual field (e.g. "Information
     Technology & Services", "Financial Services", "Civil Engineering").
   - education: their most recent education entry, as "Degree, Institution" when both exist.
   - location: their location from FACTS_JSON, else "<<NA>>".

2. ABOUT ("about"):
   - "text": first-person, confident, specific. The first <<ABOUT_VISIBLE>> characters are the
     only part LinkedIn shows before "…see more", so FRONT-LOAD the strongest, most concrete
     line — never open with a generic throwaway sentence. Cover: what they do, the evidence
     (real projects/roles/results from FACTS_JSON), the specialization, and what they are
     looking to do next. Short paragraphs, blank line between them, no markdown, no bullet
     characters, no emoji, no hashtags.
   - "skills": exactly <<SKILLS_COUNT>> skills, the ones most worth showing on their profile.
     Take them from the CV's own skills where it has them. If the CV's skills are empty or very
     thin, infer them under the rule quoted below.

   SKILLS-INFERENCE RULE — quoted verbatim from the CV tailoring pipeline so both features hold
   inferred skills to exactly one standard. It is written in terms of "tailored_skills"; here it
   applies to the "about.skills" list and to each role's "skills" list:

<<SKILLS_RULE>>

3. EXPERIENCE ("experience") — ONE entry per role in FACTS_JSON.experience, newest first,
   laid out like LinkedIn's "Add experience" modal so it can be filled in top to bottom:
   - job_title, organization, location, location_type ("On-site" / "Hybrid" / "Remote"),
     employment_type ("Full-time" / "Part-time" / "Internship" / "Freelance" / "Contract" /
     "Self-employed"), start_date and end_date ("Month YYYY" when the CV gives a month,
     "YYYY" when it only gives a year), is_current (true only when the CV clearly shows the
     role is ongoing).
   - Any of those the CV does not answer is exactly "<<NA>>". location_type and employment_type
     are very often not in a CV — "<<NA>>" is the correct answer then, not a guess.
   - "highlights": 3-5 punchy first-person achievement lines for this role, based on the CV's
     own bullets for it. LinkedIn's register is more direct and personal than a CV's: "I led",
     "I built", "I cut". Keep every number and outcome that is in FACTS_JSON; add none.
   - "description": the highlights assembled into the single block they will paste into the
     role's description box. Put each highlight on its own line, no bullet characters
     (LinkedIn does not render them), under <<EXPERIENCE_LIMIT>> characters.
   - "skills": up to 5 skills to tag on this specific role, evidenced by this role's own content.
   - If FACTS_JSON.experience is empty, return an empty list. Do not manufacture a role.

4. FEATURED ("featured") — only if FACTS_JSON contains real links (personal.github,
   personal.portfolio, personal.linkedin, or a project url). One item per link, each with a
   "label" ("GitHub", "Portfolio", the project's name), the "url" exactly as it appears in
   FACTS_JSON, and a short "instruction" telling them what to add and why it helps. If there
   are NO links at all, return null for "featured" — do not return an empty list and do not
   tell them to create a portfolio.

5. POST IDEAS ("post_ideas") — exactly <<POST_IDEAS_COUNT>>, each tied to something they
   actually did. Name the real project, role or result in the idea. "Post about how you built
   [the real project name]" is right; "post about your career journey" is not. Each has a
   "title" (what the post is about), an "angle" (2-3 sentences on what to say and why people
   would care), and a "draft_hook" (the actual opening line they can paste, under 220
   characters, no hashtags).

6. EDUCATION AND CERTIFICATIONS ("education_and_certifications") — LinkedIn requires these to
   be entered directly as structured entries, so this section is instructions plus the data to
   type in, not text to paste:
   - "instruction": tell them to add these themselves, and why (LinkedIn matches schools and
     issuers to real entities, which is what makes them searchable).
   - "education_entries": one per FACTS_JSON.education entry (school, degree, dates), with
     "<<NA>>" for anything missing.
   - If FACTS_JSON.certifications HAS entries: "certifications_note" tells them to add their
     existing certificates, naming them, and "recommended_certifications" is an empty list.
   - If FACTS_JSON.certifications is EMPTY: "recommended_certifications" gives 2-3 real,
     genuinely relevant certifications for their actual field, each with "name", "issuer" and
     a "why" of one sentence. These are recommendations, never presented as already held.

7. PROJECTS ("projects"):
   - If FACTS_JSON.projects has entries: one "entries" item per project, with a written
     LinkedIn-ready "description" (2-3 sentences, first person, grounded strictly in that
     project's real data), and an "instruction" telling them to add these under Projects.
     Leave "recommended" empty.
   - If it has NO projects AND their field normally expects them (software, data, design,
     engineering, product, marketing analytics): leave "entries" empty and give 2-3
     "recommended" project ideas that suit their specific specialization, each with "name",
     "why" (one sentence on what it demonstrates to a recruiter) and a "description" they
     could adapt once they have actually built it.
   - If their field does not typically expect a projects section, leave both lists empty and
     say so in "instruction".

8. GROWTH PLAYBOOK ("growth_playbook") — the profile-visibility guidance, unlocked after
   purchase. "title" is a short heading. "steps" is 5-6 concrete, specific actions covering:
   getting past 500 connections and who to connect with in THEIR field, a realistic posting
   cadence, engaging on other people's posts, keywords recruiters in their field actually
   search for, and turning on Open To Work / recruiter visibility. Name their field. No filler.

WRITING STYLE:

- First person, active voice, specific. Every sentence should carry information.
- Never use em dashes or en dashes. Use commas, periods, or separate sentences.
- No markdown, no asterisks, no bullet characters, no emoji, no hashtags anywhere in any value.
- No quotation marks wrapping a whole field — the values get copied straight to the clipboard
  and pasted into LinkedIn exactly as returned.

Return ONLY a valid JSON object, no markdown fences, in EXACTLY this shape:

{
  "intro": {
    "first_name": "",
    "last_name": "",
    "headline": "",
    "current_position": "",
    "industry": "",
    "education": "",
    "location": ""
  },
  "about": {
    "text": "",
    "skills": ["", "", "", "", ""]
  },
  "featured": [
    { "label": "", "url": "", "instruction": "" }
  ],
  "experience": [
    {
      "job_title": "",
      "organization": "",
      "location": "",
      "location_type": "",
      "employment_type": "",
      "start_date": "",
      "end_date": "",
      "is_current": false,
      "description": "",
      "highlights": [""],
      "skills": [""]
    }
  ],
  "post_ideas": [
    { "title": "", "angle": "", "draft_hook": "" }
  ],
  "education_and_certifications": {
    "instruction": "",
    "education_entries": [{ "school": "", "degree": "", "dates": "" }],
    "certifications_note": "",
    "recommended_certifications": [{ "name": "", "issuer": "", "why": "" }]
  },
  "projects": {
    "instruction": "",
    "entries": [{ "name": "", "description": "" }],
    "recommended": [{ "name": "", "why": "", "description": "" }]
  },
  "growth_playbook": {
    "title": "",
    "steps": [""]
  }
}
"""


def _render(template: str, **tokens) -> str:
    for key, value in tokens.items():
        template = template.replace(f"<<{key}>>", str(value))
    return template


LINKEDIN_SYSTEM_PROMPT = _render(
    _LINKEDIN_SYSTEM_TEMPLATE,
    NA=NOT_AVAILABLE,
    HEADLINE_LIMIT=CONTENT_LIMITS["headline"],
    ABOUT_LIMIT=CONTENT_LIMITS["about"],
    ABOUT_BEST_MIN=ABOUT_BEST_RANGE[0],
    ABOUT_BEST_MAX=ABOUT_BEST_RANGE[1],
    ABOUT_VISIBLE=ABOUT_VISIBLE_BEFORE_SEE_MORE,
    EXPERIENCE_LIMIT=CONTENT_LIMITS["experience_description"],
    TITLE_LIMIT=CONTENT_LIMITS["position_title"],
    SKILL_LIMIT=CONTENT_LIMITS["skill"],
    SKILLS_COUNT=ABOUT_SKILLS_COUNT,
    POST_IDEAS_COUNT=POST_IDEAS_COUNT,
    SKILLS_RULE=_shared_skills_inference_rule(),
)


_USER_TEMPLATE = """
CANDIDATE_FIRST_NAME: <<FIRST_NAME>>
CANDIDATE_LAST_NAME: <<LAST_NAME>>
SOURCE_CV_LANGUAGE: <<SOURCE_LANGUAGE>>

FACTS_JSON:
<<FACTS_JSON>>

Write this person's LinkedIn content now, in English, following the rules and the output
format given above. Return only the JSON object.
"""

# Appended to the user turn on the one retry we allow after Arabic text slips
# into the output. Deliberately concrete about which fields were wrong —
# repeating the same prompt verbatim would just reproduce the same mistake.
_LANGUAGE_CORRECTION = """
CORRECTION — YOUR PREVIOUS ANSWER WAS REJECTED:

It contained Arabic text in these fields: <<FIELDS>>

Every value must be English. Translate the Arabic source data instead of copying it through.
Organization, university, city and job-title names must be given in English. Regenerate the
complete JSON object with no Arabic characters in any value.
"""

# Output budget. Sonnet 5 runs adaptive thinking by default and those tokens
# count against max_tokens, so this needs headroom well above the size of the
# JSON itself: a CV with several roles lands around 3-4k output tokens, and
# the reasoning about headline/About framing is the part worth paying for.
# Output is always English, so there is no Arabic multiplier here (unlike
# CLAUDE_BUDGETS in core/llm_config.py) — only the INPUT may be Arabic.
_MAX_TOKENS = 9000
_MAX_TOKENS_CEILING = 24000


# ─── SERVER-SIDE VALIDATION ─────────────────────────────────────────────────


_SENTENCE_END_RE = re.compile(r"[.!?](?=\s|$)")


def _clamp(text: str, limit: int, label: str) -> str:
    """Hard guarantee that no field exceeds LinkedIn's limit for it.

    The prompt already asks for content inside these limits; this is what
    makes it true. Cuts at a sentence boundary when there's one in the last
    quarter of the allowed text, else at a word boundary, so a clamped field
    still reads as finished rather than stopping mid-word.
    """
    text = (text or "").strip()
    if len(text) <= limit:
        return text

    logger.warning(f"✂️ LinkedIn {label} came back at {len(text)} chars, over the {limit} limit — trimming.")
    cut = text[:limit]

    sentence_ends = [m.end() for m in _SENTENCE_END_RE.finditer(cut)]
    if sentence_ends and sentence_ends[-1] >= limit * 0.75:
        return cut[: sentence_ends[-1]].strip()

    last_space = cut.rfind(" ")
    if last_space >= limit * 0.5:
        return cut[:last_space].strip()
    return cut.strip()


def _clean_list(values, limit: int, label: str, max_items: int | None = None) -> list[str]:
    """De-duplicates, drops blanks, clamps each entry, and caps the count."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        item = _clamp(str(value), limit, label)
        key = item.lower()
        if not item or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if max_items and len(out) >= max_items:
            break
    return out


def _or_na(value: str) -> str:
    """Empty structured field -> the explicit placeholder, so the UI never
    shows a blank box the user has to guess about."""
    return (value or "").strip() or NOT_AVAILABLE


def _arabic_fields(node, path: str = "") -> list[str]:
    """Paths of every string in the payload that still contains Arabic.
    Reuses core/profile_names.has_arabic rather than defining a second
    Arabic-detection regex in the codebase."""
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            found.extend(_arabic_fields(value, f"{path}.{key}" if path else str(key)))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            found.extend(_arabic_fields(value, f"{path}[{index}]"))
    elif isinstance(node, str) and has_arabic(node):
        found.append(path or "(root)")
    return found


def _split_name(full_name: str) -> tuple[str, str]:
    """First token is the given name, everything after it is the family name.
    Applied to the name the USER typed in their profile (profiles.name_en) —
    never to a transliteration, which is why this only ever splits a string
    somebody chose for themselves."""
    parts = (full_name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _postprocess(data: dict, name_en: str, source_cv_language: str) -> dict:
    """Validates the model's JSON against the schema, then enforces every
    limit and placeholder rule in code. This is the half that has to be true
    regardless of what the model did."""
    content = LinkedInContent.model_validate(data)

    # The person's name comes from their profile, never from the model. Same
    # principle the CV pipeline enforces (see apply_candidate_names in
    # main.py): a name has several valid spellings and only its owner knows
    # which is theirs, so it is never machine-generated or re-spelled.
    first, last = _split_name(name_en)
    if first:
        content.intro.first_name = first
        content.intro.last_name = last

    content.intro.headline = _clamp(content.intro.headline, CONTENT_LIMITS["headline"], "headline")
    content.intro.current_position = _clamp(
        _or_na(content.intro.current_position), CONTENT_LIMITS["position_title"], "current position"
    )
    content.intro.industry = _or_na(content.intro.industry)
    content.intro.education = _or_na(content.intro.education)
    content.intro.location = _or_na(content.intro.location)

    content.about.text = _clamp(content.about.text, CONTENT_LIMITS["about"], "about text")
    content.about.skills = _clean_list(
        content.about.skills, CONTENT_LIMITS["skill"], "skill", max_items=ABOUT_SKILLS_COUNT
    )

    for role in content.experience:
        role.job_title = _clamp(_or_na(role.job_title), CONTENT_LIMITS["position_title"], "job title")
        role.organization = _or_na(role.organization)
        role.location = _or_na(role.location)
        role.location_type = _or_na(role.location_type)
        role.employment_type = _or_na(role.employment_type)
        role.start_date = _or_na(role.start_date)
        # A current role has no end date to state; LinkedIn's own field reads
        # "Present" there, so match that rather than printing "N/A".
        role.end_date = "Present" if role.is_current else _or_na(role.end_date)
        role.description = _clamp(
            role.description, CONTENT_LIMITS["experience_description"], "experience description"
        )
        role.highlights = [h.strip() for h in role.highlights if (h or "").strip()]
        role.skills = _clean_list(role.skills, CONTENT_LIMITS["skill"], "role skill", max_items=5)

    # An empty Featured list means "nothing to feature" — collapse it to None
    # so the results page omits the section instead of rendering an empty box.
    if content.featured:
        content.featured = [item for item in content.featured if (item.url or "").strip()]
    if not content.featured:
        content.featured = None

    content.post_ideas = content.post_ideas[:POST_IDEAS_COUNT]
    content.growth_playbook.steps = [s.strip() for s in content.growth_playbook.steps if (s or "").strip()][:8]

    content.source_cv_language = "ar" if str(source_cv_language).lower().startswith("ar") else "en"
    return content.model_dump()


# ─── ENTRY POINT ────────────────────────────────────────────────────────────


def _parse_json(raw: str) -> dict:
    """Strips any markdown fence the model added and parses. Claude has no
    native JSON response mode (see generate_claude_json in
    core/llm_config.py), so a stray fence is a normal thing to handle."""
    cleaned = re.sub(r"```json|```", "", raw or "").strip()
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("model returned JSON that isn't an object")
    return data


def _call_model(user_prompt: str) -> dict:
    raw = generate_claude_text(
        user_prompt,
        max_tokens=_MAX_TOKENS,
        max_tokens_ceiling=_MAX_TOKENS_CEILING,
        system=LINKEDIN_SYSTEM_PROMPT,
    )
    return _parse_json(raw)


def run_linkedin_generator(
    facts_json: dict,
    name_en: str,
    source_cv_language: str = "en",
) -> dict:
    """
    Generates one person's complete LinkedIn content from the facts_json a CV
    generation already produced.

    facts_json: read straight off resumes.generation_snapshot — the same
        structure cv_parser.py produces. Never mutated here.
    name_en: the English spelling of their name from profiles.name_en. The
        endpoint requires it before calling (409 otherwise) rather than
        letting a name be transliterated into someone's public profile.
    source_cv_language: "en" or "ar". Only affects logging and the recorded
        provenance — the OUTPUT is English either way.

    Returns the LinkedInContent payload as a dict, ready to store in
    linkedin_generations.generated_content.

    Raises LinkedInGenerationError / LinkedInLanguageError on failure. The
    caller records a failed generation, which leaves the purchase intact and
    retryable.
    """
    if not (facts_json or {}).get("personal"):
        raise LinkedInGenerationError("The selected CV has no parsed data to build a profile from.")

    source_is_arabic = str(source_cv_language).lower().startswith("ar")
    first, last = _split_name(name_en)

    logger.info(
        f"💼 LinkedIn generator — building English profile content from a "
        f"{'n Arabic' if source_is_arabic else 'n English'} CV (Claude Sonnet, single call)..."
    )

    user_prompt = _render(
        _USER_TEMPLATE,
        FIRST_NAME=first or NOT_AVAILABLE,
        LAST_NAME=last or NOT_AVAILABLE,
        SOURCE_LANGUAGE="Arabic" if source_is_arabic else "English",
        FACTS_JSON=json.dumps(facts_json, ensure_ascii=False, indent=2),
    )

    try:
        data = _call_model(user_prompt)
    except ClaudeTruncationError as e:
        # Retrying the identical prompt that already overflowed the ceiling
        # just spends tokens to reach the same place — same reasoning as
        # match_scorer.py's handling of this error.
        logger.error(f"❌ LinkedIn generation hit the token ceiling and was not retried: {e}")
        raise LinkedInGenerationError("The profile came back too long to complete. Please try again.") from e
    except json.JSONDecodeError as e:
        logger.warning(f"LinkedIn generation returned invalid JSON ({e}) — retrying once.")
        try:
            data = _call_model(user_prompt)
        except Exception as retry_error:
            logger.error(f"❌ LinkedIn generation JSON retry failed: {retry_error}")
            raise LinkedInGenerationError("Could not read the generated profile. Please try again.") from retry_error

    # ENGLISH-ONLY GATE. Cheap to check, and the one rule of this feature a
    # user would immediately see us breaking.
    arabic_paths = _arabic_fields(data)
    if arabic_paths:
        logger.warning(
            f"🔁 LinkedIn output had Arabic in {len(arabic_paths)} field(s) "
            f"({', '.join(arabic_paths[:6])}) — regenerating once with a correction."
        )
        corrected_prompt = user_prompt + _render(
            _LANGUAGE_CORRECTION, FIELDS=", ".join(arabic_paths[:12])
        )
        try:
            data = _call_model(corrected_prompt)
        except Exception as e:
            raise LinkedInGenerationError("Could not generate English profile content. Please try again.") from e

        arabic_paths = _arabic_fields(data)
        if arabic_paths:
            logger.error(
                f"❌ LinkedIn output still contained Arabic after a correction pass: "
                f"{', '.join(arabic_paths[:6])}"
            )
            raise LinkedInLanguageError(
                "The generated profile still contained Arabic text, so it wasn't delivered. "
                "Please try generating again."
            )

    try:
        content = _postprocess(data, name_en=name_en, source_cv_language=source_cv_language)
    except Exception as e:
        logger.error(f"❌ LinkedIn output failed schema validation: {e}")
        raise LinkedInGenerationError("The generated profile was malformed. Please try again.") from e

    logger.info(
        f"✅ LinkedIn content ready — headline {len(content['intro']['headline'])} chars, "
        f"about {len(content['about']['text'])} chars, {len(content['experience'])} role(s), "
        f"{len(content['post_ideas'])} post idea(s)."
    )
    return content
