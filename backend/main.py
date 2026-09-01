import os
import json
import re
import uuid
import threading
import concurrent.futures
import uvicorn
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from loguru import logger

# Initialize environment variables from .env immediately
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv(), override=True)


# Import pipeline structures
from core.state import AgentState
from core.orchestrator import app as graph
from core.auth import get_current_user_id, get_current_user_id_query_or_header
from core.credits import reserve_credits, refund_credits, get_credits, normalize_cv_language
from core.subscription import cancel_subscription, resume_subscription
from core.location import router as location_router
from core.documents import router as documents_router
from core.admin_stats import router as admin_stats_router
from core.badges import router as badges_router
# Self-contained LinkedIn add-on (purchases, generation, history, premium
# fulfillment queue). Nothing in the CV pipeline calls into it and it calls
# nothing in the pipeline — it only READS the facts_json a CV generation
# already saved. See core/linkedin.py.
from core.linkedin import router as linkedin_router
# Interview Prep (Pro/Elite). Like the LinkedIn add-on it sits outside the CV
# graph and only READS what a CV generation already saved — here the stored
# jd_analyzer/ats_scorer/match_scorer output on the resumes row. Stores
# nothing of its own. See core/interview.py.
from core.interview import router as interview_router
# Standalone Job Search (Pro/Elite). Like the two add-ons above it sits
# outside the CV graph entirely — it takes a job title and nothing else, and
# reuses agents/jobs_finder.py's search pipeline. See core/job_search.py.
from core.job_search import router as job_search_router
# One-time payments (credit packs + the LinkedIn premium add-on). Owns the
# shared "verify a Moyasar payment, then grant what it bought" function that
# the callback route and the webhook both call, so the two can never drift.
# See core/payments.py.
from core.payments import router as payments_router
from core.profile_names import (
    router as profile_names_router,
    get_profile_names,
    required_name_for,
)
from core.usage_tracker import UsageEvent
from core.rate_limit import enforce, GENERATION
from utils.uploads import read_upload_capped, MAX_CV_UPLOAD_BYTES
from utils.pdf_parser import extract_text_from_pdf, UnsupportedCVFormat
from utils.cv_photo import extract_candidate_photo
from utils.pdf_generator import render_cv_pdf, render_cover_letter_pdf
from utils.docx_generator import generate_cv_docx
from utils.template_registry import DEFAULT_TEMPLATE_ID, template_supports_photo
from schemas.manual_cv_request import ManualCVRequest

# 1. Initialize FastAPI Application Instance
app = FastAPI(
    title="Job Application Multi-Agent Pipeline API",
    description="Production-grade backend orchestration engine for automated application tailoring.",
    version="1.0.0"
)

# 2. Configure Cross-Origin Resource Sharing (CORS)
#
# BUG FIX: this used to be allow_origins=["*"] — every origin on the
# internet was allowed to call this API. Now a real allowlist, driven by
# ALLOWED_ORIGINS (comma-separated) so Render/local can differ without a
# code change; falls back to the hardcoded defaults below if that env var
# isn't set. The regex additionally covers Vercel's per-branch/per-PR
# preview deployment subdomains (e.g. tarshih-git-some-branch-xyz.vercel.app),
# which aren't a fixed string and can't live in a plain allowlist.
_DEFAULT_ALLOWED_ORIGINS = [
    "https://tarshih.com",
    "https://www.tarshih.com",
    "https://tarshih-ryzx.vercel.app",  # current live URL until the custom domain is fully cut over
    "http://localhost:3000",             # local Next.js dev server
]
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = (
    [origin.strip() for origin in _allowed_origins_env.split(",") if origin.strip()]
    if _allowed_origins_env
    else _DEFAULT_ALLOWED_ORIGINS
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https://tarshih-.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(location_router)
app.include_router(documents_router)
app.include_router(profile_names_router)
app.include_router(admin_stats_router)
app.include_router(badges_router)
app.include_router(linkedin_router)
app.include_router(interview_router)
app.include_router(job_search_router)
app.include_router(payments_router)

OUTPUT_DIR = "outputs"

# BUG FIX: the old constants below (RESUME_PDF_PATH etc.) pointed every user
# at the exact same three filenames — "outputs/tailored_cv.pdf" and so on.
# Two people generating close together could overwrite each other's file
# before either downloaded it, and there was no check that a download
# request's file actually belonged to the requester — anyone authenticated
# could hit /api/v1/download/cv and get whatever the last-written file
# happened to be, not necessarily their own.
#
# Fix: every generation gets a unique filename built from the AUTHENTICATED
# caller's own user_id (from the JWT, never client-suppliable) plus a fresh
# request_id. Download/preview endpoints reconstruct the same path using
# the CALLER'S OWN verified user_id — so even a stolen/guessed request_id
# can only ever resolve to a path under the guesser's own user_id, which
# won't exist. That's a 404, not someone else's CV. No database table
# needed — ownership is encoded directly in the filename.
_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_id_component(value: str, label: str) -> str:
    """Defense against path traversal — request_id arrives as a raw query
    param from the client, so it must be strictly validated before it ever
    touches a filesystem path. user_id comes from the verified JWT, not the
    client directly, but validating both the same way costs nothing."""
    if not value or not _SAFE_ID_RE.match(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {label}.")
    return value


def make_request_id() -> str:
    return uuid.uuid4().hex


def assign_request_id(initial_state: AgentState) -> str:
    """Generates this request's id AND stamps it onto the state.

    The two belong together: the id names this request's output files (see
    output_paths) and the agents log it, so a log line, a generated file and
    a download URL can all be traced back to the same run. Setting it on the
    state is what carries it into the graph — see the request_id note in
    core/state.py.
    """
    request_id = make_request_id()
    initial_state["request_id"] = request_id
    return request_id


def read_uploaded_cv(cv_bytes: bytes) -> str:
    """
    Parses an uploaded CV, turning an unreadable file into a clean 400 with
    a message the user can act on.

    This runs BEFORE reserve_credits() in both upload endpoints, which is
    deliberate — a file we can't read costs the user nothing. Previously a
    .docx upload (which the file picker explicitly allows) raised PyMuPDF's
    FileDataError straight out of the endpoint as an opaque 500.
    """
    try:
        return extract_text_from_pdf(pdf_bytes=cv_bytes)
    except UnsupportedCVFormat as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "unreadable_upload", "message": str(e)},
        )


