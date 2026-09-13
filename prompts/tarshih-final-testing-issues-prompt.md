# Tarshih — final pre-launch testing pass: real issues found

Copy everything below into Claude Code as one message. This is the last check
before launch and touches CV generation, ATS scoring, Arabic quality, job
search, and the dashboard — run on Opus at high effort. Where an item says
"investigate first," report what you find before changing behavior; don't
guess-fix a scoring or quality issue the way you'd fix a config bug.

---

I ran a full manual test pass. Real problems below, grouped by priority.
**Nothing here should break what's currently working** — where a fix is risky
relative to its value, say so and I'll decide, don't just push it through.

## Tier 1 — real bugs, fix these

### 1. Arabic CV: job titles and skills are mirrored wrong
Job titles currently render on the left, skills on the right. For Arabic RTL
this is backwards — titles should be on the right, skills on the left. Also,
the bold sub-heading text under each section is sitting on the left side; it
should be directly under the section heading, right-aligned with it. Applies
to **both** the upgrade-CV flow and the from-scratch flow — check both code
paths, don't assume a shared component means one fix covers it.

### 2. Photo missing on from-scratch CVs with a photo template
Uploading a photo and selecting a photo template in the **from-scratch**
flow doesn't render the photo in the output. The manual/upgrade flow's photo
field was fixed earlier this month — check whether from-scratch uses a
different code path that this fix never reached.

### 3. Job search history — a raw error string is showing in production
The job search page shows the literal text "Could not load your search
history right now" to users — that's an internal fallback message leaking
through, not a real empty state. Find out why the history fetch is actually
failing and fix the root cause; if it can legitimately fail sometimes, that
state needs real UI (a retry option, not a bare sentence sitting under the
form).

### 4. Job search history — needs the actual interaction, not just a list
Each history entry should show the job title that was searched, and clicking
it expands (accordion-style) to show the jobs found in that search with their
links — not just a flat list of past queries. Build this properly rather than
leaving it as metadata-only.

### 5. Job search relevance and volume have regressed badly
Searching "IT Support" returns only 2 exact matches + 1 "close" result — it
used to return around 13. I want roughly 10 total (exact + similar combined)
as the target, not a hard minimum. Separately, searching "IT support
internship" returned only 1 real internship, plus an Electrical Engineer
listing marked as a "strong match" and a Data Analyst listing — both clearly
wrong for that query. Investigate whether this month's cuts (A–E,
`ADJACENT_EXPANSION_THRESHOLD=1`, `ADJACENT_TITLES_MAX=2`,
`ADJACENT_USES_OPEN_LANE=False`) went further than intended and are now
starving results and/or mislabeling unrelated adjacent-title fallback results
as strong matches. Rebalance so relevant volume comes back up without
reverting the cost work outright — report what you change and why, and what
it does to the per-search credit cost.

### 6. Arabic cover letter reads like a translation, not native writing
Described as barely readable. Find the actual generation prompt/logic for the
Arabic cover letter and check whether it's writing in English internally and
translating, versus generating directly in Arabic. If it's translating, fix
it to generate natively in Arabic from the start — same standard the CV
generation itself is held to.

### 7. Arabic CV's ATS score is far below the English CV's for the same content
39% English vs 17% Arabic, same underlying CV info. Investigate whether the
scoring logic has an Arabic-specific bug — keyword matching against an
English wordlist, tokenization/reshaping interfering with the check,
whatever it turns out to be — and fix the actual defect. Report what you find
even if the cause turns out to be legitimate (e.g., the JD itself being in
English against an Arabic CV) rather than a bug.

## Tier 2 — investigate and report; don't just move the number

### 8. Overall ATS scores are much lower than comparable tools
Same CV scored 39% on our site, 66–89% across several other ATS-checker
sites. Before changing anything: read through the actual scoring rubric/
weights and compare its methodology against how ATS-compatibility is
typically scored (keyword match, formatting, section detection, parse-ability,
etc.). Tell me honestly whether ours is miscalibrated (too harsh a penalty
somewhere, a scoring bug, a normalization error) or whether it's legitimately
stricter and more accurate than the comparison sites — those tools vary
wildly in what they actually check. **Do not just raise the number to look
competitive without a real reason** — that would be the same kind of fake
"honest failure" this whole month was about, just in the product this time
instead of the code. If you find a genuine calibration bug, fix it and show
me the before/after on the same test CV.

### 9. Upgrade-CV vs from-scratch CV give different scores for near-identical input
Same person's info, ~same content: 58% match / 39% ATS via the upgrade-CV
path, 47% match / 45% ATS via from-scratch. Investigate why these two
generation paths diverge — different prompts, different scoring inputs,
genuinely different output quality — and report which it is. These don't need
to produce identical output, but a large, unexplained gap between two paths
for the same product suggests one of them isn't working as intended.

## Tier 3 — UI additions

### 10. Show remaining generations before the user commits
On the Job Search, Interview Prep, and LinkedIn Essential pages, before
generating, show the user's remaining count this month as "N/M" — pull it from
the `/api/v1/addons/summary` endpoint that already exists. Color it by
remaining proportion: blue/green when comfortable, yellow when low, red at
zero (meaning the next action requires spending credits, which the existing
confirmation dialog already handles).

### 11. Onboarding tour — confirm new users see it, and reset it for everyone existing
This extends what I asked for already: I still haven't seen it on my account
and have no spare email to test a fresh signup with. Confirm, with an actual
test (a real signup if you can simulate one, not a code read), that a
brand-new account sees the tour. Then reset the "has seen onboarding" state
for **every existing account**, not just mine, so current users get it the
first time they log in after this ships. If a broken "has seen it" check was
the root cause, fix that too so this doesn't regress the next time someone
signs up.

## Tier 4 — low priority, best effort only

### 12. Page overflow creates an awkward near-empty extra page
Both English and Arabic CVs, both generation paths. If it's straightforward:
shrink text slightly or trim word count to avoid spilling one paragraph onto
a mostly-empty extra page. If that's risky or invasive, skip the aggressive
fix and just add proper spacing so content on a forced new page doesn't start
flush against the top — cosmetic, not currently blocking anything. Explicitly
your call whether to skip this one if it risks touching stable layout code.

## Report

For each of the 12 items: what you found, what you changed (or didn't, and
why), and for items 5, 8, and 9 specifically — show your actual investigation,
not just a conclusion. Flag anything where a fix meaningfully changes cost
(Tavily credits, model calls) so I can see the tradeoff before this goes live.
