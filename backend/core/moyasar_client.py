# core/moyasar_client.py
#
# The raw HTTP transport for Moyasar's REST API. Nothing more.
#
# LAYERING — read this before adding anything here:
#
#   core/moyasar_client.py   (this file)  speaks HTTP. Auth, timeouts, JSON,
#                                         turning a non-2xx into a typed
#                                         exception. Knows Moyasar's endpoint
#                                         names and nothing about Tarshih.
#   core/payment_gateway.py               speaks *our* vocabulary. Normalizes
#                                         a provider's status strings onto
#                                         PAID/FAILED/PENDING, verifies
#                                         webhooks, and is what the rest of
#                                         the app imports.
#
# So: no credit granting, no Supabase, no pricing, no tier logic in this file.
# If a function here needs to know what a "starter pack" is, it belongs a
# layer up.
#
# AUTH is HTTP Basic with the SECRET key as the username and an EMPTY
# password (confirmed against https://docs.moyasar.com/api/authentication).
# `requests` builds the base64 header from the (user, pass) tuple, so the key
# never appears in anything we format ourselves.
#
# MONEY IS ALWAYS AN INTEGER OF HALALAS here — 100 to the riyal, Moyasar's
# own convention. Never a float, never SAR. The conversion to major units for
# display happens in payment_gateway.py, deliberately not here.
import os
import uuid
from typing import Any, Optional

import requests
from loguru import logger

DEFAULT_API_BASE = "https://api.moyasar.com/v1"

# Moyasar's own guidance is that a card charge can take a while to come back
# through the acquirer. Long enough not to abandon a live charge early, short
# enough that a hung request can't pin a worker on Render's free tier.
_TIMEOUT_SECONDS = 30

# Read-only calls have nothing to lose by giving up sooner.
_READ_TIMEOUT_SECONDS = 15


class MoyasarConfigError(RuntimeError):
    """A required Moyasar env var is missing or malformed. A configuration
    problem, not a payment problem — nothing was sent."""


class MoyasarError(RuntimeError):
    """Moyasar answered, and the answer was a refusal.

    `status_code` is the HTTP status, `payload` the decoded body when there
    was one. A definite outcome: the request was received and rejected, so
    retrying the same call verbatim is safe only if the caller knows why.
    """

    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class MoyasarUnreachable(RuntimeError):
    """We never got an answer — timeout, DNS, connection reset.

    THE OUTCOME IS UNKNOWN, NOT FAILED. A charge may well have gone through
    on Moyasar's side. Callers must resolve this by re-reading state with
    get_payment(), never by re-sending the charge. See §8 of the billing
    brief: treating this as a failure is how you double-charge someone.
    """


def _secret_key() -> str:
    """Read at call time, not import time — same reason get_gateway() does:
    flipping an env var shouldn't depend on module import order."""
    key = (os.getenv("MOYASAR_SECRET_KEY", "") or "").strip()
    if not key:
        raise MoyasarConfigError(
            "MOYASAR_SECRET_KEY is not set. Get it from the Moyasar dashboard "
            "(Settings → API Keys) — the sk_ one, never the pk_ one."
        )
    return key


def publishable_key() -> str:
    """The pk_ key. Public by design (it is compiled into the browser bundle
    as NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY); this copy exists so the backend
    can report the mode it thinks it is in without the frontend being the
    only source of truth."""
    return (os.getenv("MOYASAR_PUBLISHABLE_KEY", "") or "").strip()


def webhook_secret() -> str:
    """The shared secret Moyasar echoes back in the webhook body's
    `secret_token` field. Empty means webhooks cannot be verified, and the
    verifier must fail closed rather than trust an unsigned request."""
    return (os.getenv("MOYASAR_WEBHOOK_SECRET", "") or "").strip()


def api_base() -> str:
    return (os.getenv("MOYASAR_API_BASE", "") or DEFAULT_API_BASE).strip().rstrip("/")


def mode() -> str:
    """"test", "live", or "unknown".

    MOYASAR_MODE wins if explicitly set; otherwise it is inferred from the
    secret key's prefix, which is the thing that actually decides whether
    real money moves. Explicit-then-inferred (rather than inferred only) so
    the value can be asserted in a deployment where the key is injected by a
    secret manager and never read by a human.

    Used for the go-live check in §10 and for making it obvious in logs which
    set of keys a running instance is holding.
    """
    declared = (os.getenv("MOYASAR_MODE", "") or "").strip().lower()
    if declared in ("test", "live"):
        return declared

    key = (os.getenv("MOYASAR_SECRET_KEY", "") or "").strip()
    if key.startswith("sk_test_"):
        return "test"
    if key.startswith("sk_live_"):
        return "live"
    return "unknown"


