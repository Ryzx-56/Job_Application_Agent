# core/interview.py
#
# Every HTTP route for Interview Prep. Two of them: what the page can offer,
# and one generation.
#
# SECURITY MODEL, the rules this file exists to enforce:
#   1. Both routes require a verified Supabase JWT.
#   2. /generate additionally requires Pro or Elite, via
#      core/auth.py::get_current_paid_user_id. The frontend blurs the page for
#      Free users; THIS is the check that decides. A Free user who calls the
#      endpoint directly gets a 403, not questions.
#   3. Every resume touched is re-checked against the CALLER'S OWN user_id
#      server-side. Someone else's resume id returns 404, never data, and
#      never a 403 that would confirm the id exists. Same reasoning as
#      core/linkedin.py's _fetch_purchase.
#
# RESULTS ARE SAVED, one row per CV, in interview_preps (see
# supabase/migrations/010_interview_preps.sql). Coming back to the page opens
# the saved questions rather than spending another monthly generation on work
# that was already done, which is the whole reason it is stored at all.
#
# Still NOT a session: there is no conversation, no scoring, no per-question
# state. A prep is one immutable document per CV, replaced wholesale when the
# user chooses to regenerate.
#
# NO CREDITS ARE CONSUMED. Access is the subscription itself, so a failed
# generation costs the user nothing and "try again" is always safe to offer.
import json
import queue
import threading

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from loguru import logger

from agents.interview_prep import InterviewPrepError, run_interview_prep
from core.auth import get_current_paid_user_id, get_current_user_id, read_subscription_tier
from core.credits import get_admin_client
from core.entitlements import (
    INTERVIEW_PREP,
    consume_addon_quota,
    get_addon_quota,
    release_addon_quota,
)
from schemas.interview_schema import (
    QUESTION_COUNT_MAX,
    QUESTION_COUNT_MIN,
    InterviewPrepRequest,
)

router = APIRouter()

# The columns one generation needs. Everything here was written by the CV
# pipeline when the CV was made, which is the whole point: this feature adds
# no new stored state, it reads what is already there.
_RESUME_COLUMNS = (
    "id, user_id, role, company, cv_language, job_description, "
    "ats_breakdown, gap_analysis, generation_snapshot, created_at"
)

# A job description shorter than this isn't a posting, it's a placeholder or
# a pasted job title. Generating 12 questions from it would produce generic
# filler, so the CV is marked unusable in the picker instead.
JD_MIN_CHARS = 120


def _fetch_resume(resume_id: str, user_id: str) -> dict:
    """One of the caller's own CVs. 404 (not 403) when it isn't theirs, so a
    guessed id can't be used to confirm that a resume exists."""
    if not resume_id or not str(resume_id).strip():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV not found.")

    try:
        row = (
            get_admin_client()
            .table("resumes")
            .select(_RESUME_COLUMNS)
            .eq("id", str(resume_id).strip())
            .maybe_single()
            .execute()
            .data
        )
    except Exception as e:
        # A malformed uuid is a PostgREST cast error, not a server fault.
        # Same clean 404 a valid-but-someone-else's id gets.
        logger.info(f"Interview prep resume lookup failed for '{resume_id}': {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV not found.")

    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV not found.")
    return row


def _eligibility(row: dict) -> dict:
    """
    Whether one CV can be prepped from, and if not, why.

    The two reasons a CV is unusable are genuinely different and the picker
    says which: `no_jd` means the row has no job description attached (there
    is nothing to interview against), `no_snapshot` means the row predates
    generation_snapshot so there is no structured CV data to build answers
    from. Both are data gaps rather than errors, and both are permanent for
    that row, which is why the card is disabled rather than allowed to fail
    after the user clicks it.
    """
    job_description = str(row.get("job_description") or "").strip()
    snapshot = row.get("generation_snapshot") or {}
    has_facts = bool((snapshot or {}).get("facts_json", {}).get("personal"))

    if len(job_description) < JD_MIN_CHARS:
        return {"eligible": False, "reason": "no_jd"}
    if not has_facts:
        return {"eligible": False, "reason": "no_snapshot"}
    return {"eligible": True, "reason": None}


def _fetch_prep(resume_id: str, user_id: str) -> dict | None:
    """The saved prep for one CV, or None. Scoped to the caller."""
    try:
        return (
            get_admin_client()
            .table("interview_preps")
            .select("id, resume_id, language, content, created_at, updated_at")
            .eq("user_id", user_id)
            .eq("resume_id", resume_id)
            .maybe_single()
            .execute()
            .data
        )
    except Exception as e:
        # Table missing (migration not applied) or a transient failure. Both
        # mean "no saved prep", which degrades to the old behaviour of
        # generating fresh rather than breaking the page.
        logger.warning(f"Could not read the saved interview prep for {resume_id}: {e}")
        return None


