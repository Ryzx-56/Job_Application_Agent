# core/location.py
#
# Updates profiles.location. Same trust model as core/subscription.py and
# core/credits.py: the frontend can never write to `profiles` directly (no
# RLS policy grants it — see 001_profiles_credits.sql), so this is the only
# path a location change can take. Uses the service_role client via
# get_admin_client(), same as the other two.
#
# NOT WIRED IN YET: this file defines the route as its own APIRouter so it
# can be dropped in with one line added to main.py:
#     from core.location import router as location_router
#     app.include_router(location_router)
# Adjust the import path / router-mounting style to match however main.py
# already wires up subscription.py's routes if it does something different
# — I don't have main.py, so this follows the most common FastAPI pattern
# rather than your actual one.
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from loguru import logger

from core.auth import get_current_user_id
from core.credits import get_admin_client

router = APIRouter()

# Loose cap, not a strict validation of "is this a real Saudi city" — the
# frontend already constrains input to the SAUDI_CITIES dropdown or a
# short free-text "Other" field (see lib/saudi-cities.ts), this is just a
# backend-side sanity limit against a malformed/abusive request.
MAX_LOCATION_LENGTH = 100


class LocationUpdateRequest(BaseModel):
    location: str = Field(..., min_length=1, max_length=MAX_LOCATION_LENGTH)


@router.patch("/api/v1/profile/location")
def update_location(payload: LocationUpdateRequest, user_id: str = Depends(get_current_user_id)) -> dict:
    admin = get_admin_client()

    location = payload.location.strip()
    if not location:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Location cannot be empty.")

    result = (
        admin.table("profiles")
        .update({"location": location})
        .eq("id", user_id)
        .select()
        .execute()
    )
    # BUG FIX: .maybe_single() doesn't exist on the builder type returned by
    # .update().eq().select() in this postgrest-py version (only on a
    # builder that started from .select() directly) — calling it crashed
    # every request with a 500 AttributeError. This builder always returns
    # .data as a list, so index into it instead; 0 or 1 rows expected here
    # since we're filtering by primary key.
    row = result.data[0] if result.data else None

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    logger.info(f"📍 Location updated for user {user_id}: {location}")
    return {"location": row["location"]}
