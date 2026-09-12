# Implementation task: credit-purchasable add-ons + Job Search capping

## Context

Read `pricing-reference-v7.md` first — it is the cost basis for everything below.
`backend/core/pricing.py` is the source of truth for prices;
`frontend/src/lib/pricing.ts` mirrors it and
`backend/tests/test_pricing_parity.py` enforces parity. Keep all three in sync.

Measured costs you are pricing against (SAR per run, worst case):
English CV 0.0133 · Arabic CV 0.0235 · LinkedIn Essential 0.0207 ·
Interview Prep 0.0355 · Job Search 1.08 · ATS/match 0.002

Do not change any measured figure. Do not invent new cost constants.

---

## 1. Remove the credit-pack tier promotion

`effective_tier()` in `core/entitlements.py` currently promotes any user holding
`purchased_credits > 0` to the Pro allowance. **Remove this entirely.**

New behaviour: buying a credit pack grants credits and nothing else. Pack buyers
get **no monthly baseline allowances** for Job Search, Interview Prep or LinkedIn
Essential. They can still *buy* those features with their credits at the prices
in §2 below, exactly like anyone else.

A user's tier for allowance purposes is now strictly their subscription tier
(`free` / `pro` / `elite`). Purge every downstream assumption that a pack buyer
is Pro — search the codebase for `effective_tier` callers and fix each one.

Add a regression test: a user with `tier='free'` and `purchased_credits=30` has
`job_search_baseline == 0`, `interview_prep_baseline == 0`,
`linkedin_essential_baseline == 0`, and can still spend credits on all three.

---

## 2. New: add-ons purchasable with credits

Add to `core/pricing.py`:

```
ADDON_CREDIT_COSTS = {
    "linkedin_essential": 2,
    "interview_prep": 3,
    "job_search": 5,
}
```

Mirror in `frontend/src/lib/pricing.ts` and assert in `test_pricing_parity.py`.

**Spend order (important):** when a user triggers one of these features, always
consume the monthly baseline allowance first. Only when the baseline for that
add-on is exhausted does the system offer to spend credits. Never silently spend
credits while baseline remains.

**The purchase must be explicit.** If baseline is exhausted, the API returns a
`402`-style structured response naming the feature, the credit cost, and the
user's current credit balance. The frontend shows a confirmation step
("Use 5 credits for another Job Search? You have 18."). The feature only runs
after the user confirms. No auto-deduction, ever.

**Atomicity.** Credit deduction and add-on execution must be a single
transaction. If the feature fails (including `SearchUnavailable` / 503 from the
Tavily `/usage` pre-flight), the credits are refunded or never deducted. Job
Search idempotency already exists in `find_jobs_for_resume` — a CV that already
has `similar_jobs` results must return them at zero cost and **zero credits**.
Do not let a double-click charge twice.

---

## 3. Arabic CV drops to 1 credit

Currently English CV = 1 credit, Arabic CV = 2. Change Arabic to **1 credit**.
Rationale: Arabic costs 1.76× English on the model, which is a difference of one
halala; charging double penalises the primary market for a rounding error.

Update `pricing.py`, `pricing.ts`, the parity test, and every user-facing string
that says Arabic costs 2 credits.

---

## 4. Cap the standalone Job Search page

`/api/v1/job-search` (`core/job_search.py`, `search_jobs_by_title`) has **no
per-user cap** — it is the only paid search surface without one. The per-CV
`find-jobs` button (`find_similar_jobs`) is capped via `JOB_SEARCH` in
`ADDON_CAPS`.

Unify them into **one shared monthly Job Search pool** covering both entry
points:

| Tier | Job Search baseline | Max purchasable per month |
|---|---|---|
| Free | 0 | 0 |
| Pro | 4 | 4 |
| Elite | 12 | 12 |

The purchase cap equals the baseline — a user can at most double their job
searches in a month. This is what bounds the worst-case cost; do not make it
unlimited.

Free tier cannot buy Job Search at all (they only ever hold 3 credits against a
5-credit price, but enforce it explicitly rather than relying on that).

