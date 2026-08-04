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
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from loguru import logger

from core.auth import (
    get_current_user_id_query_or_header,
    get_current_admin_user_id_query_or_header,
    get_current_admin_user_id,
)
from core.credits import get_admin_client
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


def _fetch_resume(resume_id: str) -> dict:
    admin = get_admin_client()
    row = (
        admin.table("resumes")
        .select("id, user_id, generation_snapshot, role, company, created_at, is_archived")
        .eq("id", resume_id)
        .maybe_single()
        .execute()
        .data
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


@router.get("/api/v1/admin/resumes", tags=["Admin"])
def list_all_resumes(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: str | None = Query(None, description="Filter to one user's resumes by their auth user id."),
    admin_user_id: str = Depends(get_current_admin_user_id),
):
    """Admin-only listing across ALL users' resumes (including archived
    ones — an admin debugging a report shouldn't be blinded by a user's own
    retention cap), for the bug-report debugging workflow: look up a
    tester's resumes by their user id, then open the CV/cover letter they
    actually saw. No email/name join here — profiles doesn't duplicate
    auth.users.email, so correlate via the Supabase dashboard's Auth users
    list if you only have an email from a bug report."""
    admin = get_admin_client()
    query = (
        admin.table("resumes")
        .select("id, user_id, role, company, cv_language, ats_score, job_match_score, is_archived, created_at")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if user_id:
        query = query.eq("user_id", user_id)
    result = query.execute()
    return {"resumes": result.data or [], "limit": limit, "offset": offset}


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
