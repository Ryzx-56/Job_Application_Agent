# Pricing Reference v7

**Supersedes v6.** Written 2026-09-10, after the decisions in
`tarshih-decisions-and-prompt.md` were settled and the Section 9 cuts shipped.

> **Updated 2026-09-12 — Serper migration built, then reverted.** A Serper
> migration was built behind `SEARCH_PROVIDER` and briefly live in production;
> the decision was to revert to Tavily-only (Serper's per-property discount
> wasn't verified against this product's actual filters and domain lists, and
> it had no confirmed Jobs vertical or `/usage`-equivalent quota endpoint —
> not worth the risk right after a live-payments launch). **Every figure in
> this document is Tavily, and Tavily is what production runs.** The one
> change from the numbers below: §1.1's `find-jobs` row is split into typical
> and worst case, the same way the standalone search row already was — the
> single "8 credits" figure was real but incomplete.
>
> **Second update, same day:** `COST_PER_CREDIT_SAR` recomputed from 0.28 to
> **0.04 SAR/credit** now that the automatic job match it was pricing is
> confirmed gone (§4, "What v6 got wrong" §1). `find_similar_jobs` also now
> has the same `/usage` quota pre-flight `search_jobs_by_title` already had
> (§5) — the two entry points fail the same way when the platform ceiling is
> hit, not just when a key is missing.

Every figure here is either **read from the code** or **measured by running
it**. Nothing is retyped from v6, because v6's two load-bearing numbers were
both wrong — see "What v6 got wrong" at the end.

**Source of truth for prices:** `backend/core/pricing.py`. That module is what
the checkout charges against and what `admin_stats.py` derives from;
`frontend/src/lib/pricing.ts` mirrors it and is checked by
`backend/tests/test_pricing_parity.py`. **This document describes those numbers,
it does not define them.**

---

## §1 — Cost basis

### The model

**One model across all tiers: `gpt-5.6-luna`** (`WRITING_MODEL` in
`core/llm_config.py`). No per-tier split.

The split that v6 contemplated is gone for two reasons: the free tier's
candidate, `gemini-3.1-flash-lite`, failed degree normalisation on both runs of
the blind comparison, and the economics that motivated it disappeared when the
per-CV model cost fell 56×. One model means one prompt to tune, one code path,
and no marketing claim to keep true later.

Rates verified against the provider's published pricing page:
**$0.20/M input, $0.02/M cached input, $1.20/M output.** SAR pegged at
**3.75/USD** (`SAR_PER_USD`).

### Measured per-feature cost

| Feature | **SAR/run** | n | Model calls |
|---|---|---|---|
| CV tailoring — English | 0.00829 | 10 | 1 |
| CV tailoring — Arabic | 0.01769 | 10 | 2 |
| Cover letter — English | 0.00301 | 5 | 1 |
| Cover letter — Arabic | 0.00374 | 5 | 1 |
| Match scorer + gap analysis | 0.00202 | 5 | 1 |
| **ATS score** | **0.00000** | — | **0 — pure Python** |
| Interview Prep — English | 0.0302 | 3 | 2 |
| Interview Prep — Arabic | 0.0355 | 2 | 2 |
| **LinkedIn generation** | **0.0188** | **3** | **1** |

**Whole CV, model only:** **English 0.01332 SAR**, **Arabic 0.02345 SAR**.

> **Arabic costs 1.76× English.** v6 recorded them as equal. It is still only
> 2.3 halalas, so the conclusion is not "Arabic is expensive" — it is that
> Arabic at 2 credits against English at 1 is if anything generous to us.

**LinkedIn generation, measured since this doc was first written:** one call,
5,141 input tokens (5,138 of them cached on a warm run), 3,833 output, 36
seconds. **0.0177 SAR warm, 0.0207 cold.** It is the largest single generation
in the product by output tokens and it is still under two halalas.

