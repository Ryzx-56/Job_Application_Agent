# agents/interview_prep.py
#
# The Interview Prep add-on's only agent. ONE Claude Sonnet call over data the
# CV pipeline already produced, deliberately not a graph node: nothing in
# core/orchestrator.py runs for this feature and nothing here is wired into
# that graph. core/interview.py calls this directly.
#
# WHAT IT REUSES, AND WHY IT DOESN'T RE-ANALYZE ANYTHING
# ------------------------------------------------------
# The JD-vs-CV comparison this feature needs has already been done, three
# times over, and stored on the resumes row when the CV was generated:
#
#   · weight_factors   — agents/jd_analyzer.py's structured read of the JD:
#                        required vs preferred skills, seniority, ATS
#                        keywords, culture signals. Lives in
#                        generation_snapshot (see _SNAPSHOT_STATE_KEYS in
#                        main.py).
#   · ats_breakdown    — utils/ats_scorer.py's missing_skills and
#                        unmatched_keywords: the mechanical gap list.
#   · gap_analysis     — agents/match_scorer.py's judged gaps, each already
#                        carrying an honest how_to_close. THIS is what the
#                        "Gap" question category is built from; the honesty
#                        rule is inherited rather than reinvented.
#   · facts_json +     — the verified CV content every answer must be
#     tailored_*         traceable to.
#
# Re-running jd_analyzer here would spend a Gemini call to recompute an
# answer already sitting in the row, and could disagree with the gap list the
# user was shown on the same CV. It is therefore only used as a FALLBACK, for
# legacy rows saved before generation_snapshot existed.
#
# LANGUAGE: output follows the SOURCE CV's language, not the site toggle. An
# Arabic CV means an Arabic interview, so Arabic is the right answer rather
# than a compromise. Arabic runs go through the same purity pass
# tailoring_engine.py uses (utils/arabic_localizer.py's glossary), seeded
# with the glossary that CV was already localized with so the same employer
# and the same tool are named identically in both places.
#
# EXPLICITLY OUT OF SCOPE: no follow-up chat, no answer scoring, no voice, no
# stored session. One request, one set of questions.
import json
import re

from loguru import logger

from core.humanizer import HUMANIZER_RULES
from core.llm_config import generate_claude_text, ClaudeTruncationError
from schemas.interview_schema import (
    CATEGORIES,
    CONTENT_LIMITS,
    GAP_QUESTIONS_MIN,
    QUESTION_COUNT_MAX,
    QUESTION_COUNT_MIN,
    QUESTION_COUNT_TARGET,
    InterviewPrepContent,
)
from utils.arabic_localizer import (
    build_glossary,
    find_latin_terms,
    iter_strings,
    localize_structure,
)


class InterviewPrepError(RuntimeError):
    """Generation produced nothing usable. The caller turns this into a 502
    the page can offer a retry on. Nothing is consumed by a failure: this
    feature costs no credits, so a retry is free to the user."""


# ─── PROMPT ─────────────────────────────────────────────────────────────────
#
# Built with <<TOKEN>> placeholders and str.replace rather than str.format,
# same reason as linkedin_generator.py: the prompt carries a literal JSON
# example and doubling every brace to survive .format makes it unreadable.
#
# Assembled ONCE at import time and byte-identical on every call, which is
# what lets it be sent as generate_claude_text's cached `system` block. Every
# per-request value goes in the user turn below.

