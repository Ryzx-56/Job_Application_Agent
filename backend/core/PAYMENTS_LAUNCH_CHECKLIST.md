# Moyasar webhook — pre-launch checklist

Audited 2026-08-30 against the code that exists today (`core/payment_gateway.py`,
the webhook route in `core/linkedin.py`). Payments are **not live**: the
production default leaves `PAYMENT_GATEWAY` unset, so nobody can buy and
nothing can be unlocked. Work through this when the Moyasar account is
approved and the integration is actually being wired up.

Scope note: the **only** payment flow that exists is the LinkedIn add-on.
Pro/Elite subscriptions have no payment path at all.

---

## 1. Verify the signature before trusting the payload — mostly ready

**Done.** `MoyasarGateway.verify_and_parse_webhook` fails closed when
`MOYASAR_WEBHOOK_SECRET` is unset, compares with `hmac.compare_digest`
(constant time), and the route turns a `WebhookVerificationError` into a 401
rather than silently continuing.

**To confirm at wiring time:**

- [ ] The exact header name Moyasar sends. The code currently tries
      `x-event-secret`, then `x-moyasar-secret`, then a `secret_token` body
      field. Once confirmed, **narrow it to the one real location** — accepting
      three is a wider surface than needed, and accepting the secret from the
      request *body* is weaker than requiring it in a header.
- [ ] Whether Moyasar uses a **shared secret token** (what this code assumes)
      or an **HMAC signature over the raw body**. If it is HMAC, see item 2 —
      that changes the route, not just a constant.

## 2. Raw body available before any JSON parsing — not needed yet, not wired

**Currently fine.** The route calls `await request.json()`, and the only
middleware installed is CORS, so nothing consumes the body first —
`await request.body()` is still reachable if it becomes necessary.

**The likely rework.** If Moyasar signs an HMAC over the raw bytes, the
current shape cannot verify it: `request.json()` discards the exact bytes, and
re-serialising the parsed dict will not reproduce them (key order, whitespace,
unicode escaping). In that case:

- [ ] Change the route to `raw = await request.body()` and parse with
      `json.loads(raw)`.
- [ ] Extend `verify_and_parse_webhook(...)` to take the raw bytes, and
      compute the HMAC over `raw`, never over a re-serialised dict.
- [ ] Do **not** add any body-parsing middleware in front of this route.

## 3. Idempotency — done, and correctly

**Done.** `_confirm_paid` returns early when the purchase is already `paid`,
and the update is conditional on `.eq("payment_status", "pending")`. That makes
a duplicate delivery safe under *simultaneous* deliveries, not merely likely:
exactly one of two concurrent webhooks updates a row.

**Gap to close at wiring time:**

- [ ] Idempotency is keyed on the **purchase row's state**, not on processed
      event IDs. That covers a repeated "paid" delivery for one purchase; it
      does not dedupe distinct event types or detect an old event replayed
      after the row has moved on.
- [ ] `public.payment_events` exists for exactly this and **is never written
      to** — no code writes a row (`admin_stats.py` only reads it, which is why
      the revenue panel reports zero). Write a row per verified event, keyed on
      the provider's event id with a unique constraint, and treat an insert
      conflict as "already processed".

## 4. Cross-check the amount before unlocking — DONE (2026-08-30)

`_confirm_paid` now takes `paid_amount` / `paid_currency` and verifies both
against the purchase's stored `price_paid` and `currency` **before** the row is
touched, so a mismatch leaves the purchase pending rather than paid-then-
corrected. The webhook passes the verified event through; a mismatch returns
200 (the delivery was authentic, so the provider must not retry) and logs at
ERROR.

`MoyasarGateway._to_major_units` converts halalas to SAR inside the gateway,
so the provider's minor-unit convention never leaks past that class. Verified:
underpaying, a raw `4900` leaking through unconverted, and a wrong currency are
all refused; a half-halala rounding difference is tolerated.

`paid_amount=None` skips the check and logs a WARNING naming itself — the mock
gateway's auto-confirm path has no amount to check.

**Still to confirm at wiring time:**

- [ ] That Moyasar's webhooks quote the same minor unit as their payment
      object. If a currency with a different exponent is ever accepted,
      `_to_major_units` needs the currency's exponent rather than a hardcoded
      100.
- [ ] For anything ambiguous, re-fetch from `GET /v1/payments/{id}` with the
      secret key and trust that over the webhook body.

## 5. Logging so a failed or replayed webhook is visible — partly done

**Done.** Rejections log at ERROR with the reason, duplicates and unmatched
references log at INFO, and every mock payment logs a WARNING naming itself.

**Gap:**

- [ ] There is no persistent audit trail. Today a replayed or rejected webhook
      exists only in Render's logs, which rotate. The `payment_events` ledger
      from item 3 is the fix for both problems at once — write every verified
      event, including ones that changed nothing.

---

## Found during the audit, not in the original brief

- **`claim_founding_member_slot` now has a caller** (2026-08-30).
      `core/subscription.py::activate_paid_subscription()` is the single
      function a subscription payment webhook must call: it sets the tier,
      clears any scheduled downgrade, records the provider ids, and claims the
      founding slot. Claiming happens there rather than at a separate call site
      precisely so the badge cannot be forgotten independently of the thing
      that earns it. It uses the 1-arg `claim_founding_member_slot(uuid)` —
      the correct, locked-down overload; the 3-arg version is stale and had its
      EXECUTE revoked in the Section 1 hardening.
      - [ ] **Nothing calls it yet**, because no subscription payment flow
            exists. Wiring the webhook to this one function is the remaining
            step.
- **Provider-side cancellation is now wired** (2026-08-30).
      `cancel_subscription` calls `gateway.cancel_subscription()` when the
      profile has a `payment_subscription_id`, and raises **before** scheduling
      the downgrade if that call fails — so nobody is told their subscription
      is cancelled while the card is still being charged. Inert today (no
      provider issues a subscription id yet), so behaviour is unchanged until
      one does.
      - [ ] `MoyasarGateway.cancel_subscription` raises `GatewayUnavailable`
            until their subscription endpoint is confirmed. Fill it in.
- [ ] **Harden the `mock` gateway against production.** `PAYMENT_GATEWAY=mock`
      auto-confirms payments server-side and would give the paid content away.
      It is opt-in and logs a warning, which is good, but consider refusing to
      construct `MockGateway` when a production marker is present, so it cannot
      be enabled by a stray env var.

## Already correct — do not "fix" these

- Production default (`PAYMENT_GATEWAY` unset) means checkout returns 503 and
  the frontend shows its "coming soon" screen. Nobody can buy, nothing unlocks.
- `MoyasarGateway.create_payment` deliberately raises `GatewayUnavailable`
  rather than half-working.
- The webhook answers 200 for events it understands but does not act on
  (duplicates, references that aren't ours). A 4xx/5xx there would make the
  provider retry indefinitely.
- Unknown provider statuses map to `PENDING`, so an unrecognised status never
  unlocks anything.