def _prepared_map(user_id: str) -> dict[str, str]:
    """resume_id -> when its prep was last written, for the picker."""
    try:
        rows = (
            get_admin_client()
            .table("interview_preps")
            .select("resume_id, updated_at")
            .eq("user_id", user_id)
            .execute()
            .data
            or []
        )
    except Exception as e:
        logger.warning(f"Could not list saved interview preps for {user_id}: {e}")
        return {}
    return {r["resume_id"]: r.get("updated_at") for r in rows}


def _save_prep(user_id: str, resume_id: str, language: str, content: dict) -> None:
    """
    Stores the finished prep, replacing any previous one for this CV.

    Upsert on the (user_id, resume_id) unique constraint, so a regenerate
    overwrites rather than accumulating question sets the user would then
    have to choose between.

    Never raises: the questions are already generated and already on their
    way to the browser, so a failed save must not turn a successful run into
    an error. It only costs the user the ability to come back to it.
    """
    try:
        get_admin_client().table("interview_preps").upsert(
            {
                "user_id": user_id,
                "resume_id": resume_id,
                "language": language,
                "content": content,
                "updated_at": _now_iso(),
            },
            on_conflict="user_id,resume_id",
        ).execute()
    except Exception as e:
        logger.error(f"❌ Could not save the interview prep for {resume_id}: {e}")


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


@router.get("/api/v1/interview/preps/{resume_id}", tags=["Interview"])
def get_saved_prep(resume_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Opens a previously generated prep. Costs no monthly slot, which is the
    entire point of saving them.

    Not tier-gated: someone whose subscription lapsed keeps access to what
    they already generated, the same way a downgraded user keeps their saved
    CVs. The gate is on making a NEW one.
    """
    _fetch_resume(resume_id, user_id)  # ownership, and a clean 404 if not theirs
    prep = _fetch_prep(resume_id, user_id)
    if not prep:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "no_saved_prep", "message": "There is no saved prep for this CV yet."},
        )
    return {
        "resume_id": resume_id,
        "content": prep.get("content"),
        "created_at": prep.get("created_at"),
        "updated_at": prep.get("updated_at"),
    }


@router.get("/api/v1/interview/overview", tags=["Interview"])
def interview_overview(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    What the page needs before it renders anything: whether this account is
    unlocked, and which of their CVs can actually be prepped from.

    Deliberately NOT tier-gated. A Free user has to be able to load the page
    to see the blurred preview and the upgrade prompt, and the CV list they
    see behind the blur is their own data either way. The tier gate is on
    /generate, which is the thing that costs something.
    """
    tier = read_subscription_tier(user_id)
    unlocked = tier in ("pro", "elite")

    try:
        rows = (
            get_admin_client()
            .table("resumes")
            .select(_RESUME_COLUMNS)
            .eq("user_id", user_id)
            .eq("is_archived", False)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
            .data
            or []
        )
    except Exception as e:
        logger.error(f"❌ Interview prep overview query failed: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "interview_unavailable",
                "message": "We couldn't load your CVs just now. Please try again.",
            },
        )

    prepared = _prepared_map(user_id)

    cvs = []
    for row in rows:
        eligibility = _eligibility(row)
        cvs.append({
            "id": row["id"],
            "role": row.get("role"),
            "company": row.get("company"),
            "cv_language": row.get("cv_language") or "en",
            "created_at": row.get("created_at"),
            "eligible": eligibility["eligible"],
            "ineligible_reason": eligibility["reason"],
            # Already generated: the card opens it instead of spending
            # another monthly slot.
            "prepared_at": prepared.get(row["id"]),
        })

    return {
        "tier": tier,
        "unlocked": unlocked,
        "cvs": cvs,
        "question_range": {"min": QUESTION_COUNT_MIN, "max": QUESTION_COUNT_MAX},
        # This month's allowance (reference v6 section 5: 5 on Pro, 15 on
        # Elite). Shown before a run so the cost of pressing the button is
        # visible, rather than discovered by being refused.
        "quota": get_addon_quota(user_id, INTERVIEW_PREP),
    }


# ─── STREAMING ──────────────────────────────────────────────────────────────
#
# WHY THIS ENDPOINT STREAMS RATHER THAN BLOCKING.
#
# A measured run is two to four minutes: one big Sonnet call over a whole CV
# and a whole posting. A plain POST held open that long is exactly the request
# an intermediary kills. generate_claude_text already solved the same problem
# on the backend-to-Anthropic hop by streaming (see its docstring: Render's
# outbound proxy kills a connection that goes silent, and the SDK reports it
# as an indistinguishable "Connection error"); this is the same fix applied to
# the browser-to-backend hop, and the same SSE shape main.py's
# /optimize/stream already uses, so the frontend pattern is not a new one
# either.
#
# The heartbeat is the part that actually prevents the timeout: the model call
# produces nothing to send for minutes at a time, so without a periodic frame
# the connection is idle regardless of being a stream.

