# core/payment_gateway.py
#
# The ONLY module that knows anything about a payment provider.
#
# Why it's separate: the Moyasar application is still pending, so the entire
# purchase flow has to be buildable and testable before the real gateway
# exists. Every gateway-specific detail, creating a payment, verifying a
# webhook's authenticity, reading a status out of a provider's payload,
# lives behind the small interface below, so swapping the mock for Moyasar
# touches this file and nothing in core/linkedin.py.
#
# WHICH GATEWAY IS ACTIVE is decided by the PAYMENT_GATEWAY env var:
#
#   PAYMENT_GATEWAY unset / "disabled"  -> no gateway. Checkout returns 503
#                                          with code payment_gateway_unavailable,
#                                          and the frontend shows its
#                                          "payment coming soon" screen. THIS
#                                          IS THE PRODUCTION DEFAULT until
#                                          Moyasar is live, nobody can buy,
#                                          and nothing can be unlocked for free.
#   PAYMENT_GATEWAY="mock"              -> local/dev only. Payments are
#                                          auto-confirmed SERVER-SIDE through
#                                          the same code path the real webhook
#                                          uses, so the whole feature
#                                          (generation, history, unlocking) is
#                                          testable end to end today.
#   PAYMENT_GATEWAY="moyasar"           -> the real thing, once the keys and
#                                          the confirmed webhook payload shape
#                                          are in place.
#
# Setting "mock" in production would give the paid content away, which is why
# it is opt-in by env var rather than something that falls back on.
import hmac
import os
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from loguru import logger


class GatewayUnavailable(RuntimeError):
    """No usable payment gateway is configured. Callers turn this into a 503
    with a machine-readable code, never a 500, nothing is broken, payments
    just aren't switched on yet."""


class GatewayError(RuntimeError):
    """The configured gateway was reachable but refused or failed the
    operation."""


class WebhookVerificationError(RuntimeError):
    """A webhook request could not be proven to have come from the gateway.
    Always fail closed: an unverified webhook is an unauthenticated request
    to mark something paid."""


# Normalized payment states. Provider-specific status strings are mapped onto
# these so nothing downstream has to know a provider's vocabulary.
PAID = "paid"
FAILED = "failed"
PENDING = "pending"


@dataclass
class PaymentIntent:
    """What a gateway hands back when a payment is created."""

    reference: str
    provider: str
    # Where to send the buyer to actually pay. None for the mock gateway,
    # which has nowhere to send anyone.
    redirect_url: Optional[str] = None
    status: str = PENDING
    # True only for the mock gateway: tells the caller to run its normal
    # server-side confirmation immediately instead of waiting for a webhook
    # that will never arrive. The caller still goes through the same
    # confirm-and-record function the real webhook uses, the mock does not
    # get a shortcut around that logic, or testing it would prove nothing.
    auto_confirm: bool = False


@dataclass
class WebhookEvent:
    """A verified, normalized "something happened to this payment" event."""

    reference: str
    status: str
    amount: Optional[float] = None
    currency: Optional[str] = None
    raw: Optional[dict] = None


# ─── MOCK GATEWAY ───────────────────────────────────────────────────────────


class MockGateway:
    name = "mock"

    def create_payment(self, *, amount: float, currency: str, description: str,
                       reference_hint: str, callback_url: str | None = None) -> PaymentIntent:
        reference = f"mock_{uuid.uuid4().hex}"
        logger.warning(
            f"🧪 MOCK PAYMENT: {amount} {currency} for '{description}' auto-approved as {reference}. "
            "This must never be enabled in production (PAYMENT_GATEWAY=mock)."
        )
        return PaymentIntent(
            reference=reference,
            provider=self.name,
            redirect_url=None,
            status=PENDING,
            auto_confirm=True,
        )

    def verify_and_parse_webhook(self, *, headers: dict, payload: dict) -> WebhookEvent:
        """The mock gateway accepts a hand-made webhook so the idempotency
        path can be exercised (e.g. posting the same event twice) without a
        real provider. Only ever reachable when PAYMENT_GATEWAY=mock."""
        reference = str(payload.get("reference") or payload.get("id") or "").strip()
        if not reference:
            raise WebhookVerificationError("Mock webhook is missing a payment reference.")
        status = str(payload.get("status") or PAID).lower()
        return WebhookEvent(
            reference=reference,
            status=PAID if status in ("paid", "succeeded", "captured") else FAILED if status == "failed" else PENDING,
            amount=payload.get("amount"),
            currency=payload.get("currency"),
            raw=payload,
        )


# ─── MOYASAR ────────────────────────────────────────────────────────────────
#
# NOT FINISHED, ON PURPOSE. Moyasar hasn't replied to the application yet, so
# their exact webhook payload and the fields inside it are unconfirmed.
# Everything that depends on that is isolated in the two maps below and in
# the one HTTP call in create_payment, each marked CONFIRM WITH MOYASAR.
# Nothing outside this class needs to change when those are filled in.