> Two admin figures were wrong because of this. `BUNDLED_ADDON_COSTS_SAR` in
> `core/admin_stats.py` carried **0.15** for LinkedIn Essential and **0.85**
> for Interview Prep — development-era guesses, **8× and 24× the measured
> values**. Both made the bundled add-ons look expensive enough to argue
> against including them. Replaced with 0.019 and 0.036.

**Not included:** Gemini extraction (`cv_parser`, `jd_analyzer`, the fact
checker, the jobs screener) could not be measured — Gemini was unreachable from
the machine this was measured on. Small but not zero. **Take this measurement
before signing off a v8.**

### §1.1 — Tavily, which v6 did not have at all

**This is the section v6 was missing, and it is the one that matters.**

Tavily bills **per request**, not per result — so `RAW_FETCH_LIMIT` is free and
the only cost driver is how many times a search fires.
`search_depth='advanced'` = **2 credits/call**.

| | Tavily credits | **USD** | **SAR** |
|---|---|---|---|
| **Per CV creation, automatic** | **0** | **$0.00** | **0.00** |
| `find-jobs` (per-CV button) — typical | 8 | $0.064 | **0.24** |
| `find-jobs` (per-CV button) — worst case | 32 | $0.256 | **0.96** |
| Standalone Job Search — typical | 24 | $0.192 | **0.72** |
| Standalone Job Search — worst case | 36 | $0.288 | **1.08** |
| Interview Prep / LinkedIn / ATS | 0 | $0.00 | 0.00 |

At Tavily's published Pay-As-You-Go rate of **$0.008/credit**
(`search_depth='advanced'` = 2 credits/call), one credit is **0.03 SAR**
(0.008 × 3.75, `SAR_PER_USD`).

**Per CV creation is genuinely zero, not "gated to zero for free tier."**
`core/orchestrator.py`'s `route_after_fact_check` confirms `jobs_finder` is no
longer a graph sibling for *any* tier — CV generation runs tailoring, fact
check, cover letter and scoring, and nothing else. The job match only runs
when the user presses "Find matching jobs" on a saved CV
(`POST /api/v1/resumes/{id}/find-jobs`, `find_jobs_for_resume` in
`core/documents.py`), and it is idempotent — a CV that already has results
returns them from `similar_jobs` at zero cost, so double-clicking doesn't
double-charge.

**`find-jobs`'s two numbers, shown because they're a range, not a knob:**
`find_similar_jobs` (`agents/jobs_finder.py`) runs one query across 4 lanes
(priority, trusted, Saudi aggregator, open-web) = 4 calls = **8 credits**,
which is what most searches cost because the first query usually fills the
candidate pool. Only when that pool is still thin
(`< RESULT_CAP * 3` candidates) does it broaden to the remaining 3 query
variants, same 4 lanes each = 12 more calls, for **16 calls / 32 credits**
worst case. This is gated by its own monthly cap (`JOB_SEARCH` in
`ADDON_CAPS`, §3) — 0/4/12 across Free/Pro/Elite — not by the CV credit pool.

**Standalone Job Search's numbers are unchanged and still check out against
the code:** `search_jobs_by_title` runs the primary title's own 3-query
ladder over 4 lanes (4 + 4 + 4 = 12 calls = 24 credits) when an exact match
is found; when it isn't, up to 2 adjacent titles are searched at 3 lanes each
(no open lane, no ladder) for 6 more calls, 18 total = **36 credits** worst
case. This page has no monthly cap of its own yet (`core/job_search.py`'s own
header explains why — shipping one needs a migration this repo doesn't have
yet) — worth a v8 line once one exists.

**Before the cuts, a standalone search was 72 credits typical and 144 worst.**
Cuts A–E (`ADJACENT_EXPANSION_THRESHOLD`, `ADJACENT_TITLES_MAX`,
`BROADEN_THRESHOLD`, `ADJACENT_USES_OPEN_LANE`, and no ladder on fallback
titles) took it to 24 / 36.

