# Moyasar — go-live checklist

**Rewritten 2026-09-09.** The previous version was audited on 2026-08-30 and
described a codebase that no longer exists: it said the only payment flow was
the LinkedIn add-on, that Pro/Elite subscriptions had no payment path, and that
`core/payment_gateway.py` was the interface. All three are now wrong —
sections 4 through 10 of the billing brief shipped in commits `036c4d2`,
`650d5aa`, `d05f0e7`, `96fd220`, `0ee59ff` and `b99bdc6`, and
`payment_gateway.py` and the mock gateway were retired in `5933c03`.

---

## What decides whether real money moves

**The prefix on `MOYASAR_SECRET_KEY`. Nothing else.**

`sk_test_` → test mode. `sk_live_` → live. There is no `PAYMENT_GATEWAY`
variable any more (nothing reads it), and there is no mock gateway that could
be left switched on by accident. `MOYASAR_MODE` is optional and only *asserts*
the expectation — a mismatch between it and the key prefix is reported at
startup as "the wrong key set is deployed".

## What exists

| Flow | Endpoint | State |
|---|---|---|
| Price list | `GET /api/v1/payments/catalog` | served from `core/pricing.py`, the module that also enforces the amount |
| Post-payment verify | `POST /api/v1/payments/verify/{id}` | UX only. Re-fetches from Moyasar; never trusts the query string |
| **Webhook** | **`POST /api/v1/webhooks/moyasar`** | shared-secret in body, constant-time compare, fails closed |
| Renewal job | `POST /api/v1/billing/run-renewals` | `CRON_SECRET`-gated; 503 without it |
| Saved card | `GET` / `DELETE /api/v1/payments/card` | |
| Admin refunds | `GET /api/v1/admin/payments`, `POST .../{id}/refund` | |

**Credit packs are safe to sell.** The defect that wiped purchased credits at
the monthly reset (`credits_remaining = v_new_total`) was fixed by
`20260901230500_purchased_credits_survive_reset.sql`.

**Renewals no longer grant credits for months that were not paid for.**
`reset_credits_if_due()` used to grant a paid tier's allowance off a timestamp
with no reference to billing, so a subscriber with a dead card kept receiving
credits through dunning and beyond. Fixed by
`20260909190000_reset_credits_requires_paid_billing.sql`: paid tiers are
granted by `apply_monthly_allowance()` on a *charged* renewal, and
`reset_credits_if_due()` now refills the free tier only.

---

## Go live

Do these in order. Step 5 is the one that catches the mistakes.

1. **Moyasar Dashboard → switch to Live.** Copy the live `sk_` and `pk_` keys.
2. **Render** (backend):
   - `MOYASAR_SECRET_KEY=sk_live_…`
   - `MOYASAR_PUBLISHABLE_KEY=pk_live_…`
   - `MOYASAR_MODE=live`
   - `MOYASAR_WEBHOOK_SECRET=…` — **the LIVE webhook's secret.** It is a
     different value from the test webhook's, and reusing the test one makes
     every live webhook 403 *while payments keep succeeding*: buyers charged,
     nobody credited.
   - `PUBLIC_APP_URL=https://tarshih.com`
   - `CRON_SECRET=…` — must match the repo secret used by
     `.github/workflows/billing-renewals.yml`, or no subscription ever renews
     (silently — the endpoint just 503s).
3. **Vercel** (frontend): `NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY=pk_live_…`
4. **Moyasar Dashboard → Webhooks →** add
   `https://<render-host>/api/v1/webhooks/moyasar`, with the secret from
   step 2. Subscribe to the payment events (`payment_paid` at minimum).
5. **Redeploy both, then read the Render log for one line:**

   ```
   💳 Payments: LIVE — real money | publishable_key_set=True webhook_secret_set=True api_base=https://api.moyasar.com/v1
   ```

   Any `🚨 Payment configuration problem:` line beside it names exactly what is
   wrong. `core/moyasar_client.config_problems()` checks: mismatched
   test/live key pairs, live keys with no webhook secret, an asserted
   `MOYASAR_MODE` that contradicts the key, and a non-https return URL.
   All four are otherwise silent until a customer is out of pocket.
6. **Take one real payment** with a real card — the smallest pack (Starter,
   9 SAR) is the cheapest test. Confirm: credits appear, a `payments` row is
   written, and the webhook shows 200 in the Moyasar dashboard.
7. **Refund it** from `/dashboard/admin/payments`, and confirm the refund
   lands and the credits are clawed back.
8. **Then** subscribe to Pro with a real card and confirm the card is saved
   (`GET /api/v1/payments/card`) — without a saved card the renewal job has
   nothing to charge next month.

## Before the first real payment

- [ ] **Take a manual Supabase backup.** The Free plan has no point-in-time
      restore and migrations apply on push to `main` with no approval gate.
- [ ] Confirm the Saudi freelance document (وثيقة العمل الحر) is in place —
      required for full monetization, and outside the code entirely.
- [ ] Decide what a **credit-pack buyer** is entitled to. Gating reads
      `profiles.tier`, and buying a pack does not change it — a Power pack
      buyer is still `tier = 'free'` and is locked out of Job Search,
      Interview Prep and LinkedIn Essential. **They have paid and are gated.**
      This is unresolved and it will surface on the first pack sale.

## Still open from the old checklist

- **Webhook idempotency is keyed on the row's state, not on processed event
  IDs.** That makes a repeated "paid" delivery for one purchase safe, which is
  the case that actually happens. It does not dedupe distinct event types or
  detect an old event replayed months later. Worth a `processed_webhook_events`
  table eventually; not a launch blocker.
- **The secret is read from the request body**, which is what Moyasar sends.
  If they ever move to an HMAC over the raw bytes, the route must switch to
  `await request.body()` and hash the raw bytes — `request.json()` discards
  them and re-serialising will not reproduce them.
