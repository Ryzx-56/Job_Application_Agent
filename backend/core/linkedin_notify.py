# core/linkedin_notify.py
#
# Premium-tier fulfillment alerts (§7). Premium is a MANUAL service, a human
# on our team builds the buyer's LinkedIn profile, so the whole automated
# part of it is: tell us a premium order came in, with everything needed to
# start work.
#
# Two channels, deliberately both:
#   1. The admin dashboard queue. That's just linkedin_purchases rows with
#      fulfillment_status in ('pending','in_progress'), see
#      /api/v1/admin/linkedin/orders in core/linkedin.py. It cannot be missed
#      or lost, and it survives a failed email.
#   2. An email, sent directly from this backend via Resend. Self-contained
#      here rather than routed through the Supabase send-email edge function,
#      which is an auth hook for signup/recovery mail and has no business
#      knowing about orders.
#
# NOT A TICKETING SYSTEM, on purpose. A list, a "mark done" button, and an
# email. Anything more is unbuilt until the volume justifies it.
#
# NOTHING HERE MAY RAISE INTO A REQUEST. A purchase that is paid for is paid
# for whether or not we managed to send ourselves an email about it, so every
# path logs and returns instead of failing the checkout.
import os

import requests
from loguru import logger

from core.credits import get_admin_client

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Same default sender the Supabase auth-email function uses, so order alerts
# come from the domain that's already verified with Resend.
DEFAULT_FROM = "Tarshih <noreply@tarshih.com>"
DEFAULT_TO = "support@tarshih.com"

_TIMEOUT_SECONDS = 10


def _config() -> tuple[str, str, str]:
    return (
        os.getenv("RESEND_API_KEY", "").strip(),
        os.getenv("EMAIL_FROM", DEFAULT_FROM).strip() or DEFAULT_FROM,
        os.getenv("LINKEDIN_ORDER_ALERT_TO", DEFAULT_TO).strip() or DEFAULT_TO,
    )


def lookup_buyers(user_ids: list[str]) -> dict[str, dict]:
    """
    Buyers' emails and names, keyed by user id, for the order alert and for
    the admin fulfillment queue.

    Emails live in auth.users, which PostgREST can't select from directly, so
    this goes through the existing admin_users_by_ids SECURITY DEFINER
    function (003_admin_access.sql) that core/documents.py already uses for
    exactly this reason. Batched in one call so a queue of orders doesn't do
    one round trip per row.

    Never raises: an order whose buyer name we couldn't resolve still has to
    reach us, with the ids that are on the row itself.
    """
    ids = sorted({uid for uid in user_ids if uid})
    if not ids:
        return {}

    try:
        rows = get_admin_client().rpc("admin_users_by_ids", {"ids": ids}).execute().data or []
    except Exception as e:
        logger.warning(f"Couldn't resolve buyer details for a LinkedIn order ({len(ids)} id(s)): {e}")
        return {}

    return {
        row["id"]: {
            "email": row.get("email"),
            "name_en": row.get("name_en"),
            "name_ar": row.get("name_ar"),
        }
        for row in rows
        if row.get("id")
    }


def lookup_buyer(user_id: str) -> dict:
    """Single-buyer convenience wrapper around lookup_buyers."""
    return lookup_buyers([user_id]).get(user_id, {"email": None, "name_en": None, "name_ar": None})


def _order_lines(order: dict) -> list[tuple[str, str]]:
    buyer = order.get("buyer") or {}
    name = buyer.get("name_en") or buyer.get("name_ar") or "(no name on file)"
    cv = order.get("source_cv") or {}
    cv_label = " · ".join(part for part in [cv.get("role"), cv.get("company")] if part) or "(CV details unavailable)"

    return [
        ("Buyer", name),
        ("Email", buyer.get("email") or "(unknown)"),
        ("Phone", order.get("contact_phone") or "(not provided)"),
        ("Contact consent", "Yes" if order.get("contact_consent") else "NO, do not call"),
        ("Chosen CV", cv_label),
        ("CV id", cv.get("id") or order.get("source_cv_id") or "(none)"),
        ("Amount", f"{order.get('price_paid')} {order.get('currency') or 'SAR'}"),
        ("Purchase id", order.get("id") or ""),
        ("Payment reference", order.get("payment_reference") or ""),
    ]


def _order_ref(order: dict) -> str:
    """
    A safe way to name an order in a log line.

    Deliberately NOT the buyer. The two call sites below used to append
    _plain_text(order), which writes the buyer's NAME, EMAIL AND PHONE into
    the logs in plaintext on every send failure. The order is already in the
    database and in the admin queue either way, so a log line needs an
    identifier to look it up with, not the customer's contact details.
    """
    return str(order.get("id") or order.get("payment_reference") or "unknown")


def _plain_text(order: dict) -> str:
    lines = [f"{label}: {value}" for label, value in _order_lines(order)]
    return (
        "New PREMIUM LinkedIn order. A specialist profile build is owed.\n\n"
        + "\n".join(lines)
        + "\n\nMark it done in the admin panel: https://tarshih.com/dashboard/admin\n"
    )


def _html(order: dict) -> str:
    rows = "".join(
        f'<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;white-space:nowrap">{label}</td>'
        f'<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:500">{value}</td></tr>'
        for label, value in _order_lines(order)
    )
    return (
        '<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px">'
        '<p style="font-size:15px;color:#0f172a;margin:0 0 4px">'
        "<strong>New premium LinkedIn order.</strong></p>"
        '<p style="font-size:13px;color:#64748b;margin:0 0 16px">'
        "This tier is fulfilled by hand. Contact the buyer and build their profile.</p>"
        f'<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">{rows}</table>'
        '<p style="font-size:13px;color:#64748b;margin:20px 0 0">'
        '<a href="https://tarshih.com/dashboard/admin" style="color:#0A66C2">Open the admin panel</a>'
        " to mark it fulfilled.</p></div>"
    )


def send_premium_order_alert(order: dict) -> bool:
    """
    Emails the premium-order alert. Returns True only if Resend accepted it.

    A missing RESEND_API_KEY is a normal, expected state (the key gets added
    to the backend environment separately), it logs the full order at WARNING
    level so the order is still recoverable from the logs, and returns False.
    The admin dashboard queue is unaffected either way.
    """
    api_key, sender, recipient = _config()

    if not api_key:
        logger.warning(
            "📭 RESEND_API_KEY is not set, so no premium-order email was sent. "
            f"Order details (also in the admin queue):\n{_plain_text(order)}"
        )
        return False

    try:
        response = requests.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": sender,
                "to": [recipient],
                "subject": f"Premium LinkedIn order: {(order.get('buyer') or {}).get('email') or 'new buyer'}",
                "text": _plain_text(order),
                "html": _html(order),
            },
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.error(f"❌ Premium-order email failed to send for purchase {_order_ref(order)}: {e}")
        return False

    if response.status_code >= 300:
        logger.error(
            f"❌ Resend rejected the premium-order email for purchase "
            f"{_order_ref(order)} ({response.status_code}): {response.text}"
        )
        return False

    logger.info(f"📧 Premium LinkedIn order alert sent to {recipient} for purchase {order.get('id')}.")
    return True
