# core/linkedin.py
#
# Every HTTP route for the LinkedIn add-on: pricing, checkout, the payment
# webhook, generation, history, and the admin queue for premium orders.
#
# SECURITY MODEL (§8), the rules this file exists to enforce:
#   1. Every route below requires a verified Supabase JWT (get_current_user_id)
#      except the gateway webhook, which is authenticated by the gateway's own
#      shared secret instead and fails closed if that secret isn't configured.
#   2. Every purchase, generation and CV touched is re-checked against the
#      CALLER'S OWN user_id server-side. A guessed or leaked id belonging to
#      someone else returns 404, never data. Ownership is never inferred from
#      anything the client sent.
#   3. /linkedin/generate refuses to run without a purchase row that is
#      actually paid, and one paid purchase entitles exactly one completed
#      generation (enforced in the database too, see
#      008_linkedin_addon.sql).
#   4. Prices are read from PRICING here, never from the request body.
#
# All writes go through the service_role client (get_admin_client), which
# bypasses RLS: the browser has SELECT-own and nothing else on these tables.
import os
import re
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from loguru import logger

from agents.linkedin_generator import (
    LinkedInGenerationError,
    run_linkedin_generator,
)
from core.auth import get_current_admin_user_id, get_current_user_id, read_admin_flag
from core.credits import get_admin_client
from core.linkedin_notify import lookup_buyers, send_premium_order_alert
from core.payment_gateway import (
    FAILED,
    PAID,
    GatewayError,
    GatewayUnavailable,
    WebhookVerificationError,
    gateway_status,
    get_gateway,
)
from core.profile_names import get_profile_names, required_name_for
from schemas.linkedin_schema import LinkedInCheckoutRequest, LinkedInGenerateRequest

router = APIRouter()

# ─── PRICING ────────────────────────────────────────────────────────────────
#
# One-time add-on prices, in SAR. Server-side source of truth: the client
# sends a tier, never a price, and what the buyer actually paid is copied onto
# the purchase row so a later price change can't rewrite history.
#
# normal (49 SAR): a single Claude Sonnet call over structured JSON we already
# have, so the marginal cost is a couple of cents, priced as an impulse add-on
# right after CV creation.
# premium (200 SAR): priced for a human's time building the profile, not for
# compute. Being manual, the price also caps volume to what one person can
# actually deliver.
PRICING = {
    "normal": {"price": 49.00, "currency": "SAR"},
    "premium": {"price": 200.00, "currency": "SAR"},
}

# Where a hosted gateway sends the buyer back to after paying. The page they
# land on shows their purchase and the Generate button, but landing there is
# NOT what unlocks it; the gateway's webhook is (§5). Overridable per
# environment so a local mock/staging run doesn't bounce people to production.
APP_URL = (os.getenv("PUBLIC_APP_URL", "") or "https://tarshih.com").rstrip("/")
LINKEDIN_RETURN_PATH = "/dashboard/linkedin"

# A generation row left in 'generating' by a process that died would otherwise
# block its purchase forever (the one-generation-per-purchase index counts it).
# After this long, a 'generating' row is considered abandoned and gets reused
# by the next attempt.
STALE_GENERATION_MINUTES = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


# ─── DATA ACCESS ────────────────────────────────────────────────────────────

