# core/auth.py
import os
from functools import lru_cache

import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException, Query, status

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