def read_uploaded_photo(cv_bytes: bytes, template_id: str | None) -> str:
    """
    Pulls the candidate's photo out of the same uploaded bytes, locally.

    Runs beside read_uploaded_cv rather than inside it because the two
    answer different questions: text is REQUIRED (no text means a 400 and
    no credit spent), a photo is entirely optional. Nothing here can fail
    the request — utils/cv_photo.py swallows its own errors and this only
    normalizes None to "" for the state field.

    Skipped outright unless the chosen template has a photo slot. Most
    templates don't, and decoding every embedded image in a CV to produce a
    string nothing will read is work no user should wait for. It also means
    a face is only ever extracted when the user picked a layout that shows
    one.

    No Gemini/vision call is involved. See utils/cv_photo.py's docstring.
    """
    if not template_supports_photo(template_id):
        return ""
    return extract_candidate_photo(cv_bytes) or ""


def apply_candidate_names(initial_state: AgentState, user_id: str, allow_name_fallback: bool) -> None:
    """
    Loads profiles.name_en / name_ar onto the state, and REFUSES the run if
    the name for this output language hasn't been provided yet.

    Why refuse rather than transliterate: a personal name has several valid
    spellings in another script and only its owner knows which is theirs, so
    generating one produces a document with the wrong name on it — worse
    than asking. The frontend catches this 409, shows the field pre-filled
    with anything readable off the uploaded CV, and retries.

    allow_name_fallback is the explicit escape hatch (the "generate anyway"
    option). It permits the legacy behavior — the CV's parsed name run
    through the Arabic glossary — and records name_fallback_used so we can
    see how many users are still landing on it.

    Called BEFORE reserve_credits in every endpoint: being asked for your
    name must never cost a credit.
    """
    names = get_profile_names(user_id)
    initial_state["profile_name_en"] = names.get("name_en")
    initial_state["profile_name_ar"] = names.get("name_ar")
    initial_state["name_fallback_used"] = False

    cv_language = initial_state["cv_language"]
    has_name, field = required_name_for(cv_language, names)
    if has_name:
        return

    if allow_name_fallback:
        initial_state["name_fallback_used"] = True
        logger.warning(
            f"👤 LEGACY NAME PATH: user {user_id} generating a '{cv_language}' CV without {field}. "
            f"Falling back to the CV's parsed name; it may be machine-transliterated."
        )
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "missing_profile_name",
            "field": field,
            "cv_language": cv_language,
            "message": (
                "Add your name in Arabic before generating an Arabic CV."
                if field == "name_ar"
                else "Add your name in English before generating an English CV."
            ),
        },
    )


def output_paths(user_id: str, request_id: str) -> dict:
    """Builds this request's three file paths. Both components are
    validated first since request_id (at least) comes from client input at
    download time."""
    user_id = _validate_id_component(user_id, "user id")
    request_id = _validate_id_component(request_id, "request id")
    prefix = os.path.join(OUTPUT_DIR, f"{user_id}_{request_id}")
    return {
        "cv_pdf": f"{prefix}_tailored_cv.pdf",
        "cv_docx": f"{prefix}_tailored_cv.docx",
        "cover_letter_pdf": f"{prefix}_cover_letter.pdf",
    }

SHORT_SAMPLE_JD = """
Position: Machine Learning Engineer (AI Systems)
Location: Jeddah, Saudi Arabia

Key Responsibilities:
- Design, build, and optimize scalable Machine Learning and Deep Learning models.
- Implement structured pipelines using NLP techniques, clustering (GMM), and sequence modeling (LSTM/GRU).
- Extract and process insights from raw unstructured text data or structured JSON frames.
- Collaborate with software development teams to integrate predictive endpoints into production APIs.
"""

def make_initial_state(cv_text: str, jd_text: str, template_id: str = DEFAULT_TEMPLATE_ID) -> AgentState:
    """Instantiates a structured state map adhering strictly to the AgentState definition."""
    return AgentState(
        raw_cv_text=cv_text,
        job_description=jd_text,
        jd_synthesized_from_title=False,
        jd_source_postings=0,
        input_mode="upload",
        manual_cv_data={},
        additional_info="",
        cv_language="en",
        template_id=template_id or DEFAULT_TEMPLATE_ID,
        facts_json={},
        weight_factors={},
        tailored_bullets=[],
        tailored_summary="",
        tailored_projects=[],
        tailored_volunteer_work=[],
        tailored_skills={},
        tailored_experience_titles=[],
        arabic_glossary={},
        hallucination_flags=[],
        fact_check_passed=False,
        fact_check_unavailable=False,
        cover_letter_text="",
        cv_pdf_path="",
        cover_letter_pdf_path="",
        ats_score=0,
        score_breakdown={},
        gap_analysis=[],
        job_match_score=0,
        job_match_reason="",
        overall_recommendation="",
        similar_jobs=[],
        tailoring_attempts=0,
        error=None,
        current_step="start",
        fatal_error_code=None,
        hit_max_retries=False,
        user_id=None,
        # Filled in by apply_candidate_names() before the graph runs.
        profile_name_en=None,
        profile_name_ar=None,
        name_fallback_used=False,
        # Filled in by read_uploaded_photo() on the upload routes. Stays ""
        # for the manual 'Create New CV' flow — there's no file to mine.
        candidate_photo="",
        # Stamped by assign_request_id() once the run is actually going
        # ahead (i.e. past the name check and the credit reservation).
        request_id="",
    )


# A CV whose text is shorter than this is too small to judge coverage on —
# a one-page graduate CV legitimately extracts to very little.
_MIN_SOURCE_CHARS_FOR_COVERAGE = 1500