# How often to emit a keep-alive while the model is working. Comfortably under
# the 30-60s idle window proxies and load balancers typically enforce.
HEARTBEAT_SECONDS = 10


def _sse(event: str, data: dict) -> str:
    """One Server-Sent Event frame. Same two-line format as main.py's _sse;
    duplicated rather than imported because importing main from core would be
    circular."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_interview_prep(row: dict, user_id: str, language: str | None):
    """
    Runs the generation on a worker thread and yields SSE frames from the main
    one.

    A thread plus a queue rather than a straight call, for one reason: the
    generation is a single blocking call with nothing to report from inside
    it, so the only way to keep bytes moving is to wait on it with a timeout
    and emit a heartbeat each time that timeout expires. The queue is also how
    the agent's real phase events cross the thread boundary.

    The thread is a daemon, so a client that disconnects mid-run doesn't keep
    the worker alive past shutdown. The work itself still finishes and is
    discarded, which is the right trade: nothing is stored, no credit is
    spent, and cancelling an in-flight Claude call would save nothing by then.
    """
    events: queue.Queue = queue.Queue()
    result: dict = {}

    def work():
        try:
            result["content"] = run_interview_prep(
                row,
                on_step=lambda step: events.put(("step", {"step": step})),
                output_language=language,
            )
        except InterviewPrepError as e:
            logger.error(f"❌ Interview prep failed for resume {row['id']}: {e}")
            result["error"] = {"code": "generation_failed", "message": str(e)}
        except Exception as e:
            logger.error(f"❌ Interview prep crashed for resume {row['id']}: {type(e).__name__}: {e}")
            result["error"] = {
                "code": "generation_failed",
                "message": "Something went wrong preparing your questions. Please try again.",
            }
        finally:
            # A run that produced nothing must not cost a month's slot, the
            # same rule refund_credits applies to a failed CV generation.
            if "error" in result:
                release_addon_quota(user_id, INTERVIEW_PREP)
            events.put(("__done__", None))

    thread = threading.Thread(target=work, daemon=True)
    thread.start()

    while True:
        try:
            kind, payload = events.get(timeout=HEARTBEAT_SECONDS)
        except queue.Empty:
            # Nothing to report yet. Send a frame anyway so the connection is
            # never idle long enough to be dropped.
            yield _sse("ping", {})
            continue
        if kind == "__done__":
            break
        yield _sse(kind, payload)

    if "error" in result:
        yield _sse("error", result["error"])
    else:
        # Saved before the payload goes out, so a user who reloads the moment
        # it lands finds it there.
        _save_prep(user_id, row["id"], (result["content"] or {}).get("language") or "en", result["content"])
        yield _sse("complete", {
            "resume_id": row["id"],
            "content": result["content"],
            # What's left after this run, so the page can update its counter
            # without a second request.
            "quota": get_addon_quota(user_id, INTERVIEW_PREP),
        })


@router.post("/api/v1/interview/generate", tags=["Interview"])
def generate_interview_prep(
    payload: InterviewPrepRequest,
    user_id: str = Depends(get_current_paid_user_id),
):
    """
    Generates one interview prep set from a saved CV and its job description,
    streamed as Server-Sent Events.

    Everything that can be refused is refused BEFORE the stream opens: the
    subscription gate (the dependency above), ownership, and eligibility all
    raise a normal HTTP error with a machine-readable code. Once the first
    frame is sent the status line is already 200, so a failure after that
    point can only be reported as an `error` event, which is why nothing
    fallible is left until then.

    Events: `step` (a real phase began), `ping` (keep-alive, ignore),
    `complete` (the payload), `error` (code + message).
    """
    row = _fetch_resume(payload.resume_id, user_id)

    eligibility = _eligibility(row)
    if not eligibility["eligible"]:
        # Refused before the model call, with the specific reason, so the page
        # can explain it rather than showing a generic failure after a wait.
        messages = {
            "no_jd": "This CV has no job description saved with it, so there's nothing to prepare against.",
            "no_snapshot": (
                "This CV was saved before we started storing the structured data this needs. "
                "Generate a newer CV and prepare from that one."
            ),
        }
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": eligibility["reason"],
                "message": messages.get(eligibility["reason"], "This CV can't be used here."),
            },
        )

    # Claimed as late as possible, after every refusable check above has
    # passed, so a request turned away for an ineligible CV never costs one
    # of the month's runs. Released again by the worker if the run fails.
    consume_addon_quota(user_id, INTERVIEW_PREP)

    return StreamingResponse(
        _stream_interview_prep(row, user_id, payload.language),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Disable proxy/CDN buffering (nginx in particular). Without it an
            # intermediary can hold the heartbeats back and release them all
            # at the end, which defeats the entire point of sending them.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