This needs a migration (the existing code comment in `core/job_search.py`
explains one doesn't exist yet). Write it. Follow the pattern of migration
`20260909200000` which added the original `JOB_SEARCH` cap.

---

## 5. Elite credits 80 → 100

Currently Elite is 99 SAR / 80 credits = 1.238 SAR per credit, which is *worse*
than Pro's 29 / 24 = 1.208. The larger tier must have the better rate. Raise
Elite to **100 credits** (0.99 SAR/credit). Cost impact is 0.27 SAR per user
per month.

Update `pricing.py`, `pricing.ts`, parity test, and all marketing copy.

---

## 6. Usage tracking and counters

Per user, per calendar month, track separately:

- baseline consumed, per add-on
- purchases made, per add-on (to enforce the purchase cap)
- credits spent, per add-on (for analytics)

These must reset on the same monthly boundary the existing `ADDON_CAPS` use.
Pack credits themselves do **not** expire and do **not** reset — only the
allowance counters do.

Expose a single endpoint the dashboard can call to render remaining
baseline + remaining purchasable + credit balance for every feature in one
round trip. Don't make the frontend assemble this from four calls.

---

## 7. Fix `admin_stats.py`'s worst-case total

Two known gaps, both documented in pricing-reference-v7 §4 and "Open, for a v8":

- `BUNDLED_ADDON_COSTS_SAR["interview_prep"]` is defined but never summed into
  `total_cost`.
- Job Search does not appear in the accumulation at all.

Fold both in, and add the new credit-purchased add-on costs. The worst-case
panel should now compute, per tier:

```
CV credits remaining after max add-on purchases × per-CV cost
+ (baseline Job Search + purchased Job Search) × 1.08
+ Interview Prep baseline × 0.0355
+ LinkedIn Essential baseline × 0.0207
```

Target figures to verify against (worst case, SAR):
Free 0.07 · Pro 8.95 · Elite 27.49
Margins: Pro 69.1%, Elite 72.2%

Also fix the two stale constants if they are still wrong:
`BUNDLED_ADDON_COSTS_SAR` should read 0.019 for LinkedIn Essential and 0.036 for
Interview Prep (v7 notes these were 0.15 and 0.85 — 8× and 24× the measured
values).

---

## 8. Frontend — go through EVERY page

Do not stop at the pricing constants. Audit and update all of:

**Landing page pricing section.** Rewrite the tier feature lists. Pro and Elite
must clearly show that they include Job Search, LinkedIn Essential and Interview
Prep as monthly allowances — this is currently under-sold. State that credits are
flexible: usable for CVs *or* for buying more Job Searches, Interview Preps and
LinkedIn optimisations once the monthly allowance runs out.

**Pricing / plans comparison table.** Add rows for the credit cost of each
add-on. Make the "what can I do with a credit?" answer visible without clicking.

**Credit pack section.** Must now be honest: packs give credits only, no monthly
allowances. Remove any copy implying pack buyers get Pro features. Position packs
as top-ups for subscribers and as a no-commitment entry for free users.

**Dashboard.** Every feature panel (Job Search, Interview Prep, LinkedIn) shows:
allowance used / total, then remaining purchasable, then the credit price. When
baseline hits zero, the CTA becomes "Use N credits" rather than a dead/greyed
button. Show the credit balance persistently.

**Upgrade / paywall prompts.** Anywhere the old code said "upgrade to Pro to
unlock this", the message now has two paths: upgrade, or spend credits.

**Arabic copy.** Everything above exists in Arabic too. Update both locales.
Anything stating Arabic CVs cost 2 credits is now wrong in both languages.

---

## 9. Do not break

- The Tavily `/usage` pre-flight in both `search_jobs_by_title` and
  `find_similar_jobs` must run *before* any credit is deducted. Raising
  `SearchQuotaExhausted` / `SearchUnavailable` must not cost the user credits.
- `search_provider.assert_provider_configured()` stays. `SEARCH_PROVIDER` still
  defaults to `'serper'` in code while production is Tavily-only — either flip
  the default to `'tavily'` or leave the assertion as the guard, but do not
  reintroduce the swallowed missing-key → "0 results" failure.
- `test_pricing_parity.py` must pass. Extend it to cover
  `ADDON_CREDIT_COSTS` and the new caps.

---

## 10. Deliver

Write tests for: the removed tier promotion, spend-order (baseline before
credits), the purchase cap, atomic refund on failure, Job Search idempotency
under credit spend, and free-tier exclusion from Job Search purchase.

Then give me a short summary of: every constant you changed, every file you
touched, and anything in pricing-reference-v7 that the code contradicted.
