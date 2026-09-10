# core/documents.py
#
# PART 1 of the storage/retention rework: rendered CV/DOCX/cover-letter
# files are no longer stored permanently anywhere (not on this backend's
# local disk long-term, not in Supabase Storage). What IS stored
# permanently is the small "generation_snapshot" JSON on each resumes row
# (see main.py's build_generation_snapshot) — everything the renderers need
# to reproduce the exact same output on demand. This router is that demand
# side: given a resume_id the caller is allowed to see, re-render the
# requested document fresh, stream it back, and clean up the temp file.
#
# Two entry points share the same rendering logic:
#   - /api/v1/resumes/{id}/document/{type}        — the resume's OWNER only
#   - /api/v1/admin/resumes/...                    — is_admin only, any resume
# The admin path is the debugging tool: since a tester's rendered file is
# never sitting in storage anymore, this is how the founder can still pull
# up exactly what a specific user's CV/cover letter looked like when they
# report a bug.
import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from loguru import logger

from core.auth import (
    get_current_user_id,
    get_current_user_id_query_or_header,
    get_current_admin_user_id_query_or_header,
    get_current_admin_user_id,
)
from core.credits import get_admin_client, maybe_row
from utils.pdf_generator import render_cv_pdf, render_cover_letter_pdf
from utils.docx_generator import generate_cv_docx

router = APIRouter()

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

_DOC_TYPES = {
    "cv-pdf": {
        "render": lambda state, path: render_cv_pdf(state, output_path=path, template_id=state.get("template_id")),
        "media_type": "application/pdf",
        "filename": "tailored_cv.pdf",
    },
    "cv-docx": {
        "render": lambda state, path: generate_cv_docx(state, output_path=path, template_id=state.get("template_id")),
        "media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "filename": "tailored_cv.docx",
    },
    "cover-letter-pdf": {
        "render": lambda state, path: render_cover_letter_pdf(state, output_path=path),
        "media_type": "application/pdf",
        "filename": "cover_letter.pdf",
    },
}


_UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def _require_uuid(value: str) -> str:
    """A resume id that is shaped like one, or a 404.

    404 rather than 400 on purpose: a malformed id and someone else's id must
    be indistinguishable from the outside.
    """
    if not _UUID_RE.match(str(value or "")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV not found.")
    return value


def _fetch_resume(resume_id: str) -> dict:
    admin = get_admin_client()
    row = (
        maybe_row(admin.table("resumes")
        .select("id, user_id, generation_snapshot, role, company, created_at, is_archived")
        .eq("id", resume_id)
        .maybe_single()
        .execute())
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")
    return row


def _regenerate_response(resume_row: dict, doc_type: str, download: bool = False) -> FileResponse:
    spec = _DOC_TYPES.get(doc_type)
    if not spec:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown document type '{doc_type}'.")

    snapshot = resume_row.get("generation_snapshot")
    if not snapshot:
        # Legacy rows saved before this feature shipped never got a
        # snapshot written — there's nothing to regenerate from. This is a
        # data-migration gap, not a bug in a specific request.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This resume has no saved structured data to regenerate from (it predates this feature).",
        )

    # Unique temp filename per request — same collision-avoidance reasoning
    # as main.py's output_paths(), just keyed by a fresh uuid instead of
    # user_id+request_id since there's no in-flight generation request here.
    tmp_path = os.path.join(OUTPUT_DIR, f"regen_{uuid.uuid4().hex}_{doc_type}")

    try:
        spec["render"](snapshot, tmp_path)
    except Exception as e:
        logger.error(f"❌ Failed to regenerate {doc_type} for resume {resume_row.get('id')}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to regenerate document.")

    # Delete the temp file once the response has finished sending — nothing
    # else ever reads it again, and leaving it around would just recreate
    # the disk-growth problem this whole rework exists to fix.
    cleanup = BackgroundTask(lambda: os.path.exists(tmp_path) and os.remove(tmp_path))
    disposition = "attachment" if download else "inline"

    return FileResponse(
        tmp_path,
        media_type=spec["media_type"],
        filename=spec["filename"],
        headers={"Content-Disposition": f"{disposition}; filename={spec['filename']}"},
        background=cleanup,
    )


@router.get("/api/v1/resumes/{resume_id}/document/{doc_type}", tags=["Resumes"])
def get_own_resume_document(
    resume_id: str,
    doc_type: str,
    download: bool = Query(False),
    user_id: str = Depends(get_current_user_id_query_or_header),
):
    """Regenerates and serves one of the caller's OWN saved resumes' documents
    (cv-pdf, cv-docx, cover-letter-pdf) on demand. Accepts the JWT via header
    or ?token= — see get_current_user_id_query_or_header's docstring — so it
    works as a plain <a href> preview/download link from My Resumes."""
    resume = _fetch_resume(resume_id)
    if resume["user_id"] != user_id:
        # 404, not 403 — don't confirm to a caller that a resume_id exists
        # at all if it isn't theirs.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")
    return _regenerate_response(resume, doc_type, download=download)


_UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def _lookup_users(admin, term: str) -> list[dict] | None:
    """Resolves a free-text search term to matching users via the
    admin_search_users SQL function (see 003_admin_access.sql). Emails live
    in auth.users, which PostgREST can't expose directly, so the join
    happens in a SECURITY DEFINER function granted to service_role only."""
    # None for "the search could not run", [] for "it ran and matched nobody".
    # Returning [] for both told support that an account does not exist when
    # the truth was that the lookup was broken — and admin_search_users is a
    # SQL function, so it is vulnerable to exactly the unapplied-migration
    # failure that took out admin_paid_by_users for a week.
    try:
        return admin.rpc("admin_search_users", {"term": term}).execute().data or []
    except Exception as e:
        logger.error(
            f"admin_search_users failed for '{term}': {e}. Reporting UNAVAILABLE "
            "rather than 'no matches' — a broken lookup must not read as a "
            "missing account."
        )
        return None


def _attach_user_info(admin, resumes: list[dict]) -> list[dict]:
    """Adds email / name_en / name_ar to each resume row so the viewer can
    show who a resume belongs to instead of a bare uuid."""
    user_ids = list({r["user_id"] for r in resumes if r.get("user_id")})
    if not user_ids:
        return resumes
    try:
        rows = admin.rpc("admin_users_by_ids", {"ids": user_ids}).execute().data or []
    except Exception as e:
        # Non-fatal: the listing is still perfectly usable without names.
        logger.warning(f"admin_users_by_ids failed: {e}")
        return resumes

    by_id = {r["id"]: r for r in rows}
    for resume in resumes:
        info = by_id.get(resume.get("user_id")) or {}
        resume["email"] = info.get("email")
        resume["name_en"] = info.get("name_en")
        resume["name_ar"] = info.get("name_ar")
    return resumes


@router.get("/api/v1/admin/resumes", tags=["Admin"])
def list_all_resumes(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    q: str | None = Query(
        None,
        description="Search by email, name (English or Arabic), or auth user id. Blank returns everyone.",
    ),
    user_id: str | None = Query(None, description="Legacy exact-user-id filter. Prefer `q`."),
    admin_user_id: str = Depends(get_current_admin_user_id),
):
    """Admin-only listing across ALL users' resumes, including archived ones
    (an admin debugging a report shouldn't be blinded by a user's own
    retention cap).

    `q` accepts whatever you actually have to hand when someone reports a
    problem — most often their email, sometimes their name in either script,
    occasionally a raw user id. It used to be user-id-only, which meant
    round-tripping through the Supabase dashboard to translate an email into
    a uuid before you could look anything up."""
    admin = get_admin_client()

    matched_users: list[dict] = []
    target_user_ids: list[str] | None = None

    term = (q or "").strip()
    if term:
        if _UUID_RE.match(term):
            # A raw id needs no lookup, though we still resolve it so the
            # response can show whose account it is. A failed resolve here is
            # cosmetic — the id itself still filters correctly.
            target_user_ids = [term]
            matched_users = _lookup_users(admin, term) or []
        else:
            matched_users = _lookup_users(admin, term)
            if matched_users is None:
                # THE SEARCH BROKE. Refusing is the only honest answer: an
                # empty list here is rendered as "no such account", and
                # support acts on that by telling a customer they have no
                # record with us. 503 so the page says the search is
                # unavailable instead.
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "code": "search_unavailable",
                        "message": (
                            "User search is unavailable — the lookup failed rather than "
                            "returning no matches. This is not a statement about whether "
                            "the account exists."
                        ),
                    },
                )
            target_user_ids = [u["id"] for u in matched_users]
            if not target_user_ids:
                # Genuinely nobody matched — return empty rather than every
                # user's resumes, which is what an unfiltered query would do.
                return {
                    "resumes": [], "limit": limit, "offset": offset,
                    "matched_users": [], "total_matched_users": 0,
                }
    elif user_id:
        target_user_ids = [user_id]

    query = (
        admin.table("resumes")
        .select("id, user_id, role, company, cv_language, ats_score, job_match_score, is_archived, created_at")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if target_user_ids:
        # in_() rather than eq() so an email matching several accounts (or a
        # name shared by two testers) returns all of their resumes.
        query = query.in_("user_id", target_user_ids)

    resumes = _attach_user_info(admin, query.execute().data or [])
    return {
        "resumes": resumes,
        "limit": limit,
        "offset": offset,
        "matched_users": matched_users,
        "total_matched_users": len(matched_users),
    }


@router.get("/api/v1/admin/resumes/{resume_id}/document/{doc_type}", tags=["Admin"])
def get_any_resume_document(
    resume_id: str,
    doc_type: str,
    download: bool = Query(False),
    admin_user_id: str = Depends(get_current_admin_user_id_query_or_header),
):
    """Admin-only: regenerates and serves ANY user's saved resume document,
    no ownership check. This is the actual debugging capability — see this
    file's module docstring."""
    resume = _fetch_resume(resume_id)
    return _regenerate_response(resume, doc_type, download=download)


# ─── FIND MATCHING JOBS, ON DEMAND ──────────────────────────────────────────
#
# WHY THIS IS AN ENDPOINT AND NOT A GRAPH NODE.
#
# `jobs_finder` used to be an unconditional sibling in the LangGraph fan-out,
# so EVERY CV generation spent 8 Tavily credits looking for matching jobs
# whether or not the person ever scrolled to that panel. Measured: 0.24 SAR of
# Tavily against 0.0133 SAR of model on the same English CV. Tavily was 95% of
# the cost of generating a CV, and most of it was spent on a feature nobody
# had asked for at that moment.
#
# The results are identical — same pipeline, same screening, same
# `similar_jobs` column. The only change is that somebody presses a button
# first. If half the users never press it, that is half the Tavily bill, and
# nobody who wants the jobs is any worse off.
#
# METERED, like LinkedIn Essential and Interview Prep. It is the most
# expensive thing the product does and it was the only paid feature with no
# cap at all — see ADDON_CAPS in core/entitlements.py.
@router.post("/api/v1/resumes/{resume_id}/find-jobs", tags=["Resumes"])
def find_jobs_for_resume(
    resume_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Searches for jobs matching a saved CV, and stores the result on the row.

    Ownership-checked against the caller. Idempotent in the way that matters:
    a CV that already has results returns them without spending anything, so a
    double-click or a refresh cannot cost a second search — pass
    `?refresh=true` to deliberately re-run one.
    """
    from agents.jobs_finder import (
        SearchQuotaExhausted,
        _fetch_profile_location,
        _looks_like_real_location,
        find_similar_jobs,
    )
    from core.entitlements import JOB_SEARCH, consume_addon_quota, release_addon_quota, require_addon_quota
    from core.rate_limit import JOB_SEARCH as JOB_SEARCH_RATE, enforce

    enforce(JOB_SEARCH_RATE, user_id)

    row = maybe_row(
        get_admin_client()
        .table("resumes")
        .select("id, user_id, generation_snapshot, similar_jobs")
        .eq("id", _require_uuid(resume_id))
        .maybe_single()
        .execute()
    )
    if not row or row.get("user_id") != user_id:
        # 404 rather than 403 for someone else's id — a 403 would confirm the
        # row exists. Same convention as core/linkedin.py and core/interview.py.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV not found.")

    existing = row.get("similar_jobs") or []
    if existing:
        # ALREADY PAID FOR. Returning the stored results costs nothing and is
        # what makes the button safe to press twice.
        return {"resume_id": resume_id, "jobs": existing, "from_cache": True}

    snapshot = row.get("generation_snapshot") or {}
    facts_json = snapshot.get("facts_json") or {}
    weight_factors = snapshot.get("weight_factors") or {}
    if not weight_factors.get("job_title"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "cv_not_supported",
                "message": (
                    "This CV was saved before we started storing the data a job "
                    "search needs. Generate a newer CV and search from that one."
                ),
            },
        )

    # Refused BEFORE the search, so an over-cap request costs nothing.
    require_addon_quota(user_id, JOB_SEARCH)
    if not consume_addon_quota(user_id, JOB_SEARCH):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "quota_exhausted",
                    "message": "You have used this month's job searches."},
        )

    cv_location = ((facts_json.get("personal", {}) or {}).get("location") or "").strip()
    profile_location = _fetch_profile_location(user_id)

    try:
        jobs = find_similar_jobs(
            weight_factors,
            facts_json,
            fallback_location=None if _looks_like_real_location(cv_location) else profile_location,
            profile_location=profile_location,
        )
    except SearchQuotaExhausted as e:
        # The slot goes back: they asked for a search and got nothing, and the
        # reason was ours. Same rule the interview-prep worker applies.
        release_addon_quota(user_id, JOB_SEARCH)
        logger.error(f"🚫 Job match unavailable (search quota) for resume {resume_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "search_quota_exhausted",
                "message": (
                    "Job matching is unavailable for the rest of this month while we "
                    "top up our search provider. Nothing was charged."
                ),
            },
        )
    except Exception as e:
        release_addon_quota(user_id, JOB_SEARCH)
        logger.opt(exception=True).error(f"❌ Job match failed for resume {resume_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "search_failed",
                    "message": "Job matching is temporarily unavailable. Nothing was charged."},
        )

    # Stored so the next visit is free — this is the same column the graph
    # node used to write, so My Resumes and everything else reads it unchanged.
    try:
        get_admin_client().table("resumes").update(
            {"similar_jobs": jobs}).eq("id", resume_id).execute()
    except Exception as e:
        # The user has their results; failing the request now would be worse
        # than losing the cache.
        logger.error(f"Could not store job matches for resume {resume_id}: {e}")

    return {"resume_id": resume_id, "jobs": jobs, "from_cache": False}
