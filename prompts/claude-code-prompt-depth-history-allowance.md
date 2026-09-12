# Addendum task: search depth test, Job Search history, allowance bump

Companion to `claude-code-prompt-credit-addons.md`. **Do part 1 first and report
back before touching parts 2 and 3** — part 1's result changes the numbers in
part 3.

Cost basis is `pricing-reference-v7.md`. Tavily is the only search provider;
production is Tavily-only and `SEARCH_PROVIDER` still defaults to `'serper'` in
code, which is a known trap — see §5 of that doc.

---

## Part 1 — Settle the `basic` vs `advanced` search depth question

### What this is

`search_depth='advanced'` costs **2 Tavily credits per call**; `basic` costs
**1**. Search is roughly 95% of this product's variable cost, so this single
parameter is worth more than every other optimisation combined. It is a
per-request API parameter, not an account setting — no Tavily dashboard change
is involved.

`backend/tools/tavily_depth_test.py` already exists and costs ~30 credits to
run. **Do not switch anything yet. Run the test and report.**

### Why the existing script is insufficient

The current script compares returned URL sets (`b_only` / `a_only`). That only
answers "does basic find the same jobs?" The actual reason the switch was never
made is different and is recorded in `pricing-reference-v7.md` §1.1: the
`content` field returned by Tavily also feeds the **dead-listing filter** and the
**scam filter**. `basic` returns shorter content. If content gets thinner, those
filters can degrade *silently* — you'd ship expired and fraudulent job postings
to paying users and see no error anywhere.

URL parity is necessary but not sufficient. Extend the test.

### What to do

1. Read `backend/tools/tavily_depth_test.py` and report what it currently
   measures.

2. Extend it so that for the same set of queries, at both depths, it records:
   - the URL sets (keep the existing `b_only` / `a_only` comparison)
   - `content` length distribution per result — min, median, max
   - **the actual decision output of the dead-listing filter and the scam
     filter**, run against both result sets, per listing
   - any listing where the two depths produce a *different filter decision*

3. Use a query set that is representative, not convenient: a mix of exact-match
   titles and titles that trigger the adjacent-title fallback, across the
   priority / trusted / Saudi-aggregator / open-web lanes.

4. Run it. Report a table with:
   - URLs found only by advanced (the headline number)
   - filter decision disagreements, listed individually with the URL
   - median content length at each depth

### The decision rule

Switch to `basic` **only if both** hold:
- advanced returns no material URLs that basic misses, and
- **zero** filter decision disagreements

If there are any filter disagreements, do not switch, and report which filter
broke and on what input. A third option exists if the results are mixed — use
`basic` on the high-volume lanes and keep `advanced` where the filters actually
depend on content. Propose this if the data supports it; don't implement it
unprompted.

Put the switch behind a config flag (`SEARCH_DEPTH`, defaulting to current
behaviour) so it can be reverted without a deploy, the same way the Serper
migration was.

**Report results and stop. Do not proceed to parts 2 and 3 until I confirm.**

---

## Part 2 — Job Search history and result caching

### The problem

The per-CV `find-jobs` button is already idempotent — `find_jobs_for_resume` in
`core/documents.py` returns existing results from `similar_jobs` at zero cost, so
double-clicking doesn't double-charge.

**The standalone Job Search page (`/api/v1/job-search`, `search_jobs_by_title` in
`core/job_search.py`) has no equivalent.** A user who runs a search, navigates
away, and comes back pays 24–36 Tavily credits again for results that were
already fetched. This is pure waste on the product's single largest cost line.

First confirm this by reading the code — if some persistence already exists,
report what it is before building anything.

### What to build

**Persistence.** Every standalone search stores: user id, the normalized query
key, the raw query as the user entered it, the full result set, the depth used,
the Tavily credits consumed, and a timestamp. Follow whatever pattern
`similar_jobs` already uses for the per-CV flow — don't invent a second one.

**Normalized cache key.** Hash of: lowercased and whitespace-collapsed job title,
sorted filter values, location. Two users searching the same thing should be
treated as the same key for *their own* history only — do not share cached
results across users unless you flag that decision to me first, since it has
privacy implications I haven't decided on.

**TTL of 48 hours.** Within the TTL, an identical query returns the stored
results and:
- consumes **zero** Tavily credits
- consumes **zero** Job Search allowance
- consumes **zero** user credits
- fires no Tavily request at all

**UI.** The results view shows the age of the results ("found 6 hours ago") and a
**Refresh** button. Refresh is the *only* path that costs allowance or credits,
and it must go through the same explicit confirmation flow as any other paid
action. Never auto-refresh on page load, on focus, or on navigation.

**History list.** A user can see their past searches and reopen any of them.
Reopening is always free regardless of age — if the results are past TTL, show
them with a clear staleness marker and the Refresh option, rather than hiding
them or silently re-fetching.

**Retention.** Keep the last 20 searches per user, or 30 days, whichever is
larger. Prune on write, not on a cron.

### Instrumentation

Log cache hit rate. This is the number that tells us how much this saved and it
should be visible in `admin_stats.py` alongside the cost figures. Also record
the Tavily credits *avoided* by cache hits — that's the line that justifies this
work.

### Do not break

- The Tavily `/usage` pre-flight must still run before any live search. A cache
  hit should skip it entirely (nothing is being spent).
- Credit deduction and search execution stay atomic. A cache hit deducts nothing.
- The per-CV `find-jobs` idempotency must keep working exactly as it does now.

---

## Part 3 — Job Search allowance increase

**Conditional on part 1.** Apply the column that matches the test result.

| Tier | Current baseline | If depth switch lands | If it does not |
|---|---|---|---|
| Free | 0 | 0 | 0 |
| Pro | 4 | **6** | 5 |
| Elite | 12 | **15** | 13 |

Purchase cap stays equal to baseline (a user can at most double their monthly
job searches by spending credits). Job Search stays at 5 credits.

Rationale: job searching is a weekly-or-more activity and 4/month is the
under-delivered part of the Pro tier. The larger increase is only affordable if
per-search cost halves.

After changing the numbers, re-run the worst-case margin computation in
`admin_stats.py` and report the new per-tier figures. Flag immediately if Pro's
worst-case margin lands below 65% — that's the floor, and if the numbers say we
crossed it, the allowance comes back down rather than the floor moving.

Update the landing page pricing section, the plan comparison table and the
dashboard to reflect the new allowances, in **both English and Arabic**.

---

## Deliverable

For part 1: the test results table and your recommendation, then stop.

For parts 2 and 3: tests covering cache hit / miss / expiry, that a cache hit
consumes no allowance and no credits, that Refresh does consume them, that
history reopening is always free, and the new allowance caps. Then a summary of
every constant changed, every file touched, and the measured cache hit rate if
you have enough data to estimate one.
