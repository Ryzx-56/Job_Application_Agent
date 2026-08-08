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


def read_admin_flag(user_id: str | None) -> bool:
    """
    True if this user is an admin. Never raises.

    Tries each known column name in turn: selecting a column that doesn't
    exist is a PostgREST error, not a null, so the miss has to be caught
    rather than tested for. Any other failure (network, missing row) is
    treated as "not an admin", which is the safe direction to fail.
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
        logger.error(f"Admin check could not reach Supabase: {e}")
        return False

    for column in _ADMIN_COLUMN_CANDIDATES:
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
        if row is not None:
            return bool(row.get(column))

    return False


def _require_admin(user_id: str) -> str:
    """Shared admin gate for every /api/v1/admin/* route."""
    if not read_admin_flag(user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
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