# Every id in this feature is a uuid primary key. Checking the shape before
# querying turns a guessed/garbage id into the same clean 404 a valid-but-
# someone-else's id gets, instead of a 500 from PostgREST rejecting the cast,
# which would both look like a server fault and tell a prober that their input
# was at least the wrong TYPE, not the wrong id.
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _require_uuid(value: str, label: str) -> str:
    if not value or not _UUID_RE.match(str(value).strip()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found.")
    return str(value).strip()


def _fetch_purchase(purchase_id: str, user_id: str) -> dict:
    """A purchase, but only if it belongs to the caller.

    404 (not 403) when it isn't theirs, a 403 would confirm the id exists,
    which is exactly the leak the admin-panel bug was about. Same reasoning as
    core/documents.py's ownership check.
    """
    row = (
        get_admin_client()
        .table("linkedin_purchases")
        .select("*")
        .eq("id", _require_uuid(purchase_id, "Purchase"))
        .maybe_single()
        .execute()
        .data
    )
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase not found.")
    return row


def _fetch_resume(resume_id: str, user_id: str) -> dict:
    """One of the caller's own CVs, with the structured data a generation
    needs. Ownership-checked the same way."""
    row = (
        get_admin_client()
        .table("resumes")
        .select("id, user_id, role, company, cv_language, generation_snapshot, created_at")
        .eq("id", _require_uuid(resume_id, "CV"))
        .maybe_single()
        .execute()
        .data
    )
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV not found.")
    return row


def _facts_from_resume(resume: dict) -> dict:
    """
    Pulls facts_json out of a saved CV's generation_snapshot.

    This is the read-only consumption of the CV pipeline's output that the
    whole feature is built on, see build_generation_snapshot in main.py for
    the write side. Rows saved before snapshots existed have nothing to read,
    which is a data gap rather than a bug, so it gets its own code the
    frontend can explain.
    """
    snapshot = resume.get("generation_snapshot") or {}
    facts = (snapshot or {}).get("facts_json") or {}
    if not facts.get("personal"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "cv_not_supported",
                "message": (
                    "This CV doesn't have the structured data we build a LinkedIn profile from. "
                    "Pick a more recent CV, or generate a new one."
                ),
            },
        )
    return facts