# How much of the uploaded CV's text must survive into facts_json. This is
# set low on purpose — it is here to catch a catastrophic partial extraction
# (a name and almost nothing else), NOT to police quality, because a false
# positive refuses a run the user could otherwise have had.
#
# IT IS NO LONGER THE ONLY SIGNAL, because on its own it produced exactly
# the false positive it was meant to avoid. The ratio measures the SHAPE OF
# THE SOURCE DOCUMENT as much as the quality of the extraction:
#   - FactsJSON has no field for a lot of what real CVs contain — summary /
#     objective, publications, references, hobbies, memberships, and the
#     personal-details block (nationality, date of birth, marital status)
#     that is standard on Saudi CVs. That text is permanently in the
#     denominator and can never reach the numerator, so a narrative-heavy or
#     academic CV scores near zero no matter how perfectly it was read.
#   - _facts_content_length also excludes `personal` by design.
# A real run was refused this way: 4 education entries, 16 experience
# entries and full skills/certifications/awards lists — an unambiguously
# successful extraction — rejected at 7% because the source was prose-heavy.
# _populated_fact_groups below is the structural signal that now decides
# those cases; this ratio only rules on extractions with no structure to
# judge, which is the failure it was actually written for.
_MIN_EXTRACTION_COVERAGE = 0.15

# Agent 1's fact groups. A CV always has at least one CORE group — someone
# with no experience, no education and no projects has nothing to tailor —
# so finding none of them is the real signature of a gutted extraction.
_CORE_FACT_GROUPS = ("experience", "education", "projects")
_SUPPORTING_FACT_GROUPS = (
    "skills", "certifications", "languages_spoken", "volunteer_work", "awards",
    # Added with the facts_schema expansion. These MUST be listed here and in
    # _FACT_CONTENT_GROUPS below, or the gate gets systematically worse as the
    # schema gets better: content that now extracts correctly would still be
    # missing from both the numerator and the structure count, so a CV whose
    # substance is publications, courses and its own sections would look
    # emptier to this check than it did before those fields existed.
    "summary", "major_achievements", "training_courses", "participation",
    "publications", "teaching_and_editorial", "additional_sections",
)

# Every group whose characters count as "extracted content" — the fact groups
# above plus the two core ones the structure check treats separately.
# `personal` is excluded by design (see _facts_content_length).
_FACT_CONTENT_GROUPS = tuple(dict.fromkeys(_CORE_FACT_GROUPS + _SUPPORTING_FACT_GROUPS))

# How many groups must be populated before the extraction counts as
# structurally sound. Two is deliberately low: the catastrophic failure this
# gate exists to catch returns a name and at most one stray field, while any
# genuine extraction lands three or more.
_MIN_POPULATED_FACT_GROUPS = 2


def _facts_content_length(facts: dict) -> int:
    """Characters of real extracted content in facts_json, ignoring the
    contact block (which survives even a badly truncated extraction).

    Reads _FACT_CONTENT_GROUPS rather than its own hardcoded tuple, so a
    field added to the schema can't be counted by the structure check and
    forgotten by the character count — they were two separate lists, and the
    second one is the numerator of the coverage ratio this gate refuses runs
    on. The walk below is shape-agnostic (strings, lists, nested dicts), so
    additional_sections' {section_title, entries} objects are counted without
    needing a case of their own."""
    total = 0
    stack = [facts.get(key) for key in _FACT_CONTENT_GROUPS]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            total += len(item)
        elif isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return total


def _populated_fact_groups(facts: dict) -> list[str]:
    """Which of Agent 1's fact groups actually came back with content.

    Independent of the source document's length and formatting, which is
    the whole point — this is what tells a genuine extraction apart from a
    gutted one when the character ratio can't (see _MIN_EXTRACTION_COVERAGE).
    """
    populated = []
    for key in _CORE_FACT_GROUPS + _SUPPORTING_FACT_GROUPS:
        value = facts.get(key)
        # `skills` is a dict of category -> list, not a list. Flatten it so an
        # all-empty skills block doesn't count as populated on the strength of
        # its category keys alone.
        if isinstance(value, dict):
            value = [item for sublist in value.values() for item in (sublist or [])]
        if value:
            populated.append(key)
    return populated


def _pipeline_produced_usable_cv(result_state: dict) -> bool:
    """
    True signal that Agent 1 (cv_parser / manual_cv_parser) actually
    extracted real data, rather than the pipeline running end-to-end on an
    empty facts_json after a silent upstream failure (e.g. Gemini rate
    limit exhausted all retries). personal.name is the one field Agent 1
    is required to populate — checking it is a general, non-hardcoded
    signal that works no matter *why* Agent 1 failed.

    THE NAME CHECK ALONE WAS NOT ENOUGH. It catches a WHOLLY empty
    extraction and nothing else, so a PARTIAL one — name present, most of
    the document missing — passed every gate and rendered as though it were
    complete. The user was charged for a CV with most of their career
    silently absent from it, which is the failure mode this second check
    closes: if the uploaded document clearly had substance and almost none
    of it reached facts_json, that is a failed extraction, not a short CV.

    Never judges on a fixed entry count, since "how many jobs should this CV
    have" is unknowable and varies wildly. Skipped entirely for manual entry,
    where raw_cv_text is "" by construction (see the manual endpoints in this
    file) and the form IS the source of truth.

    Two signals, checked in order of reliability:
      1. STRUCTURE — did Agent 1 come back with populated fact groups? A
         gutted extraction has a name and essentially nothing else, which is
         directly visible in the shape of facts_json and does not depend on
         the source document's formatting at all.
      2. COVERAGE — only consulted when the structure is too thin to rule on.
         See _MIN_EXTRACTION_COVERAGE for why this can no longer be the sole
         signal.
    """
    facts = result_state.get("facts_json") or {}
    personal = facts.get("personal") or {}
    if not (personal.get("name") or "").strip():
        return False

    source_chars = len(result_state.get("raw_cv_text") or "")
    if source_chars < _MIN_SOURCE_CHARS_FOR_COVERAGE:
        return True

    extracted_chars = _facts_content_length(facts)
    coverage = extracted_chars / source_chars
    populated = _populated_fact_groups(facts)
    has_core = any(group in populated for group in _CORE_FACT_GROUPS)

    # Both messages below quote Agent 1's own numbers back, so they MUST be
    # attributable to the same run Agent 1 logged — comparing this gate's
    # entry count against an Agent 1 summary from a different request is
    # what turned a resubmitted CV into a phantom "entry got dropped" bug.
    run = f"[req {result_state.get('request_id')}] " if result_state.get("request_id") else ""

    if has_core and len(populated) >= _MIN_POPULATED_FACT_GROUPS:
        if coverage < _MIN_EXTRACTION_COVERAGE:
            # Worth seeing, not worth refusing: either the CV is genuinely
            # narrative-heavy, or something upstream is inflating
            # raw_cv_text. Both are real things to look at, and neither
            # justifies throwing away a good extraction.
            logger.warning(
                f"📄 {run}LOW COVERAGE, USABLE EXTRACTION: facts_json carries {extracted_chars} of "
                f"{source_chars} source characters ({coverage:.0%}, floor "
                f"{_MIN_EXTRACTION_COVERAGE:.0%}), but Agent 1 populated "
                f"{len(populated)} fact groups ({', '.join(populated)}) — "
                f"{len(facts.get('experience') or [])} experience and "
                f"{len(facts.get('education') or [])} education entries. Proceeding."
            )
        return True

    if coverage < _MIN_EXTRACTION_COVERAGE:
        logger.error(
            f"❌ {run}PARTIAL EXTRACTION: the uploaded CV holds {source_chars} characters but "
            f"facts_json carries only {extracted_chars} ({coverage:.0%}, floor "
            f"{_MIN_EXTRACTION_COVERAGE:.0%}) — "
            f"{len(facts.get('experience') or [])} experience and "
            f"{len(facts.get('education') or [])} education entries, "
            f"{len(populated)} fact groups populated ({', '.join(populated) or 'none'}). "
            f"Agent 1 returned a name but lost the document; refusing to render rather "
            f"than shipping a gutted CV."
        )
        return False
    return True