_INTERVIEW_SYSTEM_TEMPLATE = """
You are an experienced hiring manager and interview coach. You prepare a specific candidate
for a specific interview, using only what their CV actually contains and what the job
description actually asks for.

Your audience is a professional in Saudi Arabia / the wider MENA region.

WHAT YOU ARE GIVEN, AND WHAT IT MEANS:

- FACTS_JSON: the candidate's verified CV data. This is the ONLY source of truth about them.
- TAILORED_CV: how their experience was written up for this specific application.
- JOB_ANALYSIS: a structured read of the job description, already done. Its required_skills,
  preferred_skills, seniority_level and ats_keywords_high are what the employer actually
  cares about. Build questions around these, not around interviewing in general.
- KNOWN_GAPS: requirements this candidate does NOT clearly demonstrate, already identified by
  comparing the CV against this job. Each one may carry an honest "how_to_close". These are
  the raw material for your "gap" questions. Do not contradict them, and do not quietly
  decide a gap is actually covered when the CV does not show it.
- JOB_DESCRIPTION: the original posting, for exact phrasing.

FACTUAL RULES: THESE OVERRIDE EVERY OTHER INSTRUCTION:

- Never invent an employer, project, tool, metric, certification, date or responsibility. If
  FACTS_JSON does not contain it, the candidate has not done it.
- Every STAR answer must be traceable to a specific thing in FACTS_JSON or TAILORED_CV. If you
  cannot point to the sentence it comes from, do not write it.
- Never put a number in a "result" that is not in the CV. If the CV gives no metric, describe
  the outcome in words. An invented figure is the single worst thing you can produce here:
  the candidate will repeat it out loud to an interviewer.
- Never coach the candidate to claim a skill or experience they do not have. Never suggest
  implying, glossing over, or being vague about a real gap.
- Leave a STAR beat as an empty string rather than padding it with something you cannot
  support.

HOW MANY QUESTIONS: produce <<TARGET>> questions. Never fewer than <<MIN>>, never more than
<<MAX>>. Quality over count, but a short list is a failed answer.

THE FOUR CATEGORIES ("category" must be exactly one of these strings):

- "behavioral": how they have worked with people, handled pressure, owned a problem, dealt
  with failure. Anchored to a real situation from their CV, and chosen because of something
  in JOB_ANALYSIS.culture_signals or the role's actual duties.
- "technical": the tools, methods and domain knowledge in JOB_ANALYSIS.required_skills that
  the CV DOES demonstrate. Ask what a real interviewer would ask to check the depth is real.
- "role_specific": the day-to-day judgment of this exact role at this seniority level, the
  scenario questions a hiring manager asks to see whether someone has actually done the job.
- "gap": a requirement the CV does not clearly demonstrate. See below.

Cover all four. Weight them the way this specific role would be interviewed: a senior
engineering role earns more technical depth, a coordination-heavy role more behavioral.

"gap" QUESTIONS, THE MOST IMPORTANT PART:

- Produce at least <<GAP_MIN>> of them whenever KNOWN_GAPS is non-empty. These are the
  questions the candidate is least prepared for and the reason this page exists.
- Each one names a REAL requirement from the job that their CV does not evidence. Take them
  from KNOWN_GAPS first, and from JOB_ANALYSIS.required_skills that FACTS_JSON does not cover
  second.
- "gap_honesty" is required on these and MUST be an honest way to handle the question:
  acknowledge the gap plainly, then point at the closest real, adjacent thing they HAVE done,
  and at what they are concretely doing about it if the CV supports that. It is a script for
  telling the truth well, never a way to sound qualified for something they are not.
- On a gap question, "star" may draw on the closest genuinely adjacent experience the CV DOES
  contain, clearly framed as adjacent. If nothing in the CV is adjacent, leave the STAR beats
  empty and let "gap_honesty" carry the whole answer.
- "gap_honesty" must be empty ("") on every non-gap question.

EACH QUESTION'S FIELDS:

- "question": what the interviewer actually says, in their words. One question, not three
  stacked together. No preamble.
- "why_asked": one or two sentences on why THIS employer would ask THIS, naming the specific
  requirement, duty, tool or culture signal it comes from. Never a generic "interviewers like
  to know how you work".
- "jd_hook": the short phrase from the job description this comes from, under 15 words. Quote
  the posting's own wording where you can. If it comes from the role's seniority or shape
  rather than a quotable line, name that instead.
- "answer_angle": one or two sentences on how to frame the answer before the STAR beats. The
  strategy, not the content.
- "star": the suggested answer in four beats, from the candidate's REAL record.
    · situation: the real context, naming the real project, employer or course.
    · task: what they were actually responsible for.
    · action: what they specifically did, with the real tools named.
    · result: what actually came of it. Only use a number if the CV gives one.
- "cv_evidence": the names of the real CV items this answer draws on (a project name, an
  employer, a role title). 1 to 3 entries. These are checked against the CV, so use the names
  as they appear there.

<<LANGUAGE_INSTRUCTION>>

WRITING STYLE:

- Write to the candidate, second person, direct. "You led", not "the candidate led".
- The STAR beats are notes they will rehearse from, not a script to memorize. Concrete and
  short beats a polished paragraph.
- Every sentence carries information. No filler, no encouragement padding.

<<HUMANIZER_RULES>>

- One more, specific to this task: interview answers that sound machine-written are worse than
  useless, because the candidate will deliver them out loud and it will show. Write the way a
  competent professional actually describes their own work in a room.

Return ONLY a valid JSON object, no markdown fences, in EXACTLY this shape:

{
  "overview": "",
  "questions": [
    {
      "question": "",
      "category": "behavioral",
      "why_asked": "",
      "jd_hook": "",
      "answer_angle": "",
      "star": { "situation": "", "task": "", "action": "", "result": "" },
      "cv_evidence": [""],
      "gap_honesty": ""
    }
  ]
}

"overview" is two sentences at most: what this specific interview will turn on, given this
candidate against this job. Not a summary of the questions below it.
"""