def _cv_labels(user_id: str, resume_ids: list[str]) -> dict[str, dict]:
    """role/company/language for a set of the caller's CVs, for labelling
    history rows. Scoped to the caller's own rows, so this can't be used to
    probe someone else's resume ids."""
    ids = sorted({rid for rid in resume_ids if rid and _UUID_RE.match(str(rid))})
    if not ids:
        return {}
    rows = (
        get_admin_client()
        .table("resumes")
        .select("id, role, company, cv_language")
        .eq("user_id", user_id)
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    return {row["id"]: row for row in rows}


def _existing_generation(purchase_id: str) -> dict | None:
    rows = (
        get_admin_client()
        .table("linkedin_generations")
        .select("id, status, created_at, updated_at")
        .eq("purchase_id", purchase_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    # The database allows at most one non-failed row per purchase, so a
    # non-failed row is THE generation for it; otherwise the newest failure is
    # what a retry should reuse.
    for row in rows:
        if row.get("status") != "failed":
            return row
    return rows[0] if rows else None


def _is_stale(row: dict) -> bool:
    stamp = row.get("updated_at") or row.get("created_at")
    if not stamp:
        return True
    try:
        started = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return True
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return _now() - started > timedelta(minutes=STALE_GENERATION_MINUTES)


# ─── PAYMENT CONFIRMATION ───────────────────────────────────────────────────


def _confirm_paid(reference: str) -> dict:
    """
    Marks the purchase behind `reference` as paid. THE only place that flips a
    purchase to 'paid', used by both the real webhook and the mock gateway's
    server-side auto-confirm, a mock payment therefore proves the same code
    path a real one will take.

    IDEMPOTENT (§5): a purchase already marked paid is returned untouched, so
    a duplicate webhook delivery can't double-unlock a generation or fire a
    second premium alert. The conditional update (…eq('payment_status',
    'pending')) is what makes that safe under two simultaneous deliveries
    rather than merely likely: exactly one of them updates a row.
    """
    admin = get_admin_client()
    purchase = (
        admin.table("linkedin_purchases")
        .select("*")
        .eq("payment_reference", reference)
        .maybe_single()
        .execute()
        .data
    )
    if not purchase:
        return {"matched": False}

    if purchase.get("payment_status") == PAID:
        logger.info(f"↩️ Payment {reference} was already recorded as paid, ignoring duplicate confirmation.")
        return {"matched": True, "purchase": purchase, "already_paid": True}

    updates = {
        "payment_status": PAID,
        "paid_at": _iso(_now()),
    }
    # Premium enters the manual fulfillment queue the moment it's paid for.
    if purchase.get("tier") == "premium":
        updates["fulfillment_status"] = "pending"

    updated = (
        admin.table("linkedin_purchases")
        .update(updates)
        .eq("id", purchase["id"])
        .eq("payment_status", "pending")
        .execute()
        .data
        or []
    )
    if not updated:
        # Another concurrent delivery won the race and already applied it.
        logger.info(f"↩️ Payment {reference} was confirmed concurrently, nothing further to do.")
        return {"matched": True, "purchase": purchase, "already_paid": True}

    purchase = updated[0]
    logger.info(f"💳 LinkedIn {purchase['tier']} purchase {purchase['id']} confirmed paid ({reference}).")

    if purchase.get("tier") == "premium" and not purchase.get("notified_at"):
        _notify_premium_async(purchase)

    return {"matched": True, "purchase": purchase, "already_paid": False}


def _mark_failed(reference: str) -> None:
    try:
        (
            get_admin_client()
            .table("linkedin_purchases")
            .update({"payment_status": FAILED})
            .eq("payment_reference", reference)
            .eq("payment_status", "pending")
            .execute()
        )
    except Exception as e:
        logger.error(f"Couldn't mark payment {reference} failed: {e}")


def _notify_premium_async(purchase: dict) -> None:
    """
    Fires the premium order alert off the request path.

    Same fire-and-forget pattern main.py uses for usage events, and for the
    same reason: the buyer's checkout must not wait on (or fail because of) an
    outbound email. The admin dashboard queue is already populated by the
    fulfillment_status write above, so a failed email loses nothing.
    """

    def _run():
        try:
            buyers = lookup_buyers([purchase["user_id"]])
            cv = None
            if purchase.get("source_cv_id"):
                cv = (
                    get_admin_client()
                    .table("resumes")
                    .select("id, role, company")
                    .eq("id", purchase["source_cv_id"])
                    .maybe_single()
                    .execute()
                    .data
                )
            send_premium_order_alert({**purchase, "buyer": buyers.get(purchase["user_id"], {}), "source_cv": cv})
        except Exception as e:
            logger.error(f"❌ Premium order alert failed for purchase {purchase.get('id')}: {e}")
        finally:
            # Stamped whether or not the email got through: the order is in
            # the admin queue regardless, and a retried webhook re-sending the
            # same alert is worse than a missing one we've already logged.
            try:
                (
                    get_admin_client()
                    .table("linkedin_purchases")
                    .update({"notified_at": _iso(_now())})
                    .eq("id", purchase["id"])
                    .execute()
                )
            except Exception as e:
                logger.error(f"Couldn't stamp notified_at on purchase {purchase.get('id')}: {e}")

    threading.Thread(target=_run, daemon=True).start()


# ─── ROUTES: BUYING ─────────────────────────────────────────────────────────


def _unavailable(error: Exception, user_id: str | None = None) -> HTTPException:
    """
    Turns a database failure into a real, CORS-carrying HTTP response.

    WHY THIS EXISTS: an unhandled exception in a FastAPI endpoint is rendered
    by Starlette's ServerErrorMiddleware, which sits OUTSIDE CORSMiddleware,
    so that 500 goes back without any Access-Control-Allow-Origin header, the
    browser refuses to hand it to JavaScript, and the frontend sees the
    generic "Failed to fetch" with no status at all. The result is a page that
    can't tell the user (or us) anything about what broke. Raising an
    HTTPException instead means the response passes back THROUGH the CORS
    layer, so the code below actually reaches the browser.

    The one hint that gets through to the client is the "tables missing" case,
    which is a deployment step nobody has run yet rather than anything about a
    user or their data.
    """
    text = str(error).lower()
    if "does not exist" in text or "could not find the table" in text or "pgrst205" in text:
        logger.error(
            f"❌ LinkedIn tables are missing from this database: {error}. "
            "Run supabase/migrations/008_linkedin_addon.sql."
        )
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "linkedin_not_set_up",
                "message": "The LinkedIn add-on isn't set up on this environment yet.",
                "hint": "008_linkedin_addon.sql has not been applied to this database.",
            },
        )

    logger.error(f"❌ LinkedIn overview query failed: {type(error).__name__}: {error}")
    detail = {
        "code": "linkedin_unavailable",
        "message": "We couldn't reach your LinkedIn add-on just now. Please try again.",
    }

    # ADMINS GET THE REAL REASON, nobody else does. Without this, the only
    # copy of why a request failed is a line in the server log, which is a slow
    # loop when the person debugging is also the person looking at the page.
    # Gated on profiles.is_admin (the same server-side check every /admin route
    # uses), truncated, and only ever attached on the failure path, a normal
    # user still sees nothing but the sentence above.
    if user_id and read_admin_flag(user_id):
        detail["debug"] = f"{type(error).__name__}: {str(error)[:400]}"

    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


@router.get("/api/v1/linkedin/overview", tags=["LinkedIn"])
def linkedin_overview(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Everything the LinkedIn tab needs to decide what to render, in one call:
    prices, whether buying is switched on at all, what the caller has already
    bought, and their generation history.

    `has_purchased` is what flips the page from the sales explainer to the
    history view (§1), and `pending_generations` is what puts a "Generate"
    button on a paid purchase that hasn't been used yet.
    """
    admin = get_admin_client()

    try:
        purchases = (
            admin.table("linkedin_purchases")
            .select("id, tier, source_cv_id, price_paid, currency, payment_status, "
                    "fulfillment_status, created_at, paid_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        generations = (
            admin.table("linkedin_generations")
            .select("id, purchase_id, status, created_at, updated_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
    except Exception as e:
        # See _unavailable: a raw 500 here would reach the browser stripped of
        # its CORS headers and show up as an untraceable "Failed to fetch".
        raise _unavailable(e, user_id)

    labels = _cv_labels(user_id, [p.get("source_cv_id") for p in purchases])

    # Which purchases are actually SPENT. A failed generation doesn't spend
    # one, and neither does a 'generating' row that's gone stale, the process
    # behind it died, and /linkedin/generate will reclaim that row. Counting a
    # stale row as spent is what would leave a paying user staring at
    # "generating" with no way to retry.
    by_purchase = {
        g["purchase_id"]: g
        for g in generations
        if g.get("status") == "ready" or (g.get("status") == "generating" and not _is_stale(g))
    }

    history = []
    for generation in generations:
        purchase = next((p for p in purchases if p["id"] == generation["purchase_id"]), {})
        cv = labels.get(purchase.get("source_cv_id") or "") or {}
        history.append({
            "generation_id": generation["id"],
            "purchase_id": generation["purchase_id"],
            "status": generation["status"],
            "created_at": generation["created_at"],
            "tier": purchase.get("tier"),
            "source_cv": {
                "id": cv.get("id"),
                "role": cv.get("role"),
                "company": cv.get("company"),
                "cv_language": cv.get("cv_language"),
            } if cv else None,
        })

    # Paid purchases with no usable generation yet, each one is a "Generate"
    # button the user is entitled to press.
    pending = [
        {
            "purchase_id": p["id"],
            "tier": p["tier"],
            "source_cv_id": p.get("source_cv_id"),
            "source_cv": labels.get(p.get("source_cv_id") or ""),
            "created_at": p["created_at"],
        }
        for p in purchases
        if p["payment_status"] == PAID and p["id"] not in by_purchase
    ]

    return {
        "pricing": PRICING,
        "gateway": gateway_status(),
        "has_purchased": any(p["payment_status"] == PAID for p in purchases),
        "purchases": purchases,
        "history": history,
        "pending_generations": pending,
    }


@router.post("/api/v1/linkedin/checkout", tags=["LinkedIn"])
def linkedin_checkout(
    payload: LinkedInCheckoutRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Starts a purchase: validates what's being bought, records a pending
    purchase, and asks the gateway for a payment.

    Never returns anything that unlocks a generation. Unlocking happens only
    in _confirm_paid, which is driven by the gateway (server-side), not by
    this response and not by any client-side "success" redirect (§5).
    """
    tier = payload.tier
    price = PRICING[tier]

    # The CV has to be the caller's, and has to be one we can actually
    # generate from, better to refuse before taking money than after.
    resume = _fetch_resume(payload.source_cv_id, user_id)
    _facts_from_resume(resume)

    if tier == "premium":
        if not payload.contact_consent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "consent_required",
                    "message": "Premium includes us contacting you, so we need your consent to do that.",
                },
            )
        if not (payload.contact_phone or "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "phone_required",
                    "message": "Add a phone number so our team can reach you about your profile build.",
                },
            )

    # Gateway availability is checked BEFORE a purchase row is created, so a
    # "payments aren't live yet" state doesn't litter the table with pending
    # purchases nobody can ever complete.
    try:
        gateway = get_gateway()
    except GatewayUnavailable as e:
        logger.info(f"LinkedIn checkout attempted while payments are off: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "payment_gateway_unavailable",
                "message": "Online payment isn't live yet. It'll be available here shortly.",
            },
        )

    admin = get_admin_client()
    inserted = (
        admin.table("linkedin_purchases")
        .insert({
            "user_id": user_id,
            "tier": tier,
            "source_cv_id": resume["id"],
            "price_paid": price["price"],
            "currency": price["currency"],
            "payment_status": "pending",
            "contact_phone": (payload.contact_phone or "").strip() or None,
            "contact_consent": bool(payload.contact_consent),
            "fulfillment_status": "pending" if tier == "premium" else "not_required",
        })
        .execute()
        .data
        or []
    )
    if not inserted:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Couldn't start this purchase. Please try again.",
        )
    purchase = inserted[0]

    # NOTE: fulfillment_status is set to 'pending' for premium at insert time
    # so an abandoned premium checkout is still visible as an unpaid attempt;
    # the admin queue filters on payment_status = paid, so it doesn't show up
    # as work owed until it's actually been paid for.

    try:
        intent = gateway.create_payment(
            amount=price["price"],
            currency=price["currency"],
            description=f"Tarshih LinkedIn profile ({tier})",
            reference_hint=purchase["id"],
            callback_url=f"{APP_URL}{LINKEDIN_RETURN_PATH}",
        )
    except (GatewayUnavailable, GatewayError) as e:
        _fail_purchase(purchase["id"], reason=str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "payment_gateway_unavailable",
                "message": "Online payment isn't live yet. It'll be available here shortly.",
            },
        )

    admin.table("linkedin_purchases").update({
        "payment_reference": intent.reference,
        "payment_provider": intent.provider,
    }).eq("id", purchase["id"]).execute()

    if intent.auto_confirm:
        # Mock gateway only. Runs the SAME confirmation the real webhook
        # runs, server-side, the client is never trusted to say "paid".
        result = _confirm_paid(intent.reference)
        confirmed = bool(result.get("matched"))
        return {
            "purchase_id": purchase["id"],
            "status": PAID if confirmed else "pending",
            "provider": intent.provider,
            "is_mock": True,
            "redirect_url": None,
        }

    return {
        "purchase_id": purchase["id"],
        "status": "pending",
        "provider": intent.provider,
        "is_mock": False,
        "redirect_url": intent.redirect_url,
    }


