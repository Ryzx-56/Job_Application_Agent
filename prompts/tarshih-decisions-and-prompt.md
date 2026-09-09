# Tarshih — Decisions & Next Prompt

Answers to the seven decisions in the execution log, plus five items the log
didn't raise. Part 3 is the prompt — copy it back to Claude Code as one message.

---

## Part 1 — The seven decisions

### 1. Ship Section 9's search cuts? — **YES, plus one more**

Ship A–E. Then add the cut that wasn't proposed:

**Every Tavily call currently uses `search_depth='advanced'` (2 credits).
`basic` is 1 credit.** Verified against Tavily's own credit documentation.
Since the LLM screener does the relevance filtering and only titles, snippets
and links are consumed, advanced extraction may be buying nothing.

| | Today | After A–E | **A–E + basic depth** |
|---|---|---|---|
| Typical search | 72 credits | 16 | **8** |
| Worst case | 144 credits | 32 | **16** |
| Per-CV automatic match | 8 | 8 | **4** |

Test basic against advanced on ten real searches before committing — if result
quality holds, it halves everything in one parameter.

### 2. Make the per-CV job match on-demand? — **YES**

Highest-leverage change available and it degrades nothing. A "Find matching
jobs" button instead of an unconditional graph node. Anyone who wants the
results still gets them.

### 3. Free tier — 2 credits or 3? — **3, but the figure behind the question is wrong**

The log's "0.72 SAR at 3 credits" is **model cost only**. Appendix A says so
explicitly: *"None of these figures include Tavily."* A free user generating 3
CVs also triggers 3 automatic job matches = 24 Tavily credits = **0.72 SAR of
Tavily**, doubling the real cost to ~0.76 SAR.

**So the credit count is the wrong lever.** Gate the automatic job match for
free users (decision 2 makes this trivial — free users simply don't get the
button) and a 3-credit free user costs roughly **0.04 SAR**, not 0.76.

**Keep 3 credits, gate the match.** Cutting free credits is the change most
likely to hurt conversion, and it was being considered to solve a cost problem
that is 95% Tavily.

### 4. What does a credit-pack buyer unlock? — **Feature access while they hold credits**

Right now someone pays 38 SAR and stays `tier = 'free'`, gated out of Job
Search, Interview Prep and LinkedIn Essential. That is a refund request waiting
to happen and it blocks selling packs at all.

**Recommendation:** introduce an entitlement separate from `tier` — "has
purchased credits remaining" unlocks the gated features. When
`purchased_credits` reaches zero they revert to free gating.

Why this rather than granting a tier: a pack is not a subscription, so it
shouldn't confer a subscription's recurring monthly allowances. But someone who
paid should be able to spend what they bought on whatever they want, which is
the whole premise of pay-as-you-go. Access while in credit, no recurring
allowance, no expiry beyond the credits themselves.

### 5. Does the Arabic PDF text layer block launch? — **No, ship the DOCX line — but reopen the fix**

Agreed it doesn't block launch. The PDF is visually perfect, DOCX is clean, and
one line of copy in the §12c format dialog solves the user's real problem today.

**But the diagnosis needs reopening, for two reasons.**

**These are two different bugs in two different renderers.** Treating them as
one is why seven fonts failed:

| Path | Renderer | Failure | Cause |
|---|---|---|---|
| Cover letter | ReportLab | Text layer is presentation forms (U+FB50–FEFF) | `arabic_reshaper` + `python-bidi` run **before drawing**, so reshaped glyphs are what gets written |
| CV | WeasyPrint | Standard codepoints, letters transposed | ToUnicode / cluster mapping |

**No font can fix the cover letter.** Pre-reshaping is the cause. That path
needs either a renderer that shapes internally (pass logical text) or an
explicit ToUnicode/ActualText mapping back to standard Arabic.

**`/ActualText` was ruled out because the font swap was expected to work.** It
has now been tried across seven fonts and failed. The premise for ruling it out
is gone — reopen it.

**Also verify WeasyPrint's version at runtime in production**, not from
`requirements.txt`. The transposition signature (`المهني` → `المهين`, `في` →
`يف`) matches the RTL cluster-slicing bug that was fixed in 69.0 — if the
deployed version is older than the local one, that alone could be the CV half.

### 6. Photo field on the manual CV flow? — **YES, permission granted**

Add the field to `ManualCVRequest`, set `candidate_photo` in both manual
endpoints, reuse the existing `cv_photo` validation. Five portrait templates
being upload-only is a real product limitation and the API contract change is
small.

Keep the warning that was built — it's still the right behaviour for someone
who picks a photo template and doesn't upload anything.

### 7. Generate `reason_ar` / `how_to_close_ar`? — **YES**

Page-language consistency has been a repeated complaint, and at 76× cheaper per
call the reason not to was cost. It isn't a cost decision any more.

---

## Part 2 — Five things the log didn't raise

**1. The free-tier cost figure counts no Tavily.** See decision 3. This is the
exact error the log spends five sections warning about, reproduced in its own
recommendation.

**2. `search_depth='advanced'` is 2 credits; `basic` is 1.** Not in cuts A–E.
Halves every Tavily line in the document.

