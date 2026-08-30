# core/rate_limit.py
#
# Per-user rate limiting for the endpoints that cost money to serve.
#
# ── WHAT THIS IS FOR, GIVEN CREDITS ALREADY EXIST ───────────────────────────
# Credits and add-on quotas cap how much a user can spend over a MONTH. They
# do not cap how fast, and one of them does not apply at all:
#
#   · /api/v1/job-search has no credit or quota gate — it is gated only on
#     being a paid tier. Every call fans out into Tavily searches that are
#     billed per request, with nothing bounding how many a subscriber makes.
#     This is the real cost exposure and the reason this module exists.
#   · The generation endpoints are capped by credits, so the total spend is
#     already bounded, but nothing stopped twenty parallel requests from one
#     account. On a single free-tier instance that is an availability problem
#     rather than a billing one.
#   · /api/v1/profile/suggest-name has no gate of any kind. It spends no LLM
#     money, but it does parse an uploaded document, which is CPU this box
#     does not have spare.
#
# ── THE HONEST LIMITATION ───────────────────────────────────────────────────
# State lives in this process. Render's free tier runs one instance, so today
# that is the whole picture; if it is ever scaled out, each instance counts
# separately and the effective limit multiplies by the instance count. Fixing
# that means a shared store (the frontend uses Upstash for the same job, see
# frontend/src/lib/rate-limit.ts) and a new backend dependency, which is not
# worth adding while the deployment is a single box.
#
# Limits are deliberately generous. They are burst protection, not a product
# constraint — a free user cannot reach them at all before running out of
# credits, and a paying user doing real work will not notice them.
import os
import threading
import time

from fastapi import HTTPException, status
from loguru import logger


class RateLimit:
    """One named limit: `max_calls` inside `window_seconds`, per user."""

    def __init__(self, name: str, max_calls: int, window_seconds: int):
        self.name = name
        self.max_calls = max_calls
        self.window_seconds = window_seconds


# Generation. Credits already bound the monthly total (3 free / 24 pro /
# 80 elite), so this only stops a burst — an Elite user could otherwise fire
# their whole month's allowance at the box at once.
GENERATION = RateLimit("generation", max_calls=20, window_seconds=3600)

# Job search. THE ONE WITH NO OTHER CEILING. Each call costs real Tavily
# requests, so this is the only thing standing between a subscriber and an
# unbounded bill.
JOB_SEARCH = RateLimit("job_search", max_calls=30, window_seconds=3600)

# Interview prep and LinkedIn generation both sit behind a monthly quota or a
# completed purchase already; this is burst protection on top.
ADDON_GENERATION = RateLimit("addon_generation", max_calls=15, window_seconds=3600)

# CV parsing for the name suggestion. No LLM spend, but real CPU per call.
CV_PARSE = RateLimit("cv_parse", max_calls=30, window_seconds=3600)


# Set RATE_LIMIT_DISABLED=1 to turn every limit off. For local development and
# load testing only — it is read once per call so it can be flipped without a
# restart, and it logs loudly the first time it takes effect.
_DISABLED_WARNED = False


def _disabled() -> bool:
    global _DISABLED_WARNED
    if (os.getenv("RATE_LIMIT_DISABLED", "") or "").strip() in ("1", "true", "yes"):
        if not _DISABLED_WARNED:
            logger.warning("⚠️ RATE_LIMIT_DISABLED is set — per-user rate limiting is OFF.")
            _DISABLED_WARNED = True
        return True
    return False


# (limit name, user id) -> call timestamps, oldest first.
_hits: dict[tuple[str, str], list[float]] = {}
# The generation endpoints are async and FastAPI runs sync dependencies in a
# threadpool, so this genuinely can be touched from more than one thread.
_lock = threading.Lock()

_last_sweep = 0.0
_SWEEP_INTERVAL = 300.0


def _sweep(now: float) -> None:
    """Drops entries no live window can still reference. Called under _lock."""
    global _last_sweep
    if now - _last_sweep < _SWEEP_INTERVAL:
        return
    _last_sweep = now
    widest = max(r.window_seconds for r in (GENERATION, JOB_SEARCH, ADDON_GENERATION, CV_PARSE))
    for key, times in list(_hits.items()):
        live = [t for t in times if now - t < widest]
        if live:
            _hits[key] = live
        else:
            del _hits[key]


def enforce(limit: RateLimit, user_id: str) -> None:
    """
    Records one call and raises 429 if `user_id` is over `limit`.

    Counts every call, not just failures — unlike the login limiter, where a
    successful sign-in is the normal case and must not count against anyone.
    Here each call IS the expensive thing.

    The 429 carries Retry-After and a machine-readable code so the frontend
    can say something specific instead of showing a generic failure.
    """
    if _disabled():
        return

    now = time.monotonic()
    key = (limit.name, user_id)

    with _lock:
        _sweep(now)
        live = [t for t in _hits.get(key, []) if now - t < limit.window_seconds]

        if len(live) >= limit.max_calls:
            retry_after = max(1, int(limit.window_seconds - (now - live[0])) + 1)
            _hits[key] = live
            logger.warning(
                f"⏱️ Rate limit '{limit.name}' hit by user {user_id}: "
                f"{len(live)}/{limit.max_calls} in {limit.window_seconds}s."
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "rate_limited",
                    "limit": limit.name,
                    "retry_after": retry_after,
                    "message": (
                        "You're doing that faster than we can keep up with. "
                        "Please wait a moment and try again."
                    ),
                },
                headers={"Retry-After": str(retry_after)},
            )

        live.append(now)
        _hits[key] = live


def reset_for_tests() -> None:
    """Drops all state. Tests only."""
    with _lock:
        _hits.clear()