> **Why this was the largest cost reduction in the product:** the job match
> used to run on every CV generation as a LangGraph node — 0.24 SAR of Tavily
> against 0.0133 SAR of model, **18× the model cost, on a panel most people
> never opened.** See above for where it lives now and what it costs today.

**A further 50% is available and untested:** `basic` depth is 1 credit against
`advanced`'s 2, and everything downstream reads only title/url/snippet. Run
`backend/tools/tavily_depth_test.py` (30 credits) and check the `b_only` /
`a_only` columns — if advanced returns no URLs that basic misses, halve every
figure in this section. **Not switched, because `content` also feeds the
dead-listing and scam filters and a shorter one could weaken them silently.**

---

## §2 — The price list

Read from `core/pricing.py`. **Do not retype these; they have changed before.**

| Product | SAR | Halalas | Credits |
|---|---|---|---|
| Free | 0 | — | **3** |
| **Pro** (monthly) | **29** | 2900 | **24** |
| **Elite** (monthly) | **99** | 9900 | **80** |
| Starter pack | 9 | 900 | 5 |
| Best Value pack | 22 | 2200 | 15 |
| Power pack | 38 | 3800 | 30 |
| LinkedIn Premium | 200 | 20000 | — |

LinkedIn **Essential** has no price: it is bundled into Pro and Elite and
metered monthly.

**Credit cost per feature:** English CV **1**, Arabic CV **2**, ATS + match
score **0 (free to everyone)**, cover letter **0** (bundled, not separable in
the pipeline).

---

## §3 — Monthly allowances

`FREE_TIER_CREDITS` and `ADDON_CAPS` in `core/entitlements.py`.

| | Credits | LinkedIn Essential | Interview Prep | **Job Search** |
|---|---|---|---|---|
| **Free** | **3** | 0 | 0 | **0** |
| **Pro** | 24 | 2 | 5 | **4** |
| **Elite** | 80 | 5 | 15 | **12** |

**Job Search is newly metered** (migration `20260909200000`). It was the only
paid feature with no cap at all, and it is the most expensive thing the product
does. **It has its own cap and does not draw on the credit pool** — CV credits
are a different resource with a known cost basis and stay untouched.

**Free tier stays at 3 credits.** The case for cutting to 2 rested on a
0.72 SAR loss per free user that counted model tokens only. With the automatic
job match gone, a free user's worst-case cost is **0.12 SAR**
(`3 × COST_PER_CREDIT_SAR`, recomputed 2026-09-12 — see §4) — gating saved
0.64, cutting a credit would have saved about 0.04, and it was the change most
likely to hurt conversion.

### §3.1 — Credit-pack buyers

**Holding `purchased_credits > 0` unlocks the gated features at the Pro
allowance**, for as long as the credits last (`effective_tier()` in
`core/entitlements.py`).

A pack is not a subscription: **no recurring monthly allowance, no renewal, no
expiry beyond the credits themselves.** But someone who paid must be able to
spend what they bought on whatever they want.

Before this, a Power-pack buyer paid 38 SAR and stayed `tier='free'` — gated
out of every feature those credits could be spent on. **That blocked selling
packs.**

---

## §4 — Margins

