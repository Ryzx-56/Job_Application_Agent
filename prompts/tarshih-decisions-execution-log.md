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
