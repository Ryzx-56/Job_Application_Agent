# core/auth.py
import os
from functools import lru_cache

import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException, Query, status
from loguru import logger

# Plain server-side env var (NOT the NEXT_PUBLIC_ one from the frontend,
# though it's the same value) — e.g. https://xxxxx.supabase.co
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None


@lru_cache(maxsize=1)
def _get_jwk_client() -> PyJWKClient:
    """
    Cached client for Supabase's public JWKS endpoint. This endpoint lists
    every currently-valid signing key (current + any previous key still in
    its rotation window), so verification keeps working through a key
    rotation without any code or env changes on this side.
    """
    if not JWKS_URL:
        raise RuntimeError("SUPABASE_URL is not set")
    return PyJWKClient(JWKS_URL, cache_keys=True)


def _verify_token(token: str) -> str:
    """
    Shared verification logic: validates a Supabase JWT against Supabase's
    published public keys and returns the authenticated user's id (the
    token's `sub` claim). Used by both auth dependencies below so there is
    exactly one place that actually checks a token's validity.
    """
    if not JWKS_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server auth is not configured (SUPABASE_URL is missing).",
        )

    try:
        jwk_client = _get_jwk_client()
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
        )
    except jwt.PyJWKClientError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify token signature.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing its subject claim.",
        )

    return user_id