_AR_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE, MANDATORY ARABIC RULES:

- The candidate's CV is in Arabic, so they are preparing for an Arabic interview. Write EVERY
  value in fluent, professional Modern Standard Arabic.
- No English or Latin script in any generated value. The job description and parts of the CV
  data below may be in English; answer in Arabic regardless, translating as you go.
- Translate everything: job titles, employer names, university names, project names, tools and
  frameworks. Write "بايثون" rather than "Python", "واجهة برمجة التطبيقات" rather than "API".
- "cv_evidence" is also Arabic. Name the project or employer as an Arabic reader would.
- Numbers, years and GPAs stay as ordinary digits ("2025", "4.27").
- "category" must stay exactly one of "behavioral", "technical", "role_specific", "gap" in
  English. It is a machine-read enum, not display text. The JSON keys stay English too. Only
  the VALUES are Arabic.
- This rule matters more than elegant phrasing. A slightly awkward Arabic phrase is always
  better than an English word in the output."""

_EN_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE:

- Write every value in professional English, regardless of what language the CV data or the
  job description are written in."""


def _render(template: str, **tokens) -> str:
    for key, value in tokens.items():
        template = template.replace(f"<<{key}>>", str(value))
    return template


def _build_system_prompt(language_instruction: str) -> str:
    return _render(
        _INTERVIEW_SYSTEM_TEMPLATE,
        HUMANIZER_RULES=HUMANIZER_RULES,
        TARGET=QUESTION_COUNT_TARGET,
        MIN=QUESTION_COUNT_MIN,
        MAX=QUESTION_COUNT_MAX,
        GAP_MIN=GAP_QUESTIONS_MIN,
        LANGUAGE_INSTRUCTION=language_instruction,
    )


# Two variants, both assembled at import time so each is byte-identical
# across requests and stays cacheable. An English run and an Arabic run are
# different cache entries, which is the same trade tailoring_engine makes.
_SYSTEM_PROMPT_EN = _build_system_prompt(_EN_LANGUAGE_INSTRUCTION)
_SYSTEM_PROMPT_AR = _build_system_prompt(_AR_LANGUAGE_INSTRUCTION)


_USER_TEMPLATE = """
ROLE_APPLIED_FOR: <<ROLE>>
COMPANY: <<COMPANY>>
CV_LANGUAGE: <<CV_LANGUAGE>>

JOB_ANALYSIS:
<<JOB_ANALYSIS>>

KNOWN_GAPS:
<<KNOWN_GAPS>>

FACTS_JSON:
<<FACTS_JSON>>

TAILORED_CV:
<<TAILORED_CV>>

JOB_DESCRIPTION:
<<JOB_DESCRIPTION>>

Prepare this person for this interview now, following the rules and the output format given
above. Return only the JSON object.
"""

