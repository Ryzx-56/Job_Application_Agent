# Prompt — send as one message, with `tarshih-copy-and-page.md` attached

---

**Live payments work.** I bought a pack with my own card from my own bank
account, the money left my account, the credits landed, and the success page
rendered in Arabic. The whole Moyasar stack is closed — keys, webhook, 3DS,
crediting. Nothing more needed there.

Five things. Item 5 is the big one.

---

**1. Ship the DOCX-for-Arabic copy** in the §12c download dialog, from the
attached file. Show it only on Arabic CVs — on an English CV it isn't true and is
just noise. A short line under the Word option, not a warning banner. Use the
wording as written; don't reword it into anything that reads as an admission the
PDF is broken, because for a human reader it isn't.

**2. Build the `/build-cv` page**, URL as you recommended — under the existing
`[lang]` segment beside `/pricing` and `/guides`, marketing layout, in the
sitemap. Full copy in both languages is in the attached file. Use it as written
and tell me if any claim doesn't match what the product actually does.

Two structural requirements:

- **The CV form is on this page**, not behind a link to it. Someone arriving from
  Google starts typing immediately; the account wall appears at Generate, using
  the deferred-signup behaviour already built.
- **"Three CVs free" must read from `FREE_TIER_CREDITS`**, not be hardcoded. It's
  a pricing claim on a public page and it cannot be allowed to drift.

**3. Add Dependabot ignore rules** in `.github/dependabot.yml` for the two
branches you rejected — `websockets` (breaks `google-genai` and Supabase
`realtime`) and the `python-minor-patch` group. Comment each with the reason so
the next person knows why before removing it. I'll close the open PRs myself; the
rules are so they don't come back next month.

**4. `CRON_SECRET` is confirmed identical** in Render and the repo secret.
Nothing to do.

---

**5. Migrate job search from Tavily to Serper. I've decided — build it.**

The numbers: Serper is **$0.001/search** against Tavily advanced at **2 credits ×
$0.008 = $0.016 per call**. That's 16× cheaper. Serper's free tier is **2,500
searches/month** against Tavily's 1,000 credits, which at 2 credits a call is
effectively 500 — so 5× more free calls too.

With cuts A–E already shipped at 12 calls per typical search, that's roughly
**208 free searches a month on Serper against 41 on Tavily**, and beyond the free
tier it's about $0.012 per search instead of $0.192.

**Do not run `tools/tavily_depth_test.py`.** The basic-vs-advanced question is
moot if we're leaving Tavily — don't spend credits testing a provider we're
migrating off.

**Build it the way you built the Luna migration**, because that worked:

- **Keep both providers behind one switch.** A `SEARCH_PROVIDER` constant in
  config, env-overridable so I can revert from the Render dashboard without a
  deploy. Both paths maintained, no agent holding a provider name.
- **Provider-neutral names throughout.** `TAVILY_CREDITS_PER_CALL`,
  `tavily_call_counter`, `tavily_credits_remaining`, `assert_tavily_headroom`,
  `TavilyQuotaExhausted` — all of these bake a vendor into the codebase. Rename
  them the way `generate_claude_text` became `generate_writing_text`. The next
  swap should be a config change, not a refactor.

**What actually needs solving, and I want these reported before you finish:**

- **The four domain lanes.** They use Tavily's `include_domains`. Serper uses
  Google's `site:` operator. Check how many `site:` terms Google accepts in one
  query before it degrades — if the priority/trusted/aggregator lists are too long
  to OR together, the lane structure may need rethinking rather than translating.
- **The three filters that read `content`.** `_looks_like_listing_or_category_page`,
  `_looks_closed` and `_looks_like_scam` all read Tavily's extracted page content.
  Serper returns a Google snippet, which is shorter. **This is the main quality
  risk in the migration** — these filters keep dead and fraudulent postings off
  the page. Test them against real Serper responses and tell me honestly whether
  they still work, get weaker, or need a different signal.
- **Google's Jobs vertical.** Check whether Serper exposes it. Structured job data
  — title, company, location, posted date, apply link — would be a better input
  than raw web results, and might let us drop the Gemini screener entirely. That's
  a quality *and* cost win if it's available with decent Saudi coverage.
- **The quota guard, layer 3.** It currently reads Tavily's `/usage` endpoint,
  which was the right call because it's authoritative across restarts and
  instances. Find out whether Serper has an equivalent. If not, tell me what
  replaces it — I don't want to go back to a silent empty-results page, which is
  the failure mode that was live for real users last week.
- **Keep cuts A–E.** They're about call count, and call count still costs money at
  any per-call price.

**Test before switching, and don't break it silently.** Job search is a feature
Pro and Elite subscribers pay for, and I now have live payments — a broken search
costs real customers. Keep the honest-failure message; an empty results page that
reads as "there are no jobs for you" is the worst available version of any failure
here.

**Then update Pricing v7.** The Tavily section becomes a search-provider section
and every figure in it changes — per-feature cost, the monthly platform ceiling,
the required plan at 100 / 500 / 1000 users, and the margin tables. Tell me what
the new numbers are.

I'll add `SERPER_API_KEY` to Render when you tell me you're ready for it.
