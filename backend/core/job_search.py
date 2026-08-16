# core/job_search.py
#
# The standalone Job Search page (Pro and Elite).
#
# Nothing here touches the CV pipeline. It takes a job title, optionally a
# location and an internships flag, and returns listings — no CV, no job
# description, no credits, no LangGraph. The actual searching is
# agents/jobs_finder.py's search_jobs_by_title, which runs the same four
# search lanes, legitimacy filter, model screen and liveness check the
# similar-jobs feature uses; see that function's header for why this reuses
# that pipeline rather than adding a simpler second one.
#
# GATING FOLLOWS core/interview.py EXACTLY, because the shape of the problem
# is the same — a Pro-only page a Free user must still be able to open:
#
#   /overview  is NOT tier-gated. A Free user has to load the page to see
#              the locked preview and the upgrade prompt. It returns their
#              tier and nothing that costs anything to produce.
#   /search    IS tier-gated, via get_current_paid_user_id. That is the
#              endpoint that spends Tavily and Gemini calls, and it is the
#              check that actually decides — the frontend's blur is
#              presentation only.
#
# NOT METERED. LinkedIn Essential and Interview Prep have monthly caps
# because each generation is a large model call; a title search is a handful
# of searches and one screen. Adding a cap later needs a counter column and
# an entry in core/entitlements.py's ADDON_CAPS — the machinery is already
# there — but shipping one now would mean a migration this repo has no
# migrations directory for, and consume_addon_quota fails OPEN without it,
# which would be a cap that isn't a cap.
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from pydantic import BaseModel, Field

from core.auth import (
    PAID_TIERS,
    get_current_paid_user_id,
    get_current_user_id,
    read_subscription_tier,
)
from agents.jobs_finder import search_jobs_by_title, _fetch_profile_location

router = APIRouter()

# Long enough for "Senior Business Intelligence Developer", short enough that
# nobody pastes a job description into it — which would send a wall of text
# to Tavily as a search query.
_MAX_TITLE_CHARS = 80
_MAX_LOCATION_CHARS = 60


class JobSearchRequest(BaseModel):
    job_title: str = Field(..., description="The role to search for. A title, not a description.")
    internships: bool = Field(False, description="Search internships/trainee programmes instead of jobs.")
    # Optional override. Left empty, the user's saved profile location is
    # used, which is where signup and Settings already store it.
    location: str | None = Field(None, description="Optional location override.")


@router.get("/api/v1/job-search/overview", tags=["Job Search"])
def job_search_overview(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    What the page needs before it renders: whether this account is unlocked,
    and the location the search will default to.

    Deliberately NOT tier-gated — see this module's header.
    """
    tier = read_subscription_tier(user_id)
    return {
        "tier": tier,
        "unlocked": tier in PAID_TIERS,
        "default_location": _fetch_profile_location(user_id) or "",
    }


@router.post("/api/v1/job-search", tags=["Job Search"])
def job_search(
    payload: JobSearchRequest,
    user_id: str = Depends(get_current_paid_user_id),
) -> dict:
    """
    Searches for live listings matching a job title, then adjacent roles.

    Returns exact matches and related matches as SEPARATE lists so the page
    can label the second group honestly rather than implying every result
    matched what was typed.
    """
    title = (payload.job_title or "").strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "missing_title", "message": "Enter a job title to search for."},
        )
    if len(title) > _MAX_TITLE_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "title_too_long",
                "message": "That looks like a job description. Enter just the job title.",
            },
        )

    location = (payload.location or "").strip()[:_MAX_LOCATION_CHARS]
    if not location:
        location = _fetch_profile_location(user_id) or ""

    logger.info(
        f"🧭 Job search by {user_id}: '{title}' "
        f"({'internships' if payload.internships else 'jobs'}, location: {location or 'any'})"
    )

    try:
        results = search_jobs_by_title(
            title, location=location, internships=bool(payload.internships)
        )
    except Exception as e:
        logger.error(f"❌ Job search failed for '{title}': {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "search_failed",
                "message": "Job search is temporarily unavailable. Please try again shortly.",
            },
        )

    return {
        "job_title": title,
        "internships": bool(payload.internships),
        "location": location,
        "exact": results["exact"],
        "related": results["related"],
        "related_titles": results["related_titles"],
    }
