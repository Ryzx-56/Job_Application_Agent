# Pricing Reference v7

**Supersedes v6.** Written 2026-09-10, after the decisions in
`tarshih-decisions-and-prompt.md` were settled and the Section 9 cuts shipped.

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

| | Tavily credits | **SAR** |
|---|---|---|
| Job match for one CV (`find-jobs`) | 8 | **0.24** |
| Standalone Job Search — typical | **24** | **0.72** |
| Standalone Job Search — worst case | **36** | **1.08** |
| Interview Prep / LinkedIn / ATS | 0 | 0.00 |

At Tavily's published Pay-As-You-Go rate of **$0.008/credit**, one credit is
**0.03 SAR**.

**Before the cuts, a standalone search was 72 credits typical and 144 worst.**
Cuts A–E (`ADJACENT_EXPANSION_THRESHOLD`, `ADJACENT_TITLES_MAX`,
`BROADEN_THRESHOLD`, `ADJACENT_USES_OPEN_LANE`, and no ladder on fallback
titles) took it to 24 / 36.

> **The job match is no longer automatic.** It used to run on every CV
> generation as a LangGraph node — 0.24 SAR of Tavily against 0.0133 SAR of
> model, **18× the model cost, on a panel most people never opened.** It is now
> a button. This single change is the largest cost reduction in the product.

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
job match gated, a free user costs **0.04 SAR** — gating saved 0.72, cutting a
credit would have saved 0.25, and it was the change most likely to hurt
conversion.

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

Worst case throughout: every credit spent on the most expensive available
option, every baseline allowance used, every job search at its 36-credit worst
case, and the on-demand match pressed on every CV.

| Tier | Price | Worst-case cost | **Profit** | **Margin** |
|---|---|---|---|---|
| Free | 0 | 0.76 (English) / 0.26 (Arabic) | −0.76 | — |
| **Pro** | 29 | **10.58** | 18.42 | **64%** |
| **Elite** | 99 | **33.76** | 65.24 | **66%** |

**Worst case if credits go entirely to the most expensive credit-spend** — an
Arabic CV plus its match — **plus** every baseline search:

| Tier | Cost | **Margin** |
|---|---|---|
| Pro | 7.48 SAR | **74%** |
| Elite | 23.50 SAR | **76%** |

**Packs** (credits only, no baselines):

| Pack | Price | Worst-case cost | **Margin** |
|---|---|---|---|
| Starter | 9 | 0.53 | **94%** |
| Best Value | 22 | 1.84 | **92%** |
| Power | 38 | 3.95 | **90%** |

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

**Three guards now exist** (`agents/jobs_finder.py`): the per-search cuts, the
per-user monthly cap, and a pre-flight check against Tavily's own `/usage`
endpoint that refuses a search it cannot afford to finish. When the quota is
gone, users are told so honestly rather than shown an empty page.

---

## What v6 got wrong, and why

**1. The cost basis, 0.75 SAR/credit.** Measured on the Claude Sonnet path.
Sonnet emitted ~13,000 output tokens per CV, of which about 79% was invisible
reasoning billed as output. The real basis is now **0.28 SAR/credit**
(`COST_PER_CREDIT_SAR` in `core/admin_stats.py`) — and **86% of that is
Tavily, not the model.**

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

- **Measure Gemini extraction.** Needs a machine that can reach Gemini.
- **Run the search-depth test.** 30 credits, potentially halves §1.1.
- **Decide whether Job Search should also be purchasable with credits** once
  its real cost is stable. Today it is baseline-only, deliberately — the
  worst-case table above is what that buys.