def _fail_purchase(purchase_id: str, reason: str) -> None:
    logger.error(f"❌ LinkedIn purchase {purchase_id} could not start a payment: {reason}")
    try:
        get_admin_client().table("linkedin_purchases").update(
            {"payment_status": FAILED}
        ).eq("id", purchase_id).execute()
    except Exception as e:
        logger.error(f"Couldn't mark purchase {purchase_id} failed: {e}")


@router.post("/api/v1/linkedin/payments/webhook", tags=["LinkedIn"])
async def linkedin_payment_webhook(request: Request) -> dict:
    """
    The gateway's own callback, and the ONLY thing that unlocks a generation.

    Not JWT-authenticated (the gateway has no Supabase session), authenticity
    is proven by the gateway's shared secret inside verify_and_parse_webhook,
    which fails closed when that secret isn't configured.

    Always answers 200 for events it understands, including duplicates and
    references that aren't ours (a subscription payment, say), a 4xx/5xx here
    makes providers retry indefinitely. Real problems (bad signature) do get a
    4xx, because those should not be silently accepted.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook body was not JSON.")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook body was not a JSON object.")

    try:
        gateway = get_gateway()
    except GatewayUnavailable:
        # A webhook arriving while no gateway is configured is either a
        # misconfiguration or unsolicited. Don't touch anything.
        logger.warning("Received a payment webhook while PAYMENT_GATEWAY is unset, ignoring.")
        return {"ok": True, "ignored": True}

    headers = {key.lower(): value for key, value in request.headers.items()}

    try:
        event = gateway.verify_and_parse_webhook(headers=headers, payload=payload)
    except WebhookVerificationError as e:
        logger.error(f"🚫 Rejected a payment webhook: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Webhook could not be verified.")

    if event.status == PAID:
        result = _confirm_paid(event.reference)
        if not result.get("matched"):
            # Not a LinkedIn purchase, fine, and not an error.
            logger.info(f"Payment webhook for {event.reference} matched no LinkedIn purchase, ignoring.")
            return {"ok": True, "ignored": True}
        return {"ok": True, "idempotent": bool(result.get("already_paid"))}

    if event.status == FAILED:
        _mark_failed(event.reference)
        return {"ok": True}

    # Still pending (authorized but not captured, etc.), nothing to do yet.
    return {"ok": True, "pending": True}


# ─── ROUTES: GENERATING ─────────────────────────────────────────────────────


@router.post("/api/v1/linkedin/generate", tags=["LinkedIn"])
def linkedin_generate(
    payload: LinkedInGenerateRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Runs the generator for a paid purchase and stores the result.

    Deliberately a plain `def`, not `async def`: the Claude call blocks for
    tens of seconds, and FastAPI runs sync endpoints in a threadpool, so this
    can't stall the event loop for everyone else the way an un-awaited
    blocking call inside an async endpoint would.
    """
    purchase = _fetch_purchase(payload.purchase_id, user_id)

    if purchase.get("payment_status") != PAID:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "purchase_not_paid",
                "message": "This purchase hasn't been paid for yet.",
            },
        )

    # Which CV to build from. Normally the one recorded on the purchase; a
    # replacement is only accepted when that CV has since been deleted (the
    # column goes null), so nobody can pay for one CV and generate from
    # another they don't own, and the replacement is ownership-checked too.
    recorded_cv_id = purchase.get("source_cv_id")
    requested_cv_id = (payload.source_cv_id or "").strip() or None

    if recorded_cv_id:
        if requested_cv_id and requested_cv_id != recorded_cv_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "cv_mismatch",
                    "message": "This purchase is tied to a different CV.",
                },
            )
        source_cv_id = recorded_cv_id
    else:
        if not requested_cv_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "cv_deleted",
                    "message": "The CV this purchase was based on was deleted. Choose another CV to use.",
                },
            )
        source_cv_id = requested_cv_id

    resume = _fetch_resume(source_cv_id, user_id)
    facts_json = _facts_from_resume(resume)

    # The generated profile carries the person's name, and a name is never
    # machine-transliterated here, same rule the CV pipeline enforces (see
    # apply_candidate_names in main.py). LinkedIn output is English, so the
    # English spelling is the one we need, and we ask rather than invent it.
    names = get_profile_names(user_id)
    has_name, field = required_name_for("en", names)
    if not has_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "missing_profile_name",
                "field": field,
                "message": "Add your name in English before generating your LinkedIn profile.",
            },
        )

    admin = get_admin_client()
    existing = _existing_generation(purchase["id"])

    if existing and existing["status"] == "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "already_generated",
                "message": "This purchase has already been used. Open it from your history.",
                "generation_id": existing["id"],
            },
        )

    if existing and existing["status"] == "generating" and not _is_stale(existing):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "generation_in_progress",
                "message": "This profile is already being generated. Give it a moment.",
                "generation_id": existing["id"],
            },
        )

    # Reuse a failed or abandoned row instead of inserting, the
    # one-generation-per-purchase index counts anything not 'failed', so an
    # abandoned 'generating' row has to be reclaimed rather than duplicated.
    if existing:
        generation_id = existing["id"]
        admin.table("linkedin_generations").update(
            {"status": "generating", "generated_content": None, "updated_at": _iso(_now())}
        ).eq("id", generation_id).execute()
    else:
        inserted = (
            admin.table("linkedin_generations")
            .insert({
                "purchase_id": purchase["id"],
                "user_id": user_id,
                "status": "generating",
            })
            .execute()
            .data
            or []
        )
        if not inserted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Couldn't start the generation. Please try again.",
            )
        generation_id = inserted[0]["id"]

    try:
        content = run_linkedin_generator(
            facts_json=facts_json,
            name_en=names.get("name_en") or "",
            source_cv_language=resume.get("cv_language") or "en",
        )
    except LinkedInGenerationError as e:
        _record_generation_failure(generation_id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail={"code": "generation_failed", "message": str(e)})
    except Exception as e:
        logger.error(f"❌ LinkedIn generation crashed for purchase {purchase['id']}: {e}")
        _record_generation_failure(generation_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "generation_failed",
                "message": "Something went wrong generating your profile. Your purchase is still valid, please try again.",
            },
        )

    admin.table("linkedin_generations").update({
        "status": "ready",
        "generated_content": content,
        "updated_at": _iso(_now()),
    }).eq("id", generation_id).execute()

    return {
        "generation_id": generation_id,
        "purchase_id": purchase["id"],
        "tier": purchase["tier"],
        "status": "ready",
        "content": content,
    }