def _weight_factors_usable(result_state: dict) -> bool:
    """
    Same idea as _pipeline_produced_usable_cv, but for Agent 2
    (jd_analyzer). job_title is the one field that's always meaningful
    when the JD was genuinely parsed — required_skills / ats_keywords
    being empty can legitimately happen on a very thin real JD, so
    job_title is the safer signal that Agent 2 actually ran, rather than
    silently shipping a CV that was never tailored to the job at all.
    Without this check, a failed Agent 2 could even show a *misleadingly
    high* ATS score, since ats_scorer.py's keyword-match rate defaults to
    a perfect 1.0 when there are zero keywords to check against.
    """
    weight_factors = result_state.get("weight_factors") or {}
    job_title = (weight_factors.get("job_title") or "").strip()
    return bool(job_title)


def _tailored_content_usable(result_state: dict) -> bool:
    """
    Agent 3 is the entire product. If it produced neither a summary nor a
    single tailored bullet, there is nothing to render that the user didn't
    already have.

    This check was missing, and its absence is the reported bug: the two
    gates above only look at Agent 1 and Agent 2, both of which succeed
    happily on a run whose tailoring later dies. The pipeline was therefore
    declared "ready", the credit was kept, and utils/cv_context.py quietly
    fell back to the RAW parsed CV for every field (`state.get("tailored_summary")
    or facts.get("summary")`, raw bullets, raw project descriptions). The
    user was charged and handed back a re-typeset copy of their own CV with
    a 0% ATS score and a 0% match score — and on an Arabic request, that
    fallback content is still in the source CV's language, which is why an
    Arabic run came back in English.
    """
    if (result_state.get("tailored_summary") or "").strip():
        return True
    return bool(result_state.get("tailored_bullets"))


# Used by _language_matches_request below to confirm an Arabic request
# actually produced Arabic. Only the presence of Arabic is tested — a
# Latin-script proper noun in an otherwise Arabic CV is fine and must not
# fail the check.
_ARABIC_CHAR_RE = re.compile(r"[؀-ۿ]")


def _language_matches_request(result_state: dict) -> bool:
    """
    Guards the specific failure the Arabic bug report describes: a CV
    requested in Arabic that comes back written in English.

    Deliberately coarse — it only fires when the generated summary contains
    NO Arabic at all. A partially-translated CV still ships (the Arabic
    purity pass in tailoring_engine.py is the mechanism that tightens that,
    and it is best-effort by design); this is only here to stop a wholly
    wrong-language document from being sold to someone as an Arabic CV.
    """
    if str(result_state.get("cv_language", "en")).lower() != "ar":
        return True
    summary = (result_state.get("tailored_summary") or "").strip()
    if not summary:
        return True  # already caught by _tailored_content_usable
    return bool(_ARABIC_CHAR_RE.search(summary))


# Machine-readable failure codes -> user-facing English text. The frontend
# also maps these codes to Arabic copy (see useOptimizeStream.ts /
# dashboard/page.tsx), which is why the code travels alongside the message
# instead of the message being the only thing returned.
ERROR_MESSAGES = {
    "cv_unreadable":         "We couldn't read your CV. Please try again in a moment.",
    "jd_unreadable":         "We couldn't analyze the job description. Please try again in a moment.",
    "tailoring_failed":      "We couldn't finish tailoring your CV, so nothing was charged. Please try again.",
    "fact_check_failed":     "Fact check did not fully pass, please try again.",
    "fact_check_unavailable": "Our fact checker is temporarily unavailable, so nothing was charged. Please try again in a moment.",
    "wrong_language":        "We couldn't generate your CV in Arabic this time, so nothing was charged. Please try again.",
}


def _pipeline_ready(result_state: dict) -> tuple[bool, str, str]:
    """
    True only if the pipeline actually produced something worth charging
    for. Returns (ready, error_code, user_facing_message) so callers can
    raise/emit a specific, honest message instead of a generic failure.

    ORDER MATTERS: the most specific known cause is reported first, so the
    user is told what actually happened rather than being handed a generic
    "couldn't read your CV" for a fact-check rejection.
    """
    fatal_code = result_state.get("fatal_error_code")
    if fatal_code in ERROR_MESSAGES:
        return False, fatal_code, ERROR_MESSAGES[fatal_code]

    if not _pipeline_produced_usable_cv(result_state):
        return False, "cv_unreadable", ERROR_MESSAGES["cv_unreadable"]
    if not _weight_factors_usable(result_state):
        return False, "jd_unreadable", ERROR_MESSAGES["jd_unreadable"]

    # A run that reached the end with fact_check_passed still False means
    # every bullet was rejected and the tailoring loop is exhausted (a CV
    # with no bullets at all reports True — see core/fact_checker.py). Do
    # not render, do not charge.
    if not result_state.get("fact_check_passed", False):
        return False, "fact_check_failed", ERROR_MESSAGES["fact_check_failed"]

    if not _tailored_content_usable(result_state):
        return False, "tailoring_failed", ERROR_MESSAGES["tailoring_failed"]

    if not _language_matches_request(result_state):
        return False, "wrong_language", ERROR_MESSAGES["wrong_language"]

    return True, "", ""


