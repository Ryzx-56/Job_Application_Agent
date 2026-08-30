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

## 4. Cross-check the amount before unlocking — NOT IMPLEMENTED

**This is the real gap.** `WebhookEvent` carries `amount` and `currency`, but
`_confirm_paid(event.reference)` takes only the reference. The amount that was
actually paid is never compared with anything.

- [ ] Compare `event.amount` (and currency) against the stored
      `linkedin_purchases.price_paid` before flipping to paid, and refuse the
      unlock on a mismatch rather than logging and continuing.
- [ ] Mind the **unit**: Moyasar quotes amounts in the minor unit (halalas),
      `price_paid` is stored in SAR. A naive `==` will fail 100% of the time.
- [ ] For anything ambiguous, re-fetch the payment from
      `GET /v1/payments/{id}` with the secret key and trust that over the
      webhook body.

This one does **not** depend on Moyasar and could be implemented now against
`price_paid`.

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

- [ ] **`claim_founding_member_slot` has no caller.** The migration that
      created it says the payment webhook should call it on the first
      successful charge. As things stand, switching payments on would award
      Founding Member to nobody, silently. Wire it into the paid path.
      (Note there are two overloads; the 1-arg `claim_founding_member_slot(uuid)`
      is the correct, locked-down one — the 3-arg version is stale and its
      EXECUTE was revoked in the Section 1 hardening.)
- [ ] **Subscriptions have no payment path.** Only the LinkedIn add-on has a
      webhook. `cancel_subscription` carries a TODO to cancel the real
      recurring charge via the stored `payment_subscription_id`; until that is
      wired, a cancellation stops access at the cycle boundary but would not
      stop a real charge.
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