def get_current_user_id(authorization: str = Header(None)) -> str:
    """
    FastAPI dependency — validates `Authorization: Bearer <supabase-jwt>`
    against Supabase's published public keys and returns the authenticated
    user's id. Raises 401 on anything missing/expired/invalid. This is the
    dependency every JSON API endpoint should keep using.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.removeprefix("Bearer ").strip()
    return _verify_token(token)


# The admin flag's column name, most-preferred first. `is_admin` is the
# intended name (and what 003_admin_access.sql renames to); `admin` is what
# the column was originally created as. Both are accepted so the admin
# feature works before AND after that migration runs, rather than the
# rename being a hard prerequisite.
_ADMIN_COLUMN_CANDIDATES = ("is_admin", "admin")

# Owner is an IDENTITY, not a capability. is_admin decides what you can do;
# is_owner only decides which badge renders. Deliberately not implied by
# is_admin, so support access can be granted without handing over the
# product's identity.
_OWNER_COLUMN_CANDIDATES = ("is_owner", "owner")
_ALPHA_COLUMN_CANDIDATES = ("is_alpha_tester", "alpha_tester")


def _read_bool_column(user_id: str | None, candidates: tuple[str, ...], label: str) -> bool:
    """
    Reads a boolean profile flag that may live under more than one column
    name. Never raises.

    Checks EVERY known column name and returns true if any of them is true,
    rather than trusting the first one that happens to exist. That matters
    for one specific half-migrated state: if the `admin` -> `is_admin`
    rename in 003_admin_access.sql was skipped for any reason, the
    `ADD COLUMN IF NOT EXISTS is_admin ... DEFAULT false` that follows it
    creates a SECOND column defaulted to false, while the original `admin`
    column still holds the real value. Reading only the first existing
    column would then report every admin as a non-admin, with nothing
    obviously wrong in the schema.

    Selecting a column that doesn't exist is a PostgREST error rather than
    a null, so a missing name has to be caught rather than tested for. Any
    other failure (network, missing row) is treated as "not an admin",
    which is the safe direction to fail.
    """
    if not user_id:
        return False

    # Local import of get_admin_client to avoid a module-load-order
    # dependency between core/auth.py and core/credits.py (both are
    # imported very early, from main.py and from each other's callers) —
    # deferring it to call time sidesteps that without reorganizing either.
    from core.credits import get_admin_client

    try:
        admin = get_admin_client()
    except Exception as e:
        logger.error(f"{label} check could not reach Supabase: {e}")
        return False

    found_any_column = False
    for column in candidates:
        try:
            row = (
                admin.table("profiles")
                .select(column)
                .eq("id", user_id)
                .maybe_single()
                .execute()
                .data
            )
        except Exception:
            continue  # column doesn't exist on this schema — try the next name

        found_any_column = True
        if row is not None and bool(row.get(column)):
            return True

    if not found_any_column:
        logger.warning(
            f"{label} check found no {' or '.join(candidates)} column on profiles — "
            f"treating user {user_id} as not {label.lower()}. Run the matching migration in supabase/migrations/."
        )
    return False


def read_admin_flag(user_id: str | None) -> bool:
    """True if this user may use /api/v1/admin/*. This is the real gate."""
    return _read_bool_column(user_id, _ADMIN_COLUMN_CANDIDATES, "Admin")


def read_owner_flag(user_id: str | None) -> bool:
    """True if this user gets the Owner badge. Cosmetic only — no route
    anywhere authorizes on this."""
    return _read_bool_column(user_id, _OWNER_COLUMN_CANDIDATES, "Owner")


def read_alpha_tester_flag(user_id: str | None) -> bool:
    """True if this user gets the Alpha Tester badge. Cosmetic only."""
    return _read_bool_column(user_id, _ALPHA_COLUMN_CANDIDATES, "Alpha tester")


def _require_admin(user_id: str) -> str:
    """Shared admin gate for every /api/v1/admin/* route."""
    if not read_admin_flag(user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return user_id


# ─── SUBSCRIPTION GATE (paid-tier features) ─────────────────────────────────
#
# Same shape as the admin gate above: a reader that never raises, and a
# dependency that turns it into a 403. Used by Interview Prep
# (core/interview.py) and available to any later Pro/Elite feature.
#
# THE GATE IS profiles.tier, AND ONLY profiles.tier. Two reasons, both
# deliberate:
#
#   1. It is what the deferred-downgrade design already keeps authoritative.
#      cancel_subscription() (core/subscription.py) does NOT drop the tier on
#      cancellation, it sets pending_tier and lets reset_credits_if_due()
#      switch tier over at credits_reset_at, so a user who cancels keeps the
#      access they paid for until the cycle ends and then loses it without
#      anything here having to reason about dates.
#   2. subscription_status is NOT usable as a gate today. Nothing sets it to
#      "active" (no payment provider is wired yet, see the TODO in
#      core/subscription.py), so it is null for real paying users; requiring
#      it would lock every Pro and Elite subscriber out of the feature.
#      core/badges.py can require it because a missing badge is cosmetic.
#
# WHEN A PAYMENT PROVIDER IS WIRED: add the status check here, using
# badges.ACTIVE_SUBSCRIPTION_STATES plus "canceling" (a canceling subscriber
# is still paid up for the rest of the cycle, per the note above), so a
# past_due subscription loses feature access. Do it here, in this one
# function, and every gated feature picks it up.
PAID_TIERS = ("pro", "elite")


def read_subscription_tier(user_id: str | None) -> str:
    """
    This user's current tier, lowercased. Never raises: any failure returns
    "free", which is the safe direction to fail for a gate.
    """
    if not user_id:
        return "free"

    # Local import for the same module-load-order reason as
    # _read_bool_column above.
    from core.credits import get_admin_client

    try:
        row = (
            get_admin_client()
            .table("profiles")
            .select("tier")
            .eq("id", user_id)
            .maybe_single()
            .execute()
            .data
        )
    except Exception as e:
        logger.error(f"Tier check could not reach Supabase for user {user_id}: {e}")
        return "free"

    return str((row or {}).get("tier") or "free").lower()


def has_paid_tier(user_id: str | None) -> bool:
    """True if this user may use a Pro/Elite-gated feature."""
    return read_subscription_tier(user_id) in PAID_TIERS


def get_current_paid_user_id(authorization: str = Header(None)) -> str:
    """
    Same JWT verification as get_current_user_id, plus a Pro/Elite
    requirement. The frontend blurs a gated page for Free users, but that is
    presentation: this is the check that actually decides, and it runs on
    every request regardless of what the client believes.

    The 403 carries a machine-readable code so the page can show localized
    upgrade copy rather than an English sentence from the server, the same
    convention core/linkedin.py's error details use.
    """
    user_id = get_current_user_id(authorization)
    tier = read_subscription_tier(user_id)
    if tier not in PAID_TIERS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "upgrade_required",
                "tier": tier,
                "message": "This feature is available on the Pro and Elite plans.",
            },
        )
    return user_id


def get_current_admin_user_id(authorization: str = Header(None)) -> str:
    """
    Same JWT verification as get_current_user_id, but additionally requires
    the caller's profiles.is_admin = true. Gates the admin-only "view any
    user's generated CV/cover letter" debug tool (see core/documents.py) —
    now that rendered files aren't stored permanently (see the storage/
    retention rework), this is how the founder can still look at exactly
    what a specific tester/user saw when they report a bug.
    """
    return _require_admin(get_current_user_id(authorization))


def get_current_admin_user_id_query_or_header(
    authorization: str = Header(None),
    token: str = Query(None),
) -> str:
    """Admin-gated variant of get_current_user_id_query_or_header, for the
    admin document-viewer links (plain <a href>, same reasoning as the
    regular download/preview routes)."""
    return _require_admin(get_current_user_id_query_or_header(authorization, token))


def get_current_user_id_query_or_header(
    authorization: str = Header(None),
    token: str = Query(None),
) -> str:
    """
    Same verification as get_current_user_id, but ALSO accepts the JWT as a
    `?token=` query parameter, checked first via the header and falling
    back to the query param.

    Why this exists (bug #14): the CV/cover-letter download and preview
    endpoints need Authorization, which a plain <a href> can't send — the
    frontend was working around that by fetching the file via JS and
    handing out a blob: URL instead. iOS Safari in particular is
    unreliable with `download` + blob: URLs — instead of downloading, it
    often just navigates the tab to display the blob, wiping all app
    state, which matches the "page refreshed and everything disappeared"
    reports. A real <a href="...?token=..." download> hitting this
    dependency lets the browser handle the download natively instead.

    Trade-off worth knowing: a token in a URL can end up in server access
    logs or an outgoing Referer header, unlike a header. Supabase access
    tokens are short-lived, which limits the blast radius, but only use
    this dependency for read-only file endpoints — never for anything
    that writes data — and treat access logs for these routes as
    sensitive.
    """
    if authorization and authorization.startswith("Bearer "):
        return _verify_token(authorization.removeprefix("Bearer ").strip())
    if token:
        return _verify_token(token)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing authentication. Provide an Authorization header or a token query parameter.",
        headers={"WWW-Authenticate": "Bearer"},
    )