# ─── LIVE PROGRESS STREAMING (dashboard "Agent N" UI) ─────────────────────
#
# Maps LangGraph node names -> a stable "Agent N" number the frontend shows.
# This is deliberately NOT 1:1 with orchestrator.py's node names in either
# count or order of execution:
#   - cv_parser / manual_cv_parser collapse to the same Agent 1 (only one of
#     the two ever runs per request, depending on input_mode).
#   - tailoring_engine can loop back on itself via fact_checker (see
#     route_after_fact_check in orchestrator.py) — repeated completions of
#     the same node are ignored here so the frontend only ever sees it go
#     from running -> done once, not flicker on retries.
#   - ats_scorer / document_generator / jobs_finder run in TRUE parallel
#     (LangGraph fan-out), so they can complete in any order. Each is still
#     reported under its own fixed Agent number the moment IT finishes,
#     regardless of the order events actually arrive in.
# The label strings are intentionally generic ("Reading your CV") — no
# model names, no internal node names — that's the whole point of this
# endpoint vs. what you see in the local dev logs.
# Values are LISTS because one graph node can back more than one UI row:
# "scoring" runs the ATS scorer and the match scorer back to back inside a
# single node (see run_scoring in orchestrator.py — they were merged so the
# match scorer stops idling ~25s waiting for the cover letter's superstep).
# The frontend still shows them as two separate agents, so completing that
# node reports both.
_STEP_NODE_TO_AGENT = {
    "cv_parser": [(1, "cvParse")],
    "manual_cv_parser": [(1, "cvParse")],
    "jd_analyzer": [(2, "jdAnalyze")],
    "tailoring_engine": [(3, "tailor")],
    "fact_checker": [(4, "factCheck")],
    "document_generator": [(6, "coverLetter")],
    "scoring": [(5, "atsScore"), (7, "matchScore")],
    "jobs_finder": [(8, "similarJobs")],
}