> **Table rebuilt 2026-09-12, from `core/admin_stats.py`'s own formula, not
> hand-derived.** The previous version of this table (10.58 / 33.76 / 0.53 /
> 1.84 / 3.95) didn't reduce to `credits × COST_PER_CREDIT_SAR` under either
> the old constant (0.28) or the new one (0.04) — it was carrying some other,
> undocumented combination of the automatic match, job search and the addon
> caps that I could not reconstruct with confidence. Rather than guess-patch
> numbers I couldn't verify, this table now shows exactly what
> `admin_stats.py`'s worst-case total actually computes today: **CV credits
> (`worst_case_cost_sar`) + the LinkedIn Essential cap.** It does NOT include
> Interview Prep's or Job Search's own worst-case cost — `admin_stats.py`
> doesn't fold either into this total either (`BUNDLED_ADDON_COSTS_SAR
> ["interview_prep"]` is defined but never summed; Job Search doesn't appear
> in the accumulation at all) — flagged in §5, not fixed here. Treat this
> table as "what the admin dashboard's worst-case panel shows," not as an
> all-in worst case across every paid feature.

| Tier | Price | CV credits worst case | + LinkedIn Essential cap | **Total** | **Profit** | **Margin** |
|---|---|---|---|---|---|---|
| Free | 0 | 0.12 | — | **0.12** | −0.12 | — |
| **Pro** | 29 | 0.96 | 0.04 (2 × 0.019) | **1.00** | 28.00 | **96.6%** |
| **Elite** | 99 | 3.20 | 0.10 (5 × 0.019) | **3.30** | 95.70 | **96.7%** |

**A separate, more realistic scenario — CV credits at the recomputed rate,
plus every baseline Job Search actually run at its per-search cost (§1.1,
36 credits = 1.08 SAR worst case each):**

| Tier | CV credits worst case | + Job Search (baseline × 1.08) | **Total** | **Margin** |
|---|---|---|---|---|
| Pro | 0.96 | 4 × 1.08 = 4.32 | **5.28** | **82%** |
| Elite | 3.20 | 12 × 1.08 = 12.96 | **16.16** | **84%** |

**Packs** (credits only, no baselines — `admin_stats.py` has no addon-cap
component for packs, so this is exactly `credits × COST_PER_CREDIT_SAR`):

| Pack | Price | Worst-case cost | **Margin** |
|---|---|---|---|
| Starter | 9 | 0.20 | **97.8%** |
| Best Value | 22 | 0.60 | **97.3%** |
| Power | 38 | 1.20 | **96.8%** |

**Every margin above went up, because the number that changed
(`COST_PER_CREDIT_SAR`) went down 86%.** That's expected and correct — it
means the OLD figures were overstating cost, not that the product got
cheaper to run. The Job Search scenario table is the one to watch, since it's
the cost driver that didn't shrink.

> **The design is safe.** Before the cuts and the metering, an Elite subscriber
> who spent everything on Job Search cost **164 SAR against 99 in revenue —
> a −66% margin, from one subscriber in one month.** Job Search having its own
> cap is what removes that, and it is the reason the cap exists.

---

## §5 — Platform Tavily ceiling

**The binding constraint on the whole business**, and the section v6 had no
equivalent of.

Free (Researcher) plan: **1,000 credits/month, shared platform-wide.**

Assuming a Pro-shaped user — 24 credits of CVs, the match pressed on half of
them, 4 standalone searches:

| Active Pro users | Credits/month | Cost at $0.008 | Plan |
|---|---|---|---|
| **5** | ~720 | $6 | free tier, just |
| 100 | 14,400 | **$115/mo** | Pay-As-You-Go |
| 500 | 72,000 | **$576/mo** | Pay-As-You-Go |
| 1000 | 144,000 | **$1,152/mo** | Pay-As-You-Go |

**Can you launch on the free tier?** Only while you have almost no users —
roughly **five active Pro subscribers** exhausts it.

> **⚠️ This already happened.** On 2026-09-10 the account stood at **976/1000**
> and Tavily was refusing every request. Job Search was answering HTTP 200 with
> an empty list, so a paying subscriber saw *"no jobs found"* when the truth
> was that we had run out of credits.
>
> **Switch on Pay-As-You-Go before launch.** At $115/month for 100 Pro users
> against 2,900 SAR (~$773) of revenue, it is a line item, not a blocker. What
> is not affordable is discovering the ceiling by having the feature go dark
> mid-month for everyone at once.

**Guards that exist today** (`agents/jobs_finder.py`, `core/search_provider.py`):
the per-search cuts; the per-user monthly cap on `find-jobs` (§3); and a
pre-flight check against Tavily's `/usage` endpoint that refuses a search it
cannot afford to finish. **Fixed 2026-09-12: both entry points now have the
`/usage` pre-flight.** It only ran in `search_jobs_by_title` (the standalone
Job Search page) until this pass — `find_similar_jobs` (the per-CV `find-jobs`
button) had no such check before it started spending, the same failure class
as the two outages already logged in this document. It now runs the identical
check, with the identical cold-start-bounded first search, and raises the
identical `SearchUnavailable`/503 — verified directly: a known low balance now
makes `find_similar_jobs` raise `SearchQuotaExhausted` before any lane runs,
not just a missing key.

**A different failure mode was fixed while reverting:** `SEARCH_PROVIDER`
defaults to `'serper'` in code, and with `SERPER_API_KEY` deleted, every lane
independently hit a missing-key error that was being swallowed into "0
results" — the exact "no jobs found" outage from 2026-09-10 above, but from a
missing key instead of a spent quota. `search_provider.assert_provider_configured()`
now catches this up front, once, and raises the honest error instead. See the
revert report for the reproduction.

---

## What v6 got wrong, and why

**1. The cost basis, 0.75 SAR/credit.** Measured on the Claude Sonnet path.
Sonnet emitted ~13,000 output tokens per CV, of which about 79% was invisible
reasoning billed as output. v7's replacement was **0.28 SAR/credit**, of which
86% was Tavily, not the model — and that, in turn, was **recomputed to
0.04 SAR/credit on 2026-09-12** once the automatic job match it was pricing
was confirmed fully removed. See `core/admin_stats.py`'s comment above
`COST_PER_CREDIT_SAR` for the full derivation, and §4 above for every figure
that moves as a result. The flag that used to sit here — "this figure may
itself now be stale" — is resolved: it was, and now isn't.

**2. Arabic measured the same as English.** It does not: 1.76× on the model,
2 API calls against 1, 2.15× the output tokens. Both of v6's stated facts —
more tokens *and* an extra purity pass — were true; the measurement that said
they cost the same was the wrong one.

**3. No Tavily anywhere.** Tavily was 95% of the cost of generating a CV and
appeared in no line of v6. Every margin figure in it was therefore computed on
about a twentieth of the real cost.

**4. No Job Search.** A Pro/Elite feature with no cost basis, no cap, and no
line in the pricing page — and the most expensive thing the product does.

---

## Open, for a v8

- **Measure Gemini extraction.** Needs a machine that can reach Gemini. Still
  the single biggest source of uncertainty in `COST_PER_CREDIT_SAR`'s 0.02
  headroom term (§1, "What v6 got wrong" #1).
- **Run the search-depth test — deliberately last, not part of this pass.**
  Still not run as of 2026-09-12 — 30 credits, potentially halves §1.1. Moot
  only while migrating off Tavily; since we're staying, it's live again.
- **Decide whether Job Search should also be purchasable with credits** once
  its real cost is stable. Today it is baseline-only, deliberately — the
  worst-case table above is what that buys.
- **Fold Interview Prep and Job Search into `admin_stats.py`'s worst-case
  total.** Found while reconciling §4 (2026-09-12): `BUNDLED_ADDON_COSTS_SAR
  ["interview_prep"]` is defined but never summed into `total_cost`, and Job
  Search's own per-search cost doesn't appear in that accumulation at all —
  so the admin dashboard's platform-wide worst-case figure is narrower than
  what §4's "Job Search baseline" scenario table shows. Not fixed here: it
  changes what the dashboard's total means, not just a constant's value.
- **Add a monthly cap to the standalone Job Search page** (`/api/v1/job-search`)
  once its migration exists — it is still the one paid search surface with no
  cap of its own (§1.1).