def is_live() -> bool:
    """True only when we are certain real money is in play. "unknown" is not
    live — an unrecognised key should not unlock live-only behaviour."""
    return mode() == "live"


def config_status() -> dict:
    """Whether this instance *could* talk to Moyasar, and in which mode.
    Safe to log and safe to return to an admin endpoint: booleans and a mode
    string, never a key or a fragment of one."""
    return {
        "secret_key_set": bool((os.getenv("MOYASAR_SECRET_KEY", "") or "").strip()),
        "publishable_key_set": bool(publishable_key()),
        "webhook_secret_set": bool(webhook_secret()),
        "api_base": api_base(),
        "mode": mode(),
    }


def _request(
    method: str,
    path: str,
    *,
    data: Optional[dict] = None,
    timeout: int = _TIMEOUT_SECONDS,
) -> dict:
    """
    One place where an HTTP call to Moyasar actually happens.

    Sends form-encoded rather than JSON: Moyasar's API accepts both, and
    form encoding is what their own examples use, which matters for nested
    keys like source[type] where their JSON handling of `metadata` and
    `source` has fewer worked examples to check against.

    Never logs the request body — it can carry a token id, and on the
    create_token path it would carry card data.
    """
    url = f"{api_base()}{path}"
    try:
        response = requests.request(
            method,
            url,
            auth=(_secret_key(), ""),  # empty password is required, not an oversight
            data=data or {},
            timeout=timeout,
        )
    except requests.exceptions.RequestException as e:
        # No response at all. Deliberately a different exception type from
        # MoyasarError so callers cannot accidentally treat it as "declined".
        logger.error(f"❌ Moyasar unreachable on {method} {path}: {type(e).__name__}: {e}")
        raise MoyasarUnreachable(
            f"No response from Moyasar for {method} {path}. The outcome is unknown — "
            "re-read the payment's status instead of retrying the call."
        ) from e

    try:
        body = response.json()
    except ValueError:
        body = None

    if response.status_code >= 400:
        # Moyasar returns {"type": ..., "message": ..., "errors": {...}}.
        message = ""
        if isinstance(body, dict):
            message = str(body.get("message") or body.get("type") or "")
        message = message or f"HTTP {response.status_code}"
        logger.error(f"❌ Moyasar refused {method} {path}: {response.status_code} — {message}")
        raise MoyasarError(
            f"Moyasar rejected {method} {path}: {message}",
            status_code=response.status_code,
            payload=body,
        )

    if not isinstance(body, dict):
        raise MoyasarError(
            f"Moyasar returned a non-object body for {method} {path}.",
            status_code=response.status_code,
            payload=body,
        )
    return body


def _flatten(prefix: str, values: dict) -> dict:
    """`{"user_id": "u1"}` -> `{"metadata[user_id]": "u1"}`. Moyasar's
    form encoding for nested objects; one level is all their API takes."""
    return {f"{prefix}[{k}]": str(v) for k, v in values.items() if v is not None}


def _validate_amount(amount: Any) -> int:
    """Halalas, positive, integral. A float here is the bug this catches:
    29.00 SAR silently sent as 29 halalas is a 29-halala charge, and the
    customer is billed 0.29 SAR for a 29 SAR plan."""
    if isinstance(amount, bool) or not isinstance(amount, int):
        raise MoyasarConfigError(
            f"amount must be an int of halalas, got {type(amount).__name__} ({amount!r}). "
            "2900 means 29.00 SAR."
        )
    if amount <= 0:
        raise MoyasarConfigError(f"amount must be positive, got {amount}.")
    return amount


# ─── PAYMENTS ───────────────────────────────────────────────────────────────


def create_payment(
    *,
    amount: int,
    currency: str = "SAR",
    description: str,
    source: dict,
    callback_url: str | None = None,
    metadata: dict | None = None,
    given_id: str | None = None,
) -> dict:
    """
    POST /payments — charge a source (a card, or a saved token).

    `source` is passed through as-is so this function doesn't need updating
    for a source type it has never heard of. For a saved card that is
    `{"type": "token", "token": "token_..."}`; charge_token() below wraps
    that case, which is the only one this backend uses server-side.

    `given_id` is Moyasar's own idempotency key (a UUID). Supplying it means
    a retried create cannot become a second charge. One is generated when the
    caller doesn't supply one, so the *transport* is always idempotent even
    when the caller forgot to think about it — but a caller that wants
    retry-safety across process restarts must pass a stable id of its own,
    since a generated one dies with the call.
    """
    payload: dict[str, Any] = {
        "amount": _validate_amount(amount),
        "currency": currency,
        "description": description,
        "given_id": given_id or str(uuid.uuid4()),
    }
    if callback_url:
        payload["callback_url"] = callback_url
    payload.update(_flatten("source", source))
    if metadata:
        payload.update(_flatten("metadata", metadata))

    payment = _request("POST", "/payments", data=payload)
    logger.info(
        f"💳 Moyasar payment {payment.get('id')} created ({mode()} mode): "
        f"{amount} halalas {currency}, status={payment.get('status')}."
    )
    return payment


