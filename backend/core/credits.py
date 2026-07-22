# core/credits.py
#
# Server-side credit enforcement. This is the ONLY place credits get
# checked or changed — the frontend only ever *reads* a user's balance
# (via Supabase RLS, see lib/supabase/credits.ts). Writes happen exclusively
# through this module, using the Supabase service_role key, which bypasses
# Row Level Security. That key must NEVER be sent to the browser — it only
# lives in this backend's environment.
import os
from functools import lru_cache

from fastapi import HTTPException, status
from loguru import logger
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Credit cost per generation, by output CV language. Must stay in sync with
# the copy shown in CreditsButton.tsx and the helper text under the EN/AR
# toggle on the generate page.
CREDIT_COST = {"en": 1, "ar": 2}

# Monthly credit allotment per tier. Must stay in sync with
# reset_credits_if_due() in the SQL migration (001_profiles_credits.sql).
TIER_CREDITS = {"free": 5, "pro": 40, "elite": 120}


@lru_cache(maxsize=1)
def get_admin_client() -> Client:
    """
    Cached Supabase client authenticated with the service_role key.
    This bypasses RLS entirely — only ever call this from trusted backend
    code, never expose anything derived from it to a client response
    beyond the specific fields you mean to return.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. "
            "Get the service_role key from Supabase Dashboard → Settings → API "
            "— NOT the anon key, and NEVER put it in a NEXT_PUBLIC_ env var."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def normalize_cv_language(cv_language: str) -> str:
    return "ar" if str(cv_language).lower().startswith("ar") else "en"


def reserve_credits(user_id: str, cv_language: str) -> int:
    """
    Call this BEFORE running the generation pipeline. Atomically checks AND
    deducts credits in one step (via the reserve_credits() Postgres
    function), so two parallel requests can't both pass a check before
    either one deducts. Raises 402 if the balance is insufficient.

    Returns the credit amount reserved — pass this to refund_credits() if
    the pipeline fails afterward, since a failed generation should never
    cost the user.
    """
    lang = normalize_cv_language(cv_language)
    cost = CREDIT_COST[lang]
    admin = get_admin_client()

    # Lazy monthly reset: cheap no-op if not due yet, refreshes the balance
    # if it is. Avoids needing a cron job for now.
    admin.rpc("reset_credits_if_due", {"p_user_id": user_id}).execute()

    result = admin.rpc("reserve_credits", {"p_user_id": user_id, "p_amount": cost}).execute()
    reserved = bool(result.data)

    if not reserved:
        # BUG FIX: .single() raises an exception (instead of returning a
        # None/empty result) when the query matches zero rows — e.g. a user
        # whose signup partially failed and never got a profile row. That
        # made this code's intended "no profile" handling unreachable; a
        # missing profile crashed with an unhandled 500 instead of the
        # clear message below. .maybe_single() returns None for zero rows
        # like this code already assumed.
        profile = (
            admin.table("profiles")
            .select("credits_remaining, tier")
            .eq("id", user_id)
            .maybe_single()
            .execute()
            .data
        )
        remaining = profile["credits_remaining"] if profile else 0
        tier = profile["tier"] if profile else "free"
        logger.info(f"🚫 Credit check failed — user {user_id} ({tier}) has {remaining}, needs {cost}.")
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "insufficient_credits",
                "message": (
                    f"Not enough credits for a {'n Arabic' if lang == 'ar' else 'n English'} CV "
                    f"({cost} credit{'s' if cost > 1 else ''} needed, {remaining} remaining)."
                ),
                "credits_remaining": remaining,
                "credits_needed": cost,
                "tier": tier,
            },
        )

    logger.info(f"✅ Reserved {cost} credit(s) for user {user_id} ({lang} CV).")
    return cost


def refund_credits(user_id: str, amount: int) -> None:
    """Call this if the pipeline raises AFTER reserve_credits() succeeded."""
    try:
        get_admin_client().rpc("refund_credits", {"p_user_id": user_id, "p_amount": amount}).execute()
        logger.info(f"↩️ Refunded {amount} credit(s) to user {user_id} after a failed generation.")
    except Exception as err:
        # Don't let a refund failure mask the original pipeline error —
        # log loudly so you can manually fix the balance if this ever fires.
        logger.error(f"❌ Failed to refund {amount} credit(s) to user {user_id}: {err}")


def get_credits(user_id: str) -> dict:
    """Used by a small /api/v1/credits GET endpoint (see main.py) so the
    frontend has a live source of truth beyond direct Supabase reads."""
    admin = get_admin_client()
    admin.rpc("reset_credits_if_due", {"p_user_id": user_id}).execute()
    # BUG FIX: same .single() -> .maybe_single() issue as above — a missing
    # profile row previously crashed with an unhandled 500 instead of
    # reaching the "if not profile" 404 handling right below.
    profile = (
        admin.table("profiles")
        .select("tier, credits_remaining, credits_total, pending_tier, credits_reset_at")
        .eq("id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return profile
