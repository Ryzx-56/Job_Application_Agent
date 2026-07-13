# core/auth.py
import os
from functools import lru_cache

import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException, status

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


def get_current_user_id(authorization: str = Header(None)) -> str:
    """
    FastAPI dependency — validates `Authorization: Bearer <supabase-jwt>`
    against Supabase's published public keys and returns the authenticated
    user's id (the token's `sub` claim). Raises 401 on anything
    missing/expired/invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.removeprefix("Bearer ").strip()

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