# Output budget. Sonnet 5 runs adaptive thinking by default and those tokens
# count against max_tokens, so this needs real headroom above the JSON: 12-15
# questions with four STAR beats each is a large answer before any reasoning.
# Arabic gets roughly 1.7x for the same reason CLAUDE_BUDGETS does in
# core/llm_config.py, Arabic costs 2-3x the tokens for the same text.
#
# SIZED FROM A REAL RUN, NOT GUESSED: at 12000 a normal English run truncated
# and generate_claude_text escalated to 24000 to finish, which means the first
# full response was billed and thrown away and the user waited through two
# generations. max_tokens is a CAP, not a reservation, so setting it above
# what a run actually uses costs nothing; setting it below costs a whole
# discarded response. Both numbers are therefore set above the observed size
# with room for a 15-question answer.
_MAX_TOKENS = {"en": 24000, "ar": 40000}
_MAX_TOKENS_CEILING = {"en": 40000, "ar": 64000}

# How much of the raw posting to send. The structured JOB_ANALYSIS already
# carries the parts that matter; the raw text is included for exact phrasing
# in "jd_hook", and a pasted posting can be enormous.
_JD_CHARS_MAX = 6000


# ─── INPUT ASSEMBLY ─────────────────────────────────────────────────────────


def _tailored_cv_view(snapshot: dict) -> dict:
    """The tailored side of the CV, which is how this application presents
    the candidate. Same selection match_scorer.py feeds its own prompt, so
    both agents reason about the same picture of the person."""
    return {
        "summary": snapshot.get("tailored_summary"),
        "experience_titles": snapshot.get("tailored_experience_titles"),
        "bullets": snapshot.get("tailored_bullets"),
        "projects": snapshot.get("tailored_projects"),
        "skills": snapshot.get("tailored_skills"),
    }


def _merge_gaps(gap_analysis: list, ats_breakdown: dict) -> list[dict]:
    """
    One gap list from the two places the pipeline already recorded gaps.

    match_scorer.py's gap_analysis is the judged list and comes first: each
    entry is already an honest, human-readable gap with a how_to_close, which
    is exactly the shape a "gap" question needs. ats_scorer.py's raw
    missing_skills/unmatched_keywords are appended as bare mechanical signals
    for anything the scorer didn't write up, so a requirement the JD states
    plainly can't fall through both.
    """
    merged: list[dict] = []
    seen: set[str] = set()

    for gap in gap_analysis or []:
        if not isinstance(gap, dict):
            continue
        skill = str(gap.get("skill") or "").strip()
        if not skill or skill.lower() in seen:
            continue
        seen.add(skill.lower())
        merged.append({
            "requirement": skill,
            "importance": gap.get("importance") or "preferred",
            "honest_way_to_address": str(gap.get("how_to_close") or "").strip(),
            "source": "match_scorer",
        })

    breakdown = ats_breakdown or {}
    for key, importance in (("missing_skills", "required"), ("unmatched_keywords", "preferred")):
        for item in breakdown.get(key) or []:
            skill = str(item or "").strip()
            if not skill or skill.lower() in seen:
                continue
            seen.add(skill.lower())
            merged.append({
                "requirement": skill,
                "importance": importance,
                "honest_way_to_address": "",
                "source": "ats_scorer",
            })

    return merged


