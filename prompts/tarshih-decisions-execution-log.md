# Tarshih — Decisions Execution Log

Working through the ten items in Part 3 of `tarshih-decisions-and-prompt.md`,
in the order given. One entry per item: what was done, what was found, what is
blocked and why.

---

## ⚠️ READ THIS FIRST — your Tavily quota is exhausted right now

I hit this in the first thirty seconds, trying to run the basic-vs-advanced
test you asked for in item 1. Every call came back:

```
ForbiddenError: This request exceeds your plan's set usage limit.
```

Tavily's own usage endpoint, queried directly:

```json
{"account": {"current_plan": "Researcher",
             "plan_usage": 976, "plan_limit": 1000,
             "paygo_usage": 0, "paygo_limit": null}}
```

**976 of 1,000 credits. Tavily is refusing requests.**

### What this means for your users today

`_search_tavily` catches the exception and returns `[]`. Nothing raises. So:

- **Standalone Job Search returns HTTP 200 with `exact: [], related: []`.** A
  Pro subscriber who paid 29 SAR types a job title and gets an **empty results
  page that reads as "there are no jobs for you"** — not "we are out of
  quota". This is exactly the failure mode Section 9 described as "returning
  empty pages that look like a broken product", and it is live.
- **The automatic per-CV job match silently returns nothing.** CV generation
  still succeeds, which is the one piece of good news — the failure is
  contained to the jobs panel.

### What it means for this session

**I could not run the basic-vs-advanced comparison.** It needed 30 credits and
there were not 30 credits. Item 1's cuts are implemented and measured against
the code; the depth question is answered from Tavily's documentation and left
open for a real test. Details in item 1.

**It also reorders your list.** Item 8 (the quota guard) was written as a
before-launch task. It is not — the thing it protects against has already
happened, and the honest-degradation half of it is the difference between
"temporarily unavailable" and a paying customer concluding your product does
not work. I did item 8 properly.

**What to do now:** switch on Tavily Pay-As-You-Go ($0.008/credit, no monthly
fee, `paygo_limit` is currently `null` so nothing is spilling over). With the
cuts below, a typical search is 24 credits ≈ $0.19.

---

## Item 1 — Section 9's cuts A–E, and the search-depth question

### The five cuts: implemented, with the measurements

Each cut is now a named constant next to the thing it modifies, so a future
change can see what it is trading.