def get_payment(payment_id: str) -> dict:
    """
    GET /payments/{id} — the authoritative state of a payment.

    This is the call that resolves every ambiguity in this integration: a
    webhook body we're unsure of, a timeout mid-charge, a callback URL a user
    could have hand-edited. Moyasar's answer here outranks anything the
    client or a webhook body claims.
    """
    return _request("GET", f"/payments/{payment_id}", timeout=_READ_TIMEOUT_SECONDS)


def charge_token(
    token_id: str,
    amount: int,
    currency: str = "SAR",
    description: str = "",
    *,
    metadata: dict | None = None,
    given_id: str | None = None,
    three_ds: bool = False,
) -> dict:
    """
    Charge a previously saved card. The recurring-billing primitive: this is
    what the renewal job calls once a month.

    3DS defaults to False because a token was already verified when it was
    saved, and a renewal happens with nobody sitting at a browser to complete
    a challenge — forcing 3DS on an unattended charge guarantees it fails.

    Pass a stable `given_id` (e.g. one derived from subscription id + billing
    period) so that a job that crashes mid-charge and re-runs cannot bill the
    same period twice.
    """
    source: dict[str, Any] = {"type": "token", "token": token_id}
    if three_ds:
        source["3ds"] = "true"
    return create_payment(
        amount=amount,
        currency=currency,
        description=description,
        source=source,
        metadata=metadata,
        given_id=given_id,
    )


# ─── TOKENS ─────────────────────────────────────────────────────────────────


def create_token(*, name: str, number: str, cvc: str, month: str, year: str,
                 save_only: bool = False) -> dict:
    """
    POST /tokens — turn a card into a reusable token.

    ⚠️ CARD DATA MUST NOT REACH THIS BACKEND IN NORMAL OPERATION. Moyasar's
    own guidance is that tokens are created from the browser, straight to
    their API with the publishable key, so a PAN never touches our servers
    and this service stays out of PCI scope. The subscribe flow therefore
    saves a card via the hosted form's `credit_card.save_card` option and
    reads the token id out of the payment response — it does not call this.

    This wrapper exists for completeness and for scripted testing against
    Moyasar's published test cards. If you find production code calling it,
    that is the bug.
    """
    logger.warning(
        "⚠️ create_token() called server-side — card data should be tokenized in the "
        "browser with the publishable key, never sent through this backend."
    )
    payload = {
        "name": name,
        "number": number,
        "cvc": cvc,
        "month": month,
        "year": year,
        "save_only": "true" if save_only else "false",
    }
    return _request("POST", "/tokens", data=payload)


def get_token(token_id: str) -> dict:
    """
    GET /tokens/{id} — a token's current state.

    Statuses are `initiated` (created, not usable yet), `active` (chargeable)
    and `inactive` (not chargeable). Only `active` can be billed, so the
    renewal job checks this rather than assuming a token it stored months ago
    is still good.
    """
    return _request("GET", f"/tokens/{token_id}", timeout=_READ_TIMEOUT_SECONDS)


# ─── WEBHOOKS ───────────────────────────────────────────────────────────────


def create_webhook(
    url: str,
    *,
    shared_secret: str | None = None,
    events: list[str] | None = None,
    http_method: str = "post",
) -> dict:
    """
    POST /webhooks — register an endpoint with Moyasar.

    NOT CALLED AT RUNTIME. Registering a webhook is a one-time act per mode
    (once for test keys, once again for live), and the dashboard is the
    normal way to do it. This exists so it can be done reproducibly from a
    script instead of by hand, and so the registration is reviewable in git.

    Defaults to the two events this integration actually acts on. Passing an
    empty list is NOT the same as passing None: Moyasar treats an omitted
    `events` key as "subscribe to everything, including events added in
    future", which would mean this backend receives event types it has never
    been tested against.
    """
    secret = shared_secret or webhook_secret()
    if not secret:
        raise MoyasarConfigError(
            "Refusing to register a webhook with no shared secret — the receiver "
            "authenticates on it, so an empty one means an open endpoint."
        )
    payload: dict[str, Any] = {
        "url": url,
        "shared_secret": secret,
        "http_method": http_method,
    }
    for event in (events if events is not None else ["payment_paid", "payment_failed"]):
        payload.setdefault("events[]", [])
        payload["events[]"].append(event)

    created = _request("POST", "/webhooks", data=payload)
    logger.info(f"🔔 Registered Moyasar webhook {created.get('id')} -> {url} ({mode()} mode).")
    return created