def _sse(event: str, data: dict) -> str:
    """Formats one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ─── GENERATION SNAPSHOT (CV storage/retention) ────────────────────────────
#
# Everything render_cv_pdf / generate_cv_docx / render_cover_letter_pdf need
# to re-render this exact CV and cover letter later, without re-running the
# LLM pipeline. This is what gets saved to resumes.generation_snapshot
# (small — a few KB of JSON) instead of permanently storing the rendered
# PDF/DOCX files themselves (hundreds of KB each). See utils/cv_context.py's
# build_cv_context for the full read-side of this contract — every key it
# reads off `state` needs to be present here, or a later regenerate would
# silently drop content.
_SNAPSHOT_STATE_KEYS = [
    "facts_json", "weight_factors", "cv_language", "template_id",
    "tailored_summary", "tailored_bullets", "tailored_projects",
    "tailored_volunteer_work", "tailored_skills", "tailored_experience_titles",
    "cover_letter_text",
    # Required for a later re-render to reproduce the SAME Arabic CV — without
    # it, build_cv_context would fall back to the untranslated facts_json and
    # a regenerated Arabic CV would come back with English employer/university
    # names that the original didn't have.
    "arabic_glossary",
    # The name is resolved from the profile at render time, so a later
    # re-render needs these or it would fall back to the CV's parsed name
    # and print a different name than the original document did.
    "profile_name_en", "profile_name_ar",
    # The candidate photo, as a JPEG data URI. Same reasoning as everything
    # above: the rendered PDF isn't kept, so a later download re-renders
    # from this snapshot alone and would come back with an empty photo slot
    # without it. See _photo_for_snapshot for why it isn't always included.
    "candidate_photo",
]


def _photo_for_snapshot(result_state: dict) -> str:
    """
    The photo to persist with this resume — "" unless the chosen template
    actually renders one.

    read_uploaded_photo already refuses to extract for a non-photo
    template, so in normal operation this agrees with it. It is repeated
    here because this is the write that LASTS: the snapshot is the only
    part of a generation that outlives the request, and a face is not
    something to keep on a row that will never display it. It also keeps
    the ~30 KB out of every snapshot for the eleven templates that predate
    this feature, so their rows stay exactly the size they were.
    """
    if not template_supports_photo(result_state.get("template_id")):
        return ""
    return result_state.get("candidate_photo") or ""


def build_generation_snapshot(result_state: dict) -> dict:
    snapshot = {key: result_state.get(key) for key in _SNAPSHOT_STATE_KEYS}
    snapshot["candidate_photo"] = _photo_for_snapshot(result_state)
    return snapshot


def generate_documents_parallel(result_state: dict, paths: dict) -> dict:
    """
    Renders the CV PDF, CV DOCX, and cover letter PDF concurrently instead
    of sequentially. These three are fully independent of each other (each
    reads result_state and writes its own file), so there's no reason a
    user should wait for three renders back-to-back — this is a real chunk
    of the "optimizing..." delay that shows up after every agent has
    already finished (WeasyPrint/python-docx rendering, not LLM work).
    Re-raises on failure exactly like calling each function directly would
    (a thread pool future re-raises the worker's exception on .result()),
    so callers' existing try/except handling doesn't need to change.
    """
    template_id = result_state.get("template_id")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            "cv_pdf": executor.submit(render_cv_pdf, result_state, output_path=paths["cv_pdf"], template_id=template_id),
            "cv_docx": executor.submit(generate_cv_docx, result_state, output_path=paths["cv_docx"], template_id=template_id),
            "cover_letter_pdf": executor.submit(render_cover_letter_pdf, result_state, output_path=paths["cover_letter_pdf"]),
        }
        return {key: future.result() for key, future in futures.items()}


def flush_usage_event_async(result_state: dict, input_mode: str, pipeline_succeeded: bool, user_id: str, error_message: str = ""):
    """
    Fire-and-forget analytics write. UsageEvent.flush() is a synchronous
    Supabase insert that carries no information the response depends on —
    there's no reason the user's request should wait on it. Runs on a
    daemon thread so it can't block process shutdown; UsageEvent.flush()
    already catches its own write failures and just logs them, so this
    can never surface as a user-facing error either way.
    """
    def _run():
        try:
            UsageEvent.from_pipeline_result(
                result_state, input_mode=input_mode, pipeline_succeeded=pipeline_succeeded, error_message=error_message
            ).flush(user_id)
        except Exception as e:
            logger.error(f"❌ Background usage-event flush failed: {e}")

    threading.Thread(target=_run, daemon=True).start()


def build_success_payload(result_state: dict, request_id: str, reserved_amount: int, generated_paths: dict) -> dict:
    """Shared response shape for /optimize, /optimize-manual, and both
    /stream variants — was duplicated four times with the same 20 keys;
    now the one place that shape can drift."""
    return {
        "success": True,
        "request_id": request_id,
        "ats_score": result_state.get("ats_score", 0),
        "ats_breakdown": result_state.get("score_breakdown", {}),
        "job_match_score": result_state.get("job_match_score", 0),
        "job_match_reason": result_state.get("job_match_reason", ""),
        "gap_analysis": result_state.get("gap_analysis", []),
        "overall_recommendation": result_state.get("overall_recommendation", ""),
        "tailored_summary": result_state.get("tailored_summary", ""),
        "tailored_bullets": result_state.get("tailored_bullets", []),
        "cover_letter_text": result_state.get("cover_letter_text", ""),
        "similar_jobs": result_state.get("similar_jobs", []),
        "fact_check_passed": result_state.get("fact_check_passed", False),
        "job_title": result_state.get("weight_factors", {}).get("job_title", ""),
        "company": result_state.get("weight_factors", {}).get("company", ""),
        "cv_language": result_state.get("cv_language", "en"),
        "generated_cv_pdf": generated_paths["cv_pdf"],
        "generated_cv_docx": generated_paths["cv_docx"],
        "generated_cl_pdf": generated_paths["cover_letter_pdf"],
        "error": result_state.get("error", None),
        "credits_charged": reserved_amount,
        # Small structured payload the frontend persists verbatim as
        # resumes.generation_snapshot — see build_generation_snapshot()
        # and PART 1 of the storage/retention rework for why this replaces
        # permanently storing the rendered files.
        "generation_snapshot": build_generation_snapshot(result_state),
    }


def _stream_pipeline(initial_state: AgentState, user_id: str, reserved_amount: int, request_id: str):
    """
    Shared generator for both streaming endpoints below. Runs the exact same
    LangGraph as the blocking /optimize routes, just via .stream() instead
    of .invoke() so we can emit a `step` event after each node completes.
    Ends with one `complete` event carrying the identical payload shape
    /optimize already returns (or an `error` event on failure), so the
    frontend can reuse its existing result-rendering code either way.

    request_id: generated by the calling endpoint, used to build this
    request's unique output file paths — see output_paths().
    """
    seen_agents = set()
    result_state = dict(initial_state)
    paths = output_paths(user_id, request_id)

    try:
        for update in graph.stream(initial_state, stream_mode="updates"):
            for node_name, partial in update.items():
                if partial:
                    result_state.update(partial)

                # One node can report more than one agent row — see
                # _STEP_NODE_TO_AGENT.
                for agent_num, step_key in _STEP_NODE_TO_AGENT.get(node_name, ()):
                    if agent_num in seen_agents:
                        continue
                    seen_agents.add(agent_num)
                    yield _sse("step", {"agent": agent_num, "step": step_key})

        logger.info("✅ Multi-agent execution phase completed (stream).")

        # Don't render/return a fake success if Agent 1 never actually
        # extracted usable data (e.g. Gemini rate-limited out after all
        # retries) — see _pipeline_produced_usable_cv for why this check
        # is the reliable signal rather than just checking state["error"].
        ready, error_code, error_detail = _pipeline_ready(result_state)
        if not ready:
            logger.error(f"❌ Pipeline did not produce usable output (stream) [{error_code}]: {error_detail} | state error: {result_state.get('error')}")
            refund_credits(user_id, reserved_amount)
            flush_usage_event_async(result_state, input_mode=result_state.get("input_mode", "upload"), pipeline_succeeded=False, user_id=user_id, error_message=error_detail)
            # `code` lets the frontend show localized copy; `detail` is the
            # ready-to-display English fallback.
            yield _sse("error", {"detail": error_detail, "code": error_code})
            return

        generated_paths = generate_documents_parallel(result_state, paths)

        flush_usage_event_async(result_state, input_mode=result_state.get("input_mode", "upload"), pipeline_succeeded=True, user_id=user_id)

        payload = build_success_payload(result_state, request_id, reserved_amount, generated_paths)
        yield _sse("complete", payload)

    except Exception as err:
        logger.error(f"❌ Pipeline Failure (stream): {err}")
        refund_credits(user_id, reserved_amount)
        flush_usage_event_async(result_state, input_mode=result_state.get("input_mode", "upload"), pipeline_succeeded=False, user_id=user_id, error_message=str(err))
        yield _sse("error", {"detail": f"An execution failure hit a core agent module: {str(err)}"})


@app.get("/health", status_code=status.HTTP_200_OK, tags=["System Health"])
async def health_check():
    return {"status": "healthy", "environment": os.getenv("ENVIRONMENT", "development")}

@app.get("/api/v1/download/cv", tags=["Downloads"])
async def download_cv(
    request_id: str = Query(...),
    user_id: str = Depends(get_current_user_id_query_or_header),
):
    """Serves the tailored CV from THIS request_id, for THIS authenticated
    user only — see output_paths()'s docstring for why the path is built
    from the caller's own verified user_id rather than trusted as given."""
    path = output_paths(user_id, request_id)["cv_pdf"]
    if not os.path.exists(path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated CV found for this request.",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        filename="tailored_cv.pdf",
        headers={"Content-Disposition": "attachment; filename=tailored_cv.pdf"},
    )


@app.get("/api/v1/download/cv-docx", tags=["Downloads"])
async def download_cv_docx(
    request_id: str = Query(...),
    user_id: str = Depends(get_current_user_id_query_or_header),
):
    """
    Serves the tailored CV as a downloadable Word file. Same ?token= auth
    pattern as download_cv above — see BUG #14 FIX note in page.tsx for why
    this is a plain <a href download> target rather than a JS fetch+blob
    download.
    """
    path = output_paths(user_id, request_id)["cv_docx"]
    if not os.path.exists(path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated CV found for this request.",
        )
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="tailored_cv.docx",
        headers={"Content-Disposition": "attachment; filename=tailored_cv.docx"},
    )