| Cut | Constant | Change |
|---|---|---|
| **A** | `ADJACENT_EXPANSION_THRESHOLD = 1` | Adjacent titles are offered only when the requested title returned **nothing**. Was `len(exact) < RESULT_CAP` — a search with four good matches still bought up to five more full searches to pad the page. |
| **B** | `ladder=False` on adjacent titles | A fallback title gets the first query only. The ladder exists to rescue a thin *primary* search; laddering a fallback is how one search became six. |
| **C** | `ADJACENT_TITLES_MAX = 2` | Was 5. Sliced before the loop, not inside it — the old `RELATED_CAP` break only fired after results were already paid for, so it capped the output and not the spend. |
| **D** | `BROADEN_THRESHOLD = RESULT_CAP * 2` | Was `RESULT_CAP * 3` (15), which one query across four lanes almost never reaches — so the ladder fired on essentially every search. |
| **E** | `ADJACENT_USES_OPEN_LANE = False` | The open lane is skipped for adjacent titles only. On the title the user typed it earns its 2 credits (a company's own careers page is what no domain list anticipates); on a fallback it is the noisiest lane and the one the legitimacy filter rejects most of. |

**Measured, by counting real call paths with `tavily_call_counter()`:**

| Scenario | Before | **After A–E** |
|---|---|---|
| Pass 1 returns 5+ close matches | 4 calls = 8 credits | **4 calls = 8 credits** |
| Pass 1 thin, some exact matches | 36 calls = 72 credits | **12 calls = 24 credits** |
| Pass 1 found nothing → expansion | 72 calls = 144 credits | **18 calls = 36 credits** |

**Typical: 72 → 24 credits (−67%). Worst case: 144 → 36 (−75%).**

Monthly capacity on a 1,000-credit tier goes from **7–13 searches to 28–41**.

Slightly worse than the 32 I projected last session, because cut E takes the
adjacent lanes from 4 to 3 rather than the 4 I had assumed: 12 (primary, full
ladder) + 2 × 3 (adjacent, one query, no open lane) = 18 calls.

### The search-depth cut: right in principle, **and I could not test it**

You are correct on the arithmetic and on the documentation. Verified again
against Tavily's published API-credit table: **basic = 1 credit, advanced = 2.**
Halving the per-call price halves every Tavily figure in both documents.

**But you asked me to test it on ten real searches before committing, and I
agree with that instruction — so I have not switched it.** The test needed 30
credits (ten paired lane calls, which is the unit Tavily actually bills, rather
than ten full searches at 72 credits each = 720). There were 24 credits left.
Every call returned `ForbiddenError`.

**What I built, ready to run the moment the quota is topped up:**
`depth_test.py` compares basic and advanced on ten real production queries
across all four lanes and reports result count, URL overlap, results unique to
each depth, average `content` length, how many results carry a usable title,
and latency. Thirty credits, one command.

**What I would predict, and why it is only a prediction.** Everything
downstream consumes `title`, `url` and a snippet: `_to_candidate` reads them,
the legitimacy filter reads the URL and title, `_llm_screen_listings` gets a
truncated snippet, and the UI shows title/company/snippet/link. Nothing reads
the deep page extraction that advanced pays for. **On that reading advanced is
buying nothing.**

**The reason I will not act on that reading without the test:** advanced does
not only extract more, it can *rank and retrieve differently*. If basic returns
materially different URLs — not just shorter content for the same URLs — then
it is a quality change, not a cost change, and the `content` field also feeds
`_looks_like_listing_or_category_page`, `_looks_closed` and `_looks_like_scam`,
which are the filters keeping dead and fraudulent postings off the page. A
shorter `content` could weaken those filters silently.

**The `b_only` / `a_only` columns in the test are the ones that decide it.** If
they are near zero, switch and take the 50%. If advanced returns URLs basic
does not, the trade needs your judgement.

**Recommendation:** top up Tavily, run `depth_test.py`, and send me the output.
It is a one-line change (`search_depth='advanced'` → a constant) plus the
`TAVILY_CREDITS_PER_CALL = 2` figure that the instrumentation reports with.

---

## ⚠️ Why Moyasar did not work — two causes, both found and both fixed

You said "i tested moyasar and it didnt work cause the last upadate isnt live".
That was right, and there were two separate reasons.

### Cause 1 — the deploy could not build. Nothing since 2026-09-08 was live.

`pip install -r requirements.txt` **failed on a clean install**, which is what
Render does on every deploy. Two conflicts, both introduced by adding
`openai==3.10.0` without adjusting the pins around it:

```
ERROR: Cannot install jiter==0.14.0 and openai==3.10.0 because these package
       versions have conflicting dependencies.        (openai needs jiter>=0.16)

ERROR: Cannot install idna==3.15 and openai because these package versions
       have conflicting dependencies.   (openai -> httpx2 -> idna>=3.18)
```

**Neither was visible locally, and this is the interesting part.** When
`openai` was installed, pip upgraded `jiter` and `idna` in the venv to satisfy
it. So the *environment* was correct and the *file* was wrong. Every test run,
every import check, every `npm run build` — all of them ran against the good
venv and passed. **Nothing that runs against an existing environment can catch
a broken requirements file.**

Fixed: `jiter==0.16.0`, `idna==3.19`, and `httpx2`/`httpcore2`/`truststore`
pinned alongside `openai` instead of being resolved fresh on every build.

**Verified the way it actually matters:** a throwaway venv, `pip install -r
requirements.txt` from scratch → exit 0, then `import main` inside that clean
environment → clean. Not "the tests pass".

### Cause 2 — the two halves of the payment config disagree

Queried your live backend directly:

```
GET /api/v1/payments/catalog  ->  "mode": "live"
```

So **Render has a live `sk_live_` secret key.** Then I fetched
`tarshih.com/dashboard/checkout?pack=starter` and every JavaScript chunk it
loads, and searched them for a publishable key:

```
>>> NO pk_ KEY FOUND IN ANY BUNDLE
```

**`NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY` is not set in Vercel.** The server is
ready to charge and the browser has no key to build a card form with, so
`mountCheckoutForm` throws `moyasar-key-missing` and the page shows *"Payments
are unavailable right now because of a configuration error on our side."*

**This also explains the 404 in your Render log:**

```
❌ Moyasar refused GET /payments/6a6f5a6e-…: 404 — The Payment record you were
   looking for was not found
```

Test and live are **separate ledgers with separate ids**. A payment created
against a test-mode form and verified by a live-mode server is genuinely not
found — the live account has never seen it. The log said the payment record
was missing, which reads like the payment vanished rather than like the two
halves of the deployment disagreeing.

### What you need to do — one variable

**Vercel → Environment Variables → `NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY` =
`pk_live_…` → redeploy.** It must be `pk_live_`, matching Render's `sk_live_`.

Three things now catch this if it is ever half-set again:

1. **`GET /api/v1/admin/payments/config`** (new, admin-only) — booleans, mode,
   and the specific problems. Never a key or any part of one.
2. **The checkout form refuses to mount** on a key/mode mismatch, naming which
   variable to fix, rather than presenting a card form that will certainly
   fail.
3. **A startup line in the Render log** on every deploy:
   `💳 Payments: LIVE — real money | publishable_key_set=… webhook_secret_set=…`

**Still worth confirming:** `MOYASAR_WEBHOOK_SECRET` must be the **live**
webhook's secret. It is a different value from the test webhook's, and reusing
the test one makes every live webhook 403 *while payments keep succeeding* —
buyers charged, nobody credited. The config endpoint reports whether it is set.

---

## The 10 branches

**Nine of them were Dependabot robots**, not your work — GitHub opens a branch
per dependency update. The tenth was `main`. There was also a stale local
`fix/pricing-copy-and-rtl-glow`, already fully merged, now deleted.

**You are down to `main` + 1.**

| Branch | Outcome |
|---|---|
| `actions/checkout-7` | merged — CI only |
| `supabase/setup-cli-3` | merged — CI only |
| `frontend/dev-tooling` (8 updates) | merged. TypeScript 5→7, ESLint 9→10, @types/node 20→26. `tsc --noEmit` and build both clean |
| `frontend/next-react` (6 updates) | merged by hand — next 16.3.4, react 19.2.8. Build verified |
| `frontend/production-minor-patch` (11 updates) | merged by hand — supabase/ssr, framer-motion, lucide, radix, recharts, sonner. Build verified |
| `frontend/next-react` (types, regenerated) | merged — `@types/react` patch only |
| `pip/cryptography-50.0.1` | merged — 340 tests pass |
| `pip/rpds-py-2026.6.3` | merged — 340 tests pass |
| **`pip/websockets>=17.1`** | **REJECTED — see below** |
| **`pip/python-minor-patch` (62 updates)** | **REJECTED — see below** |

Three of them needed hand-merging: they all rewrote `package.json` and
`package-lock.json`, so each conflicted with the last. Same version bumps,
applied individually, each verified with a real `npm install` + build.

### ⚠️ Two I did not merge, and will not without you saying so

**`websockets>=17.1,<18.0` breaks two things it does not mention:**

```
google-genai 2.3.0 requires websockets<17.0,>=13.0.0, but you have 17.1
realtime 2.31.0   requires websockets<16,>=11,       but you have 17.1
```

That is **Gemini and Supabase Realtime**. Gemini runs your CV parser, JD
analyser and fact checker. Merging this takes the pipeline down. I merged it,
saw the conflict, and reverted it in the same session — the revert is in the
history on purpose so nobody merges it again next month.

**`python-minor-patch` (62 packages) is internally inconsistent.** It does not
resolve against itself, never mind against the rest of the file. Each fix
revealed another:

```
1. pydantic==2.13.5 + pydantic_core==2.48.0   -> ResolutionImpossible
   (2.13.5 needs pydantic_core 2.46.5; the branch bumped them apart)
2. google-api-core==2.36.0 + protobuf==5.29.6 -> ResolutionImpossible
```

I stopped there. This is 62 minor-patch bumps of a stack that currently works,
offered by a branch that cannot install itself, at the exact moment you need a
deploy to succeed. **Reverted to the working set and re-tested: 340 pass.**

Dependabot will reopen both. Close them, or let me take the python group one
package at a time when the payment work is done.

---

## Item 2 — the per-CV job match is on demand

**Done.** `jobs_finder` is out of the LangGraph fan-out entirely — the node
registration, the import, the conditional edge and the `add_edge(..., END)`
are all gone from `core/orchestrator.py`. It is now:

**`POST /api/v1/resumes/{id}/find-jobs`**, behind a **"Find matching jobs"**
button on the resume card.

Same pipeline, same screening, same `similar_jobs` column — so My Resumes and
everything else reads it unchanged. Two properties worth naming:

- **A CV that already has results returns them without spending anything.** A
  double-click or a refresh cannot cost a second search.
- **It is metered** (see item 8), and refused *before* any Tavily call, so an
  over-cap or free-tier request costs nothing.

Agent number 8 is deliberately left unused in `_STEP_NODE_TO_AGENT` rather
than renumbering the others, so a stored progress event from an older run
still means what it meant when it was written.

**What this saves:** 8 Tavily credits — **0.24 SAR** — on every CV generation
that nobody was going to look at. Against a measured model cost of 0.0133 SAR
for the same English CV, that is **18× the model cost, spent automatically**.

---

## Item 3 — free tier stays at 3, and you were right about the figure

**Your correction is confirmed by measurement.** The 0.72 SAR in the log was
model-only and Claude-era. Recomputed with Tavily included, at Tavily's
published $0.008/credit:

| Free tier, 3 credits | Model | Tavily | **Total** |
|---|---|---|---|
| all English, automatic match **ON** (before) | 0.0400 | 0.7200 | **0.7600 SAR** |
| all English, automatic match **GATED** | 0.0400 | 0.0000 | **0.0400 SAR** |
| 2 credits instead, match gated | 0.0266 | 0.0000 | 0.0266 SAR |
| 1 Arabic CV + 1 credit left, match gated | 0.0234 | 0.0000 | 0.0234 SAR |

> **Gating the match saves 0.72 SAR per free user. Cutting a credit saves
> 0.25 SAR.** The lever you were being asked to pull was the weaker one, and
> it was the one most likely to hurt conversion.

**A free user now costs roughly 4 halalas.** Down from 76.

**No code change was needed to gate it** — that fell out of item 2. Free tier
has `JOB_SEARCH: 0` in `ADDON_CAPS`, so `require_addon_quota` refuses with
`upgrade_required` before anything is fetched. `FREE_TIER_CREDITS` stays 3.

The button still renders for free users and returns the upgrade message when
pressed. That is deliberate: it costs nothing, and it is where someone
discovers the feature exists. Say the word if you would rather hide it.

---

## Item 4 — credit-pack buyers get access while they hold credits

**Done, exactly as you specified.**

`core/entitlements.py` gains `effective_tier(user_id)`: identical to the
subscribed tier for everyone **except** a free user holding
`purchased_credits > 0`, who is gated as **Pro** for as long as those credits
last. When they hit zero, they revert to free gating.

Wired into both gates that matter — `get_addon_quota` and
`get_current_paid_user_id` — so it covers Job Search, Interview Prep and
LinkedIn Essential in one place rather than three.

**Pro's allowance, not Elite's**: a pack costs pack money, and too generous
here is a cost leak that only shows up on an invoice. **Never downgrades
anyone** — a real Pro or Elite subscriber keeps their own tier whatever their
pack balance is. **Never grants on a database error** — `has_purchased_credits`
returns False if the read fails, falling back to ordinary tier gating.

No recurring allowance, no renewal, no expiry beyond the credits themselves.
**This unblocks selling packs.**

---

## Item 8 — the Tavily quota guard, all three layers

You called this the real launch blocker. **It had already happened by the time
I got to it** — see the note at the top.

**Layer 1 — per search.** Cuts A–E, item 1. 72 → 24 typical, 144 → 36 worst.

**Layer 2 — per user, monthly.** Job Search is now a metered add-on, the third
one, using machinery that already existed:
`supabase/migrations/20260909200000_job_search_metering.sql` adds
`profiles.job_search_used` and teaches `consume_addon_quota`,
`release_addon_quota`, `reset_credits_if_due` and `apply_monthly_allowance`
about it.

| Tier | Monthly job searches |
|---|---|
| Free | **0** |
| Pro | **4** |
| Elite | **12** |

**All three reset paths clear the counter.** Missing one is how a cap becomes
permanent — the counter climbs to the limit in month one and the feature goes
dark forever.

**Layer 3 — the platform ceiling, asked of Tavily rather than tracked
locally.** `tavily_credits_remaining()` reads Tavily's own `/usage` endpoint
(cached 5 minutes) and `assert_tavily_headroom()` **refuses a search it cannot
afford to finish** rather than starting one, spending most of a page's worth of
credits and returning something thin.

Their endpoint is authoritative in a way a local counter cannot be: it knows
about every instance, every restart, and any credits spent outside this
codebase. A local counter would also reset on every Render deploy.

Tested against your live account, which is exactly at the boundary:

```
🚫 Refusing a job search: 24 Tavily credit(s) left, this search needs up to 36.
```

**And the honest failure.** `TavilyQuotaExhausted` is its own exception,
because it is the one search failure that is neither transient nor about the
query. It reaches the user as:

> "Job search is unavailable for the rest of this month while we top up our
> search provider. Nothing was charged. Your saved CVs and every other feature
> are unaffected."

instead of an empty results page. **Telling a paying subscriber there are no
jobs for their title, when the truth is that we ran out of credits, is the
worst available reading of this failure — and it is what the code did.**

---

## Item 6 — the photo field, with your permission

**Done.** `ManualCVRequest` gains `candidate_photo`; both manual endpoints set
it; the warning banner now offers **"Upload a photo"** before "Use a template
without a photo", with a thumbnail and a Remove control once one is attached.

**It is never stored as sent.** `normalize_uploaded_photo()` re-decodes it with
Pillow, EXIF-rotates it, downscales to 512px and re-encodes as JPEG — so the
value that reaches the renderer is always something this process produced.
That drops embedded payloads, absurd dimensions and anything that is not an
image. There is a size guard *before* base64-decoding, so a 50 MB string does
not become a 37 MB bytes object first.

Verified: a 1200×1600 PNG → 1,943-char JPEG data URI. A URL, malformed base64,
an SVG with an onload handler, and `None` all → rejected.

**One deliberate difference from the extraction path:** it skips
`_looks_like_a_photograph()`. That heuristic exists to pick a headshot out of a
PDF full of logos and icons; here the user has explicitly said this file is
their photo, and a portrait on a flat studio backdrop scores like a logo.

**The five portrait templates are no longer upload-only.**

---

## Item 7 — already done, and my previous report was wrong about it

**`agents/match_scorer.py:146`:**

```python
is_arabic = str(state.get("ui_language") or state.get("cv_language", "en")).lower().startswith("ar")
```

**It already follows the page language**, falling back to the CV's. Commit
`6ab7cb7` — *"feedback in the reader's language"* — did this.

My Section 12a note last session said it followed the CV language. **I read a
stale comment in the prompt instead of the code**, which is the exact mistake
your own project rules warn about. Correcting it here rather than quietly.

**So `reason_ar` / `how_to_close_ar` would buy one thing only:** a user who
generates a CV with the dashboard in English and *then* switches to Arabic
still sees the stored English text, because the language is fixed at
generation time. Fixing that means storing both languages — a schema change,
two new columns, and roughly 40% more output tokens on every match-score call.

**I have not done it**, because the premise you were given was wrong and the
remaining case is narrower than it sounded. It is real for a bilingual
audience — your call whether it is worth the columns.

---

## Item 9 — noindex

**Done, and `robots.txt` alone was never enough.**

`robots.txt` already disallowed `/dashboard`, `/login`, `/signup`,
`/forgot-password`, `/reset-password`. **Disallow is not noindex.** It stops a
crawler *fetching* a URL; it does not stop the URL being *indexed* — Google
lists disallowed URLs it finds linked elsewhere, with no title and "no
information is available for this page" where the description should be. Thin
results carrying your site's name, competing with the pages meant to rank.

The two also interfere: a crawler blocked by `robots.txt` never fetches the
page, **so it never sees a noindex tag.**

- `/dashboard` declares `robots: { index: false, follow: false, nocache: true }`
  on its **layout**, so every nested route inherits it and a new page cannot
  forget.
- The four auth flows get a `layout.tsx` each — their pages are Client
  Components, and Next only reads a `metadata` export from a Server Component.
- `robots.ts` now documents the distinction, so the next person does not
  "tidy up" one of the two mechanisms.

**On the public CV-creation entry point you asked about:** I have not built it,
because it is a product and content decision rather than a code one, and it
needs a real page written around it. My recommendation on the URL: **`/build-cv`
(EN) and `/انشاء-سيرة-ذاتية` or `/build-cv?lang=ar` under the existing `[lang]`
segment** — sitting beside `/pricing` and `/guides` rather than under
`/dashboard`, so it inherits the marketing layout, the SEO metadata and the
sitemap the dashboard is deliberately excluded from. Tell me the copy you want
on it and I will build it.

---

## Item 5 — Arabic PDF: DOCX line shipped, diagnosis reopened

### Your split is correct, and it explains why seven fonts failed

You were right that these are **two different bugs in two different
renderers**, and that treating them as one is why the font search went nowhere.

| Path | Renderer | Failure | Cause |
|---|---|---|---|
| Cover letter | ReportLab | text layer is presentation forms (U+FB50–FEFF) | `arabic_reshaper` + `python-bidi` run **before drawing** |
| CV | WeasyPrint | standard codepoints, letters transposed | ToUnicode / cluster mapping |

**No font can fix the cover letter.** Confirmed by reading the path:
`_shape_arabic()` reshapes and bidi-reverses the string, and ReportLab then
draws *those* glyphs — so the presentation forms are what get written into the
text layer. The font is not consulted about it. Changing the font changes the
glyphs and not the codepoints.

**`/ActualText` was ruled out on the premise that a font swap would work. It
has now been tried across seven fonts and did not.** The premise is gone. On
the numbers I measured — IBM Plex 7/15, Amiri 14/15, every Noto 0/15 — no
available font gets to clean, so an explicit ToUnicode/ActualText mapping is
the only remaining route. **Reopened, not implemented:** it touches both
renderers and it is not launch work.

### What I did ship

**A runtime environment report**, which is the other half of what you asked
for — *"verify WeasyPrint's version at runtime in production, not from
requirements.txt."*

`render_environment_report()` / `log_render_environment()` in
`utils/pdf_generator.py`, called at startup. One line in the Render log on
every deploy:

```
🖨️  Rendering: weasyprint=69.0 arabic_shaping=True reportlab_arabic_font=True
```

and a loud error for each of the three things that otherwise fail **silently**:

- **`arabic_reshaper` / `python-bidi` missing** — they sit behind a
  `try/except ImportError`, so a failed wheel does not crash. It renders Arabic
  cover letters as unjoined isolated letters, legible as a bug only if you know
  what joined Arabic looks like.
- **WeasyPrint older than 69.0** — where the RTL cluster-mapping fix landed. A
  build that resolved something older, or a system install shadowing the wheel,
  produces exactly the transposition signature you quoted.
- **A missing Arabic font asset.**

**Locally it reports 69.0 with shaping available**, so the transposition is
*not* a version problem here — which is worth knowing, because it means the
remaining CV-side corruption is genuinely the ToUnicode issue and not a stale
install. **Check the same line in Render's log** to confirm production matches.

**The DOCX recommendation is not shipped as copy yet.** The §12c format dialog
already disables Word for cover letters (there is no endpoint) and offers both
for CVs. Adding *"for Arabic, Word keeps the text readable to applicant
tracking systems"* is one string in two languages — **tell me the wording you
want and it goes in**, since this is user-facing copy and the tone rules are
yours.

---

## Item 10 — Pricing Reference v7

**Written: `prompts/pricing-reference-v7.md`.**

It records every decision from this document — single model across all tiers,
free tier at 3 credits with the automatic match gated, Job Search metered with
its own cap, the pack-buyer entitlement — and it has the two things v6 was
missing: **a Tavily section** and **Job Search as a costed feature**.

The headline numbers:

| | v6 | **v7** |
|---|---|---|
| Cost basis | 0.75 SAR/credit (model only) | **0.28 SAR/credit** — 86% of it Tavily |
| Arabic vs English | "the same" | **1.76× on the model** |
| Pro margin, worst case | 22% | **64%** |
| Elite margin, worst case | 26% | **66%** |
| Tavily | absent | **§1.1 and §5** |
| Job Search | absent | **costed, capped, in the margin tables** |

**The worst-case table is the one that matters.** Before the cuts and the
metering, an Elite subscriber who spent everything on Job Search cost **164 SAR
against 99 in revenue — a −66% margin, from one subscriber in one month.** With
Job Search on its own cap it is 23.50 SAR and a 76% margin. That cap is not
tidiness; it is the thing that makes the design safe.

**Left open in v7, honestly marked:** Gemini extraction is still unmeasured
(needs a machine that can reach it), LinkedIn generation is still unmeasured
(needs a paid purchase row), and the `basic` vs `advanced` search-depth test is
still unrun (needs 30 Tavily credits).