def _job_analysis(snapshot: dict, job_description: str) -> tuple[dict, bool]:
    """
    The stored jd_analyzer read of this posting, or a fresh one for a legacy
    row that predates generation_snapshot.

    Returns (analysis, reused). `reused` is False only on the fallback path,
    which the response surfaces so a support question about a weird result
    can be answered without guessing.
    """
    stored = (snapshot or {}).get("weight_factors")
    if isinstance(stored, dict) and stored:
        return stored, True

    # FALLBACK ONLY. jd_analyzer is a LangGraph node, so it's called with the
    # one state key it reads rather than being reimplemented here.
    logger.warning(
        "🧩 Interview prep found no stored weight_factors on this CV (legacy row), "
        "re-running jd_analyzer once to get the JD structure."
    )
    try:
        from agents.jd_analyzer import run_jd_analyzer

        result = run_jd_analyzer({"job_description": job_description})
        analysis = result.get("weight_factors")
        if isinstance(analysis, dict) and analysis:
            return analysis, False
        logger.warning(f"🧩 jd_analyzer fallback returned nothing usable: {result.get('error')}")
    except Exception as e:
        logger.warning(f"🧩 jd_analyzer fallback failed: {e}")

    # Not fatal: the raw JOB_DESCRIPTION is still in the prompt, so the model
    # has the posting even without the structured read of it.
    return {}, False


# ─── SERVER-SIDE VALIDATION ─────────────────────────────────────────────────


def _clamp(text, limit: int) -> str:
    """Trims a field to its cap at a word boundary. These are display caps,
    not an external system's limits, so a clean cut is all that's needed."""
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    cut = value[:limit]
    space = cut.rfind(" ")
    return (cut[:space] if space >= limit * 0.6 else cut).strip()


def _clean_evidence(values) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        item = _clamp(value, CONTENT_LIMITS["evidence"])
        key = item.lower()
        if not item or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= 3:
            break
    return out


def _postprocess(data: dict, role: str, company: str, language: str, reused: bool) -> InterviewPrepContent:
    """
    Validates the model's JSON, then enforces in code every rule the prompt
    only asked for. This is the half that has to be true regardless of what
    the model did.
    """
    content = InterviewPrepContent.model_validate(data)
    content.overview = _clamp(content.overview, CONTENT_LIMITS["overview"])

    clean = []
    for question in content.questions:
        question.question = _clamp(question.question, CONTENT_LIMITS["question"])
        if not question.question:
            continue  # a card with no question on it is not a card

        if question.category not in CATEGORIES:
            # Pydantic already rejects an unknown literal, so this only
            # catches a category that parsed but shouldn't steer the UI.
            question.category = "role_specific"

        question.why_asked = _clamp(question.why_asked, CONTENT_LIMITS["why_asked"])
        question.jd_hook = _clamp(question.jd_hook, CONTENT_LIMITS["jd_hook"])
        question.answer_angle = _clamp(question.answer_angle, CONTENT_LIMITS["answer_angle"])
        question.star.situation = _clamp(question.star.situation, CONTENT_LIMITS["star_part"])
        question.star.task = _clamp(question.star.task, CONTENT_LIMITS["star_part"])
        question.star.action = _clamp(question.star.action, CONTENT_LIMITS["star_part"])
        question.star.result = _clamp(question.star.result, CONTENT_LIMITS["star_part"])
        question.cv_evidence = _clean_evidence(question.cv_evidence)

        # gap_honesty belongs to gap questions and nowhere else. Left on a
        # technical question it would render an "how to be honest about not
        # having this" block under an answer that says they DO have it.
        if question.category == "gap":
            question.gap_honesty = _clamp(question.gap_honesty, CONTENT_LIMITS["gap_honesty"])
        else:
            question.gap_honesty = ""

        clean.append(question)

    content.questions = clean[:QUESTION_COUNT_MAX]
    content.role = role
    content.company = company
    content.language = "ar" if str(language).lower().startswith("ar") else "en"
    content.reused_stored_analysis = reused
    return content


# ─── ARABIC PURITY ──────────────────────────────────────────────────────────


def _readable_strings(payload: dict) -> list[str]:
    """Every string a user will actually read, which is everything except the
    category enum values. Those are English on purpose, so leaving them in
    would make every Arabic run look like it had leaked English."""
    return [text for text in iter_strings(payload) if text not in CATEGORIES]