@app.get("/api/v1/download/cover-letter", tags=["Downloads"])
async def download_cover_letter(
    request_id: str = Query(...),
    user_id: str = Depends(get_current_user_id_query_or_header),
):
    """Serves the cover letter from THIS request_id, for THIS authenticated user."""
    path = output_paths(user_id, request_id)["cover_letter_pdf"]
    if not os.path.exists(path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated cover letter found for this request.",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        filename="cover_letter.pdf",
        headers={"Content-Disposition": "attachment; filename=cover_letter.pdf"},
    )


@app.get("/api/v1/preview/cv", tags=["Downloads"])
async def preview_cv(
    request_id: str = Query(...),
    user_id: str = Depends(get_current_user_id_query_or_header),
):
    """
    Serves the tailored CV inline so the browser opens/renders it instead of
    downloading it. Uses the query-or-header auth dependency (not the plain
    get_current_user_id) because this route is opened via a link/fetch with
    a ?token= query param and no Authorization header — same reasoning as
    the /api/v1/download/* routes above. Previously used get_current_user_id,
    which only reads the Authorization header, so every preview request was
    silently failing auth (401) since the token only ever arrived as a query
    param — this is why the preview "eye" buttons appeared broken.
    """
    path = output_paths(user_id, request_id)["cv_pdf"]
    if not os.path.exists(path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated CV found for this request.",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=tailored_cv.pdf"},
    )


@app.get("/api/v1/preview/cover-letter", tags=["Downloads"])
async def preview_cover_letter(
    request_id: str = Query(...),
    user_id: str = Depends(get_current_user_id_query_or_header),
):
    """Serves the cover letter inline. See preview_cv above for why this uses
    get_current_user_id_query_or_header instead of get_current_user_id."""
    path = output_paths(user_id, request_id)["cover_letter_pdf"]
    if not os.path.exists(path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated cover letter found for this request.",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=cover_letter.pdf"},
    )


@app.get("/api/v1/credits", tags=["Credits"])
async def get_credits_balance(user_id: str = Depends(get_current_user_id)):
    """Current tier + credit balance for the logged-in user. Read-only —
    all writes happen server-side inside reserve_credits()/refund_credits()."""
    return get_credits(user_id)

@app.get("/")
async def root():
    return {"message": "Job Application Agent API is running", "docs": "/docs"}

@app.post("/api/v1/subscription/cancel", tags=["Credits"])
async def cancel_subscription_endpoint(user_id: str = Depends(get_current_user_id)):
    """
    Schedules a downgrade to Free at the end of the current cycle. Does NOT
    touch tier or credits immediately — see core/subscription.py.
    """
    return cancel_subscription(user_id)


@app.post("/api/v1/subscription/resume", tags=["Credits"])
async def resume_subscription_endpoint(user_id: str = Depends(get_current_user_id)):
    """Undoes a scheduled cancellation/downgrade."""
    return resume_subscription(user_id)


@app.post("/api/v1/optimize", tags=["Agent Core"])
async def optimize_application(
    cv: UploadFile = File(...),
    job_description: str = Form(...),
    additional_info: str = Form(""),
    cv_language: str = Form("en"),
    template_id: str = Form(DEFAULT_TEMPLATE_ID),
    # Explicit "generate anyway" escape hatch — see apply_candidate_names.
    allow_name_fallback: bool = Form(False),
    user_id: str = Depends(get_current_user_id),
):
    enforce(GENERATION, user_id)
    logger.info("🚀 API Gateway received an application optimization request.")

    cv_bytes = await read_upload_capped(cv)
    final_cv_text = read_uploaded_cv(cv_bytes)
    final_jd_text = job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state(final_cv_text, final_jd_text, template_id=template_id)
    initial_state["input_mode"] = "upload"
    initial_state["user_id"] = user_id
    initial_state["additional_info"] = additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(cv_language)
    # Local image extraction from the bytes already in memory — no second
    # read of the upload, and no vision call. See read_uploaded_photo.
    initial_state["candidate_photo"] = read_uploaded_photo(cv_bytes, template_id)

    # Reserve credits BEFORE running the (expensive) pipeline. Atomic against
    # concurrent requests — see reserve_credits() in core/credits.py.
    # Raises 402 automatically if the user doesn't have enough.
    # Name check BEFORE credits — being asked for your name costs nothing.
    apply_candidate_names(initial_state, user_id, allow_name_fallback)

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])
    request_id = assign_request_id(initial_state)
    paths = output_paths(user_id, request_id)
    result = {}  # bound before the try so the outer except can still build a UsageEvent from it

    try:
        # Pipeline execution: graph.invoke is the standard LangGraph method
        logger.info("🧠 Commencing agent graph routing lifecycle...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")

        # Don't return a fake "success" if Agent 1 never actually extracted
        # usable data — see _pipeline_produced_usable_cv for why this is the
        # reliable check rather than just looking at state["error"].
        ready, error_code, error_detail = _pipeline_ready(result)
        if not ready:
            logger.error(f"❌ Pipeline did not produce usable output [{error_code}]: {error_detail} | state error: {result.get('error')}")
            refund_credits(user_id, reserved_amount)
            flush_usage_event_async(result, input_mode="upload", pipeline_succeeded=False, user_id=user_id, error_message=error_detail)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": error_code, "message": error_detail},
            )

        generated_paths = generate_documents_parallel(result, paths)

        flush_usage_event_async(result, input_mode="upload", pipeline_succeeded=True, user_id=user_id)

        return build_success_payload(result, request_id, reserved_amount, generated_paths)

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"❌ Pipeline Failure: {err}")
        refund_credits(user_id, reserved_amount)
        flush_usage_event_async(result, input_mode="upload", pipeline_succeeded=False, user_id=user_id, error_message=str(err))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An execution failure hit a core agent module: {str(err)}"
        )