**3. Don't let Google index `/dashboard/*`.** A logged-out dashboard is a thin
page that ranks for nothing and dilutes the site's authority. Put `noindex` on
authenticated routes; give the public CV-creation flow its own URL with real
content around it and let that carry SEO.

**4. Tavily may be the wrong tool, not just an expensive one.** It's priced for
AI research agents doing content extraction. You want links, titles and
snippets, then screen them yourself. Worth pricing alternatives on
cost-per-search after the cuts ship — at 1,000 users the gap is thousands of
dollars a month. Not a launch blocker.

**5. `CRON_SECRET` is a silent single point of failure.** Without it matching
the repo secret, no subscription renews and nothing errors — the endpoint just
503s. It belongs on the go-live checklist next to the keys, not below them.

---

## Part 3 — The prompt

Copy everything below this line into Claude Code as one message.

---

Decisions on all seven, plus five additions. Work through them in this order —
the Tavily items first, since §15 can't be written without them.

**1. Ship Section 9's cuts A–E.** Then add the cut you didn't propose: every
Tavily call uses `search_depth='advanced'` at 2 credits, and `basic` is 1
credit. The LLM screener does the relevance filtering and only titles, snippets
and links are consumed downstream, so advanced extraction may be buying nothing.
**Test basic against advanced on ten real searches, report the quality
difference, and if it holds, switch.** That halves every Tavily figure in your
document — worst case goes 144 → 32 with A–E → 16 with basic.

**2. Make the per-CV job match on-demand.** Replace the unconditional
`jobs_finder` graph node with a "Find matching jobs" button on the results page.

**3. Free tier stays at 3 credits — and your 0.72 SAR figure is model-only.**
Appendix A says so itself. A 3-credit free user also triggers 3 automatic job
matches = 24 Tavily credits = 0.72 SAR, so the real cost is ~0.76 SAR, not 0.72.
**Gate the automatic job match for free users entirely** (item 2 makes this
trivial — they don't get the button), which takes a free user to roughly 0.04
SAR. Recalculate and confirm.

**4. Credit-pack buyers get feature access while they hold credits.** Introduce
an entitlement separate from `tier`: having `purchased_credits > 0` unlocks Job
Search, Interview Prep and LinkedIn Essential. When credits hit zero they revert
to free gating. A pack is not a subscription, so no recurring monthly allowance
— but someone who paid must be able to spend what they bought. This unblocks
selling packs.

**5. Arabic PDF — ship the DOCX recommendation now, and reopen the fix.**

Ship the one-line copy in the §12c format dialog recommending DOCX for Arabic
ATS submissions. That's the launch-blocking part and it's done.

Then reopen the diagnosis, because **these are two different bugs in two
different renderers and treating them as one is why seven fonts failed:**

- **Cover letter (ReportLab):** the text layer is presentation forms because
  `arabic_reshaper` + `python-bidi` run *before drawing*. **No font can fix
  this** — pre-reshaping is the cause. It needs either logical text passed to a
  renderer that shapes internally, or an explicit ToUnicode/ActualText mapping.
- **CV (WeasyPrint):** standard codepoints, transposed letters.

**`/ActualText` was ruled out because the font swap was expected to work. It
didn't. The premise is gone — evaluate it properly now**, for both renderers,
and tell me the real cost of implementing it.

**Also: verify WeasyPrint's version at runtime in production**, not from
`requirements.txt`. The transposition signature (`الملخص المهني` → `الملخص
المهين`, `في` → `يف`) matches the RTL cluster-slicing bug fixed in 69.0. If the
deployed version is older than your local one, that alone may be the CV half.

**6. Add the photo field to the manual CV flow — you have my permission for the
API contract change.** `ManualCVRequest` gains the field, both manual endpoints
set `candidate_photo`, reuse the existing `cv_photo` validation. Keep the
warning you built for the case where someone picks a photo template and uploads
nothing.

**7. Generate `reason_ar` / `how_to_close_ar`** so My Resumes follows page
language. The reason not to was cost, and that reason is gone.

**8. Add the hard Tavily quota guard before launch.** Three layers: per-search
(the cuts above), per-user monthly metering using the same pattern as the other
add-ons, and a platform-wide monthly ceiling that degrades gracefully — serve
from history, show an honest "search unavailable" message — rather than
returning empty pages that look broken. You called this the real launch blocker
and I agree.

**9. Put `noindex` on `/dashboard/*` and every authenticated route.** A
logged-out dashboard is a thin page that ranks for nothing. Separately, tell me
what the public CV-creation entry point's URL should be so it can carry real SEO
content — that's the page I want people landing on from ads and shared links.

**10. Then write Pricing v7**, now that decisions 1–4 are settled. It must
record: single model across all tiers, a full Tavily section (per-feature credit
consumption, the monthly platform ceiling, required plan at 100/500/1000 users),
Job Search as a metered Pro/Elite feature with its own cap, the pack-buyer
entitlement, free tier at 3 credits with the automatic match gated, and margin
tables built on the 0.28 SAR/credit basis **including Tavily** — not on a
scaled-down v6.

**Before you push:** I'll take the manual Supabase backup. Tell me when you're
ready and don't push until I confirm it's done.

**Still mine to do, don't wait on them:** the manual logged-in pass, Lighthouse
on a real device, and the live Moyasar keys.