def _enforce_arabic_purity(payload: dict, seed_glossary: dict | None) -> dict:
    """
    Localizes any leftover Latin text in an Arabic result, using the same
    glossary mechanism tailoring_engine.py's _enforce_arabic_purity uses (see
    utils/arabic_localizer.py for why a term glossary replaced re-generating
    the whole document).

    ONE ADDITION HERE: the CV this prep is built from was itself localized
    with a glossary, and that glossary is stored on the generation snapshot.
    Seeding with it means the employer, the university and the tools are named
    with exactly the same Arabic words the candidate's own Arabic CV uses.
    Without it the same employer could be "تيم لاب" on the CV and something
    else on the page they rehearse from, which is the kind of inconsistency
    a person notices immediately.

    Best-effort, exactly like the CV path: a failed glossary call leaves the
    text as it is rather than failing the run.
    """
    # "category" is a machine-read enum, English by design. localize_structure
    # skips the key so it can't be rewritten, and _readable_strings drops its
    # values so they never even reach the glossary as "untranslated terms".
    skip_keys = ("category",)

    seeded = dict(seed_glossary or {})
    if seeded:
        payload = localize_structure(payload, seeded, skip_keys=skip_keys)
        logger.info(f"🔤 Reused {len(seeded)} term(s) from this CV's own Arabic glossary.")

    terms = find_latin_terms(_readable_strings(payload))
    if not terms:
        logger.info("✅ Interview prep output is already fully Arabic, no localization pass needed.")
        return payload

    logger.warning(
        f"🔤 Interview prep Arabic localization: {len(terms)} Latin term(s) found "
        f"(e.g. {terms[:6]}), building glossary..."
    )
    fresh = build_glossary(terms)
    if not fresh:
        logger.warning("🔤 Glossary build returned nothing, leaving the Latin terms as they are.")
        return payload

    payload = localize_structure(payload, fresh, skip_keys=skip_keys)

    still_latin = find_latin_terms(_readable_strings(payload))
    if still_latin:
        logger.warning(f"🔤 Still Latin after localization: {still_latin[:6]}, proceeding best-effort.")
    else:
        logger.info("✅ Interview prep Arabic localization complete.")
    return payload


# ─── ENTRY POINT ────────────────────────────────────────────────────────────


def _parse_json(raw: str) -> dict:
    """Strips any markdown fence and parses. Claude has no native JSON
    response mode (see generate_claude_json in core/llm_config.py), so a
    stray fence is a normal thing to handle, not an error."""
    cleaned = re.sub(r"```json|```", "", raw or "").strip()
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("model returned JSON that isn't an object")
    return data