@app.post("/api/v1/optimize/stream", tags=["Agent Core"])
async def optimize_application_stream(
    cv: UploadFile = File(...),
    job_description: str = Form(...),
    additional_info: str = Form(""),
    cv_language: str = Form("en"),
    template_id: str = Form(DEFAULT_TEMPLATE_ID),
    # Explicit "generate anyway" escape hatch — see apply_candidate_names.
    allow_name_fallback: bool = Form(False),
    user_id: str = Depends(get_current_user_id),
):
    """
    Same pipeline as /api/v1/optimize, but streams progress over
    Server-Sent Events instead of blocking until everything is done.
    Powers the dashboard's live "Agent N" progress UI. Emits a `step` event
    each time a pipeline stage completes, then one final `complete` event
    with the exact same payload /optimize returns (or an `error` event).

    Credits are reserved up front exactly like /optimize; refunds on
    failure happen inside _stream_pipeline.
    """
    enforce(GENERATION, user_id)
    logger.info("🚀 API Gateway received a STREAMING application optimization request.")

    cv_bytes = await read_upload_capped(cv)
    final_cv_text = read_uploaded_cv(cv_bytes)
    final_jd_text = job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state(final_cv_text, final_jd_text, template_id=template_id)
    initial_state["input_mode"] = "upload"
    initial_state["user_id"] = user_id
    initial_state["additional_info"] = additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(cv_language)
    # Local image extraction from the bytes already in memory — no second
    # read of the upload, and no vision call. See read_uploaded_photo.
    initial_state["candidate_photo"] = read_uploaded_photo(cv_bytes, template_id)

    # Name check BEFORE credits — being asked for your name costs nothing.
    apply_candidate_names(initial_state, user_id, allow_name_fallback)

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])
    request_id = assign_request_id(initial_state)

    return StreamingResponse(
        _stream_pipeline(initial_state, user_id, reserved_amount, request_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Disable proxy/CDN buffering (nginx in particular) so events
            # flush to the client as they're generated instead of arriving
            # all at once at the end, which would defeat the whole feature.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/v1/optimize-manual/stream", tags=["Agent Core"])
async def optimize_manual_application_stream(
    payload: ManualCVRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Streaming variant of /api/v1/optimize-manual — see optimize_application_stream."""
    enforce(GENERATION, user_id)
    logger.info("🚀 API Gateway received a STREAMING manual optimization request.")

    manual_data = payload.model_dump(exclude={"job_description", "additional_info", "cv_language", "template_id", "allow_name_fallback"})
    final_jd_text = payload.job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state("", final_jd_text, template_id=getattr(payload, "template_id", None))
    initial_state["input_mode"] = "manual"
    initial_state["user_id"] = user_id
    initial_state["manual_cv_data"] = manual_data
    initial_state["additional_info"] = payload.additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(payload.cv_language or "en")

    # Name check BEFORE credits — being asked for your name costs nothing.
    apply_candidate_names(initial_state, user_id, bool(payload.allow_name_fallback))

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])
    request_id = assign_request_id(initial_state)

    return StreamingResponse(
        _stream_pipeline(initial_state, user_id, reserved_amount, request_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/v1/optimize-manual", tags=["Agent Core"])
async def optimize_manual_application(
    payload: ManualCVRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Same pipeline as /api/v1/optimize, but for the 'Create New CV' flow —
    structured form data instead of an uploaded PDF. Both routes converge
    on the same LangGraph, just entering through a different parser node
    (see core/orchestrator.py's route_cv_input).
    """
    enforce(GENERATION, user_id)
    logger.info("🚀 API Gateway received a MANUAL CV optimization request.")

    manual_data = payload.model_dump(exclude={"job_description", "additional_info", "cv_language", "template_id", "allow_name_fallback"})
    final_jd_text = payload.job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state("", final_jd_text, template_id=getattr(payload, "template_id", None))
    initial_state["input_mode"] = "manual"
    initial_state["user_id"] = user_id
    initial_state["manual_cv_data"] = manual_data
    initial_state["additional_info"] = payload.additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(payload.cv_language or "en")

    # Name check BEFORE credits — being asked for your name costs nothing.
    apply_candidate_names(initial_state, user_id, bool(payload.allow_name_fallback))

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])
    request_id = assign_request_id(initial_state)
    paths = output_paths(user_id, request_id)
    result = {}  # bound before the try so the outer except can still build a UsageEvent from it

    try:
        logger.info("🧠 Commencing agent graph routing lifecycle (manual entry)...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")

        ready, error_code, error_detail = _pipeline_ready(result)
        if not ready:
            logger.error(f"❌ Pipeline did not produce usable output (manual) [{error_code}]: {error_detail} | state error: {result.get('error')}")
            refund_credits(user_id, reserved_amount)
            flush_usage_event_async(result, input_mode="manual", pipeline_succeeded=False, user_id=user_id, error_message=error_detail)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": error_code, "message": error_detail},
            )

        generated_paths = generate_documents_parallel(result, paths)

        flush_usage_event_async(result, input_mode="manual", pipeline_succeeded=True, user_id=user_id)

        return build_success_payload(result, request_id, reserved_amount, generated_paths)

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"❌ Pipeline Failure (manual): {err}")
        refund_credits(user_id, reserved_amount)
        flush_usage_event_async(result, input_mode="manual", pipeline_succeeded=False, user_id=user_id, error_message=str(err))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An execution failure hit a core agent module: {str(err)}"
        )


if __name__ == "__main__":
    logger.info("🔥 Starting local development API server via Uvicorn...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