def _record_generation_failure(generation_id: str) -> None:
    """A failed generation must NOT consume the purchase, see the partial
    unique index in 008_linkedin_addon.sql. Recording the failure is what lets
    the buyer retry for free."""
    try:
        get_admin_client().table("linkedin_generations").update(
            {"status": "failed", "updated_at": _iso(_now())}
        ).eq("id", generation_id).execute()
    except Exception as e:
        logger.error(f"Couldn't mark generation {generation_id} failed: {e}")


@router.get("/api/v1/linkedin/generations/{generation_id}", tags=["LinkedIn"])
def get_linkedin_generation(
    generation_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """One past generation's full content, for the caller only. This is what
    makes leaving and coming back non-destructive (§6)."""
    row = (
        get_admin_client()
        .table("linkedin_generations")
        .select("id, purchase_id, user_id, status, generated_content, created_at")
        .eq("id", _require_uuid(generation_id, "Generation"))
        .maybe_single()
        .execute()
        .data
    )
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation not found.")

    purchase = (
        get_admin_client()
        .table("linkedin_purchases")
        .select("id, tier, source_cv_id, created_at")
        .eq("id", row["purchase_id"])
        .maybe_single()
        .execute()
        .data
    ) or {}
    cv = _cv_labels(user_id, [purchase.get("source_cv_id")]).get(purchase.get("source_cv_id") or "")

    return {
        "generation_id": row["id"],
        "purchase_id": row["purchase_id"],
        "status": row["status"],
        "created_at": row["created_at"],
        "tier": purchase.get("tier"),
        "source_cv": cv,
        "content": row.get("generated_content"),
    }


# ─── ROUTES: ADMIN (premium fulfillment queue) ──────────────────────────────


@router.get("/api/v1/admin/linkedin/orders", tags=["Admin"])
def list_premium_orders(
    include_done: bool = Query(False, description="Include orders already marked done."),
    admin_user_id: str = Depends(get_current_admin_user_id),
) -> dict:
    """
    The premium fulfillment queue: every PAID premium order and who to
    contact. Admin-gated server-side on profiles.is_admin like every other
    /api/v1/admin/* route.

    Only paid orders appear, an abandoned checkout isn't work owed.
    """
    admin = get_admin_client()
    query = (
        admin.table("linkedin_purchases")
        .select("id, user_id, tier, source_cv_id, price_paid, currency, contact_phone, "
                "contact_consent, fulfillment_status, fulfilled_at, notified_at, paid_at, created_at")
        .eq("tier", "premium")
        .eq("payment_status", PAID)
        .order("created_at", desc=True)
    )
    if not include_done:
        query = query.in_("fulfillment_status", ["pending", "in_progress"])

    orders = query.execute().data or []
    if not orders:
        return {"orders": [], "pending_count": 0}

    buyers = lookup_buyers([o["user_id"] for o in orders])
    cv_ids = [o.get("source_cv_id") for o in orders if o.get("source_cv_id")]
    cvs = {}
    if cv_ids:
        rows = (
            admin.table("resumes")
            .select("id, role, company, cv_language")
            .in_("id", cv_ids)
            .execute()
            .data
            or []
        )
        cvs = {row["id"]: row for row in rows}

    for order in orders:
        order["buyer"] = buyers.get(order["user_id"], {})
        order["source_cv"] = cvs.get(order.get("source_cv_id") or "")

    return {
        "orders": orders,
        "pending_count": sum(1 for o in orders if o["fulfillment_status"] in ("pending", "in_progress")),
    }


@router.patch("/api/v1/admin/linkedin/orders/{purchase_id}", tags=["Admin"])
def update_premium_order(
    purchase_id: str,
    fulfillment_status: str = Query(..., description="pending | in_progress | done"),
    admin_user_id: str = Depends(get_current_admin_user_id),
) -> dict:
    """Moves a premium order through the queue. The whole of the manual
    workflow, on purpose."""
    allowed = {"pending", "in_progress", "done"}
    if fulfillment_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"fulfillment_status must be one of {sorted(allowed)}.",
        )

    updates = {"fulfillment_status": fulfillment_status}
    updates["fulfilled_at"] = _iso(_now()) if fulfillment_status == "done" else None

    updated = (
        get_admin_client()
        .table("linkedin_purchases")
        .update(updates)
        .eq("id", purchase_id)
        .execute()
        .data
        or []
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return {"order": updated[0]}