def run_interview_prep(
    resume_row: dict,
    snapshot: dict | None = None,
    on_step=None,
) -> dict:
    """
    Builds one interview prep set from a saved CV and the job description it
    was tailored against.

    resume_row: the resumes row, already ownership-checked by the caller.
        Needs job_description, and ideally generation_snapshot, ats_breakdown
        and gap_analysis, all of which the CV pipeline wrote when the CV was
        generated.
    snapshot: generation_snapshot, passed separately only so the caller can
        avoid re-reading it. Defaults to the one on the row.
    on_step: optional `fn(step: str)` called as each real phase begins, so a
        streaming caller can report honest progress. The steps are the ones
        this function actually has ("prepare", "generate", and "localize" on
        an Arabic run), not a fixed list padded out to look busier. Never
        called with anything the UI doesn't have a label for.

    Returns the InterviewPrepContent payload as a dict. Raises
    InterviewPrepError on failure; nothing is consumed, so the caller can
    offer a plain retry.
    """
    snapshot = snapshot if snapshot is not None else (resume_row.get("generation_snapshot") or {})
    snapshot = snapshot or {}

    job_description = str(resume_row.get("job_description") or "").strip()
    if not job_description:
        # The caller checks this too and gives the user a better message; this
        # is the guard for any other future caller.
        raise InterviewPrepError("This CV has no saved job description to prepare against.")

    facts_json = snapshot.get("facts_json") or {}
    if not facts_json.get("personal"):
        raise InterviewPrepError("This CV has no parsed data to build interview answers from.")

    language = str(
        snapshot.get("cv_language") or resume_row.get("cv_language") or "en"
    ).lower()
    is_arabic = language.startswith("ar")

    analysis, reused = _job_analysis(snapshot, job_description)
    gaps = _merge_gaps(resume_row.get("gap_analysis"), resume_row.get("ats_breakdown"))

    role = str(resume_row.get("role") or analysis.get("job_title") or "").strip()
    company = str(resume_row.get("company") or analysis.get("company") or "").strip()

    def _step(name: str) -> None:
        if on_step:
            on_step(name)

    _step("prepare")

    logger.info(
        f"🎤 Interview prep, {QUESTION_COUNT_TARGET} questions for '{role or 'this role'}' "
        f"in {'Arabic' if is_arabic else 'English'} "
        f"({len(gaps)} known gap(s), JD analysis {'reused' if reused else 'recomputed'})..."
    )

    user_prompt = _render(
        _USER_TEMPLATE,
        ROLE=role or "Not stated",
        COMPANY=company or "Not stated",
        CV_LANGUAGE="Arabic" if is_arabic else "English",
        JOB_ANALYSIS=json.dumps(analysis, ensure_ascii=False, indent=2),
        KNOWN_GAPS=json.dumps(gaps, ensure_ascii=False, indent=2),
        FACTS_JSON=json.dumps(facts_json, ensure_ascii=False, indent=2),
        TAILORED_CV=json.dumps(_tailored_cv_view(snapshot), ensure_ascii=False, indent=2),
        JOB_DESCRIPTION=job_description[:_JD_CHARS_MAX],
    )

    budget_key = "ar" if is_arabic else "en"
    system_prompt = _SYSTEM_PROMPT_AR if is_arabic else _SYSTEM_PROMPT_EN

    def _call() -> dict:
        raw = generate_claude_text(
            user_prompt,
            max_tokens=_MAX_TOKENS[budget_key],
            max_tokens_ceiling=_MAX_TOKENS_CEILING[budget_key],
            system=system_prompt,
        )
        return _parse_json(raw)

    _step("generate")

    try:
        data = _call()
    except ClaudeTruncationError as e:
        # Retrying the identical prompt that already overflowed the ceiling
        # just spends tokens to reach the same place. Same reasoning as
        # match_scorer.py and linkedin_generator.py.
        logger.error(f"❌ Interview prep hit the token ceiling and was not retried: {e}")
        raise InterviewPrepError("The questions came back too long to finish. Please try again.") from e
    except json.JSONDecodeError as e:
        logger.warning(f"Interview prep returned invalid JSON ({e}), retrying once.")
        try:
            data = _call()
        except Exception as retry_error:
            logger.error(f"❌ Interview prep JSON retry failed: {retry_error}")
            raise InterviewPrepError("Could not read the generated questions. Please try again.") from retry_error

    if is_arabic:
        # Same purity pattern as tailoring_engine.py, seeded with the glossary
        # this CV was localized with so both name things identically.
        _step("localize")
        data = _enforce_arabic_purity(data, snapshot.get("arabic_glossary"))

    try:
        content = _postprocess(data, role=role, company=company, language=language, reused=reused)
    except Exception as e:
        logger.error(f"❌ Interview prep output failed schema validation: {e}")
        raise InterviewPrepError("The generated questions were malformed. Please try again.") from e

    if len(content.questions) < QUESTION_COUNT_MIN:
        # The brief is "more than 10". Shipping 6 questions to someone about
        # to interview is worse than telling them to press the button again,
        # and a retry costs them nothing.
        logger.error(
            f"❌ Interview prep produced only {len(content.questions)} usable question(s), "
            f"below the {QUESTION_COUNT_MIN} minimum."
        )
        raise InterviewPrepError("Not enough questions came back. Please try again.")

    by_category = {category: 0 for category in CATEGORIES}
    for question in content.questions:
        by_category[question.category] += 1
    logger.info(
        f"✅ Interview prep ready: {len(content.questions)} questions "
        f"({', '.join(f'{n} {c}' for c, n in by_category.items() if n)})."
    )

    return content.model_dump()