class MoyasarGateway:
    name = "moyasar"

    API_BASE = "https://api.moyasar.com/v1"

    # CONFIRM WITH MOYASAR: where the payment id and status live in the
    # webhook body. Keeping them as paths (not inline lookups) means the whole
    # integration adapts by editing these two lines.
    WEBHOOK_REFERENCE_PATH = ("data", "id")
    WEBHOOK_STATUS_PATH = ("data", "status")
    # CONFIRM WITH MOYASAR: their status vocabulary. "paid" and "failed" are
    # what their payment object documents today; anything unrecognized is
    # treated as still pending, which is the safe direction (nothing gets
    # unlocked).
    STATUS_MAP = {
        "paid": PAID,
        "captured": PAID,
        "authorized": PENDING,
        "initiated": PENDING,
        "failed": FAILED,
        "voided": FAILED,
        "refunded": FAILED,
    }

    def __init__(self, secret_key: str, webhook_secret: str):
        self._secret_key = secret_key
        self._webhook_secret = webhook_secret

    def create_payment(self, *, amount: float, currency: str, description: str,
                       reference_hint: str, callback_url: str | None = None) -> PaymentIntent:
        # CONFIRM WITH MOYASAR: whether this feature uses their hosted
        # invoice flow (POST /invoices, redirect the buyer to invoice.url) or
        # a client-side tokenized payment. An invoice is the better fit for a
        # one-time add-on, it gives a URL to redirect to and fires a webhook
        # on payment, with no card data ever reaching our servers.
        raise GatewayUnavailable(
            "Moyasar is selected but not implemented yet: the account application is still "
            "pending, so the invoice call and webhook payload shape are unconfirmed. "
            "Set PAYMENT_GATEWAY=mock for local testing, or leave it unset in production."
        )

    def verify_and_parse_webhook(self, *, headers: dict, payload: dict) -> WebhookEvent:
        """
        Proves the request came from Moyasar, then normalizes it.

        Moyasar's webhooks carry a shared secret token that we set when
        registering the endpoint, rather than an HMAC signature over the body.
        Both delivery spots are accepted (header and body field) because
        which one they use is CONFIRM WITH MOYASAR: comparison is constant
        time either way, and a missing/empty configured secret fails closed.
        """
        if not self._webhook_secret:
            raise WebhookVerificationError(
                "MOYASAR_WEBHOOK_SECRET is not set, refusing to trust an unverifiable webhook."
            )

        # CONFIRM WITH MOYASAR: the exact header name / body field.
        presented = (
            headers.get("x-event-secret")
            or headers.get("x-moyasar-secret")
            or payload.get("secret_token")
            or ""
        )
        if not presented or not hmac.compare_digest(str(presented), self._webhook_secret):
            raise WebhookVerificationError("Webhook secret did not match.")

        reference = _dig(payload, self.WEBHOOK_REFERENCE_PATH)
        if not reference:
            raise WebhookVerificationError("Webhook payload had no payment id.")

        raw_status = str(_dig(payload, self.WEBHOOK_STATUS_PATH) or "").lower()
        return WebhookEvent(
            reference=str(reference),
            status=self.STATUS_MAP.get(raw_status, PENDING),
            amount=_dig(payload, ("data", "amount")),
            currency=_dig(payload, ("data", "currency")),
            raw=payload,
        )


def _dig(payload: dict, path: tuple[str, ...]) -> Any:
    """Reads a nested key path, tolerating a flat payload too, some
    providers wrap the object in `data`, some don't."""
    node: Any = payload
    for key in path:
        if not isinstance(node, dict):
            return None
        if key not in node and len(path) > 1:
            # Flat payload: fall back to the last path segment at top level.
            return payload.get(path[-1])
        node = node.get(key)
    return node


# ─── SELECTION ──────────────────────────────────────────────────────────────


def _configured_name() -> str:
    return (os.getenv("PAYMENT_GATEWAY", "") or "").strip().lower()


def get_gateway():
    """The active gateway, or raise GatewayUnavailable.

    Read from the environment on every call rather than cached at import, so
    flipping the flag doesn't need a code change or a specific restart order.
    """
    name = _configured_name()

    if name in ("", "disabled", "off", "none"):
        raise GatewayUnavailable("No payment gateway is configured yet (PAYMENT_GATEWAY is unset).")

    if name == "mock":
        return MockGateway()

    if name == "moyasar":
        secret_key = os.getenv("MOYASAR_SECRET_KEY", "")
        webhook_secret = os.getenv("MOYASAR_WEBHOOK_SECRET", "")
        if not secret_key:
            raise GatewayUnavailable("PAYMENT_GATEWAY=moyasar but MOYASAR_SECRET_KEY is not set.")
        return MoyasarGateway(secret_key=secret_key, webhook_secret=webhook_secret)

    raise GatewayUnavailable(f"PAYMENT_GATEWAY='{name}' is not a gateway this build knows about.")


def gateway_status() -> dict:
    """Small, safe summary for the frontend: is buying possible at all right
    now, and is this a real payment or a mock one. Never exposes keys."""
    try:
        gateway = get_gateway()
    except GatewayUnavailable:
        return {"available": False, "provider": None, "is_mock": False}
    return {
        "available": True,
        "provider": gateway.name,
        "is_mock": gateway.name == MockGateway.name,
    }
