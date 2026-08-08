# agents/jobs_finder.py
import json
import os
import re
import concurrent.futures
from collections import Counter

from tavily import TavilyClient
from loguru import logger
from core.state import AgentState
from core.credits import get_admin_client
from core.llm_config import generate_gemini_json

# Priority job board — Jadarat is Saudi Arabia's national employment
# platform (jadarat.sa), general-purpose across public and private sector.
# (Ajeer was considered but dropped — it's specifically for temporary/
# seasonal staffing, not a general job board, and would've mostly added
# noise for a typical full-time search.)
PRIORITY_DOMAINS = ['jadarat.sa']

# Curated allowlist, not an open web search — deliberate choice. An
# unrestricted search for "job openings" surfaces a real amount of scam/
# phishing listings (fake-recruiter pages, "pay a fee to start" postings,
# clone sites impersonating real companies); Tavily's search has no notion
# of "trustworthy job board" without being told which domains to trust.
# Every candidate here is a well-established board verified as of this
# writing (Aug 2026) to be legitimate, not a paid-access site (excludes
# e.g. FlexJobs, which screens listings but paywalls them from a candidate
# without their own subscription), and either global or specifically
# relevant to a Gulf/Saudi candidate base:
FALLBACK_DOMAINS = [
    # Major global boards
    'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com',
    # ATS platforms — these host real companies' own postings directly
    # (not third-party aggregation), which makes them low scam-risk by
    # construction: you can't fake-post to someone else's Greenhouse/
    # Workday instance the way you can spin up a generic scam page.
    'lever.co', 'greenhouse.io', 'myworkdayjobs.com', 'smartrecruiters.com', 'icims.com',
    # Gulf/MENA-focused — matters for a Saudi-based candidate base; Bayt is
    # the largest job portal in the MENA region, the others are established
    # Gulf/Saudi-specific or pan-Arab boards.
    'bayt.com', 'gulftalent.com', 'naukrigulf.com', 'mihnati.com', 'wuzzuf.net', 'tanqeeb.com',
]

# Content-based scam signal, applied to EVERY listing regardless of which
# domain it came from (including Jadarat and the curated list above) — a
# domain allowlist reduces risk but doesn't guarantee every posting on a
# legitimate platform is itself legitimate (third-party recruiters can post
# scam listings on real boards too). This is the common language used by
# job-scam-detection guides: upfront payment requests, off-platform contact
# demands, and "too good to be true, no vetting" framing.
_SCAM_SIGNALS = [
    "processing fee", "registration fee", "training fee", "pay to apply",
    "pay a fee", "refundable deposit", "wire transfer", "western union",
    "send your bank details", "no interview required", "no experience needed, earn",
    "guaranteed income", "earn $$$", "contact us on whatsapp only", "telegram only",
    "قم بدفع رسوم", "رسوم تسجيل", "رسوم تدريب", "لا تحتاج إلى مقابلة", "دخل مضمون",
]

# Final number of listings returned to the user.
RESULT_CAP = 5

# How many raw candidates to pull per search before quality-filtering trims
# them down to RESULT_CAP. Needs headroom since noise/closed/off-topic
# results get dropped AFTER the fact, not before — asking Tavily for
# exactly RESULT_CAP and then filtering could leave us with far fewer than
# 5 even when good matches existed but didn't make the initial cut.
#
# 10 -> 20: with only 10 raw results per board, the post-filters routinely
# left 2 survivors (exactly what the reported run showed: "Found 2 matching
# job listings ... 0 good from Jadarat, 0 good from fallback"). The filters
# below are now stricter, not looser, so the candidate pool has to grow to
# compensate or the list gets shorter still.
RAW_FETCH_LIMIT = 20

# Tavily's time_range. 'week' was too tight to fill RESULT_CAP: a niche role
# in one city simply doesn't have 5 postings crawled in the last 7 days, and
# every result that didn't make the window was invisible regardless of how
# good a match it was. A month-old posting is usually still open, and the
# _CLOSED_SIGNALS check below is what actually filters stale ones.
SEARCH_TIME_RANGE = 'month'

# Signals that a listing Tavily surfaced is no longer actually open. Tavily's
# time_range='week' filters by crawl/publish date, not live status — a
# posting crawled 3 days ago can still have been filled or pulled since. A
# full guarantee would need a live fetch per URL (extra latency + API cost
# per listing); this is a cheap first pass using the content Tavily already
# fetched. Not perfect, but catches the common "closed" boilerplate most job
# boards render on an expired listing page.
_CLOSED_SIGNALS = [
    "no longer accepting applications", "position has been filled",
    "this job is no longer available", "job posting has expired",
    "vacancy is closed", "applications are closed", "this listing has expired",
    "لم تعد هذه الوظيفة متاحة", "تم إغلاق", "انتهت المدة المحددة", "تم شغل هذه الوظيفة",
]

# ---------------------------------------------------------------------------
# Noise detection — a job BOARD page (FAQ, About, category index, search
# results) vs. an individual posting.
#
# An earlier version of this tried to catch these by scanning content for
# words like "faq" / "about us" / "explore jobs". That approach is fragile
# in both directions, confirmed by pulling the FULL crawled content (not
# just a short snippet) for real examples:
#   - it FALSE-NEGATIVES on category/listing pages that don't happen to
#     contain any of the specific blocklisted words (Jadarat's "Explore
#     Jobs" taxonomy pages are mostly just a long list of distinct
#     specialization names — no "faq"/"about us" text anywhere in them).
#   - it risks FALSE-POSITIVING on real postings: "About Us" is extremely
#     common as a company-intro heading inside genuine job descriptions,
#     and a benefits FAQ section inside a real posting could easily contain
#     the literal word "faq".
#
# What actually distinguishes a listing/category page from one job posting
# is its STRUCTURE, not its vocabulary — verified against real Jadarat
# content pulled via Tavily:
#   - a pagination counter ("1 to 10 of 5885 items") — real job postings
#     never contain this pattern, board index pages almost always do.
#   - a short template phrase repeated several times ("Job title based on
#     the contract." appeared 8 times on one category page) — a real
#     posting's prose doesn't repeat itself like that.
#   - a long flat enumeration of many short, distinct items (Jadarat's
#     taxonomy/category listings ran 24-29 period/·-separated segments in
#     testing; real individual postings — including Jadarat's own terse,
#     tag-list-style ones — topped out at 8).
# These are language-independent (verified against both English and
# Arabic content) and don't require maintaining a word list per platform.
# ---------------------------------------------------------------------------
_ENUMERATION_SEGMENT_THRESHOLD = 20


def _looks_like_listing_or_category_page(content: str) -> bool:
    if not content:
        return False

    if re.search(r"\d+\s*(?:to|-|–)\s*\d+\s*of\s*\d+", content, re.IGNORECASE):
        return True

    words = content.split()
    if len(words) >= 20:
        shingles = [" ".join(words[i:i + 4]) for i in range(len(words) - 3)]
        counts = Counter(shingles)
        if counts and max(counts.values()) >= 3:
            return True

    segments = [s for s in re.split(r"[.·]", content) if s.strip()]
    if len(segments) > _ENUMERATION_SEGMENT_THRESHOLD:
        return True

    return False


# Titles Tavily's crawler surfaces verbatim for pages whose real content is
# JS-rendered client-side (common on portals like Jadarat) — the crawl only
# sees the page shell, so the "title" is a generic placeholder like
# "JobDetails" or "Entity Profile" (an EMPLOYER's profile page, not a job
# posting) rather than the actual role name. A listing with a title like
# this is useless to show a candidate even when the URL genuinely points at
# a real posting. EXACT match only (not substring) — confirmed some real
# Jadarat postings DO get an informative title like "JobDetails - structural
# engineer", which this correctly leaves alone; only the bare placeholder
# titles are excluded.
_NOISE_EXACT_TITLES = {"faq", "about us", "jobdetails", "job details", "entity profile"}

# URL routing conventions, not content vocabulary — a much lower
# false-positive-risk signal than scanning prose, since these are fixed
# path segments platforms use for their own info pages / profile pages,
# not words that could plausibly appear inside a real job description.
_NOISE_URL_SIGNALS = [
    "/faq", "/about", "/help", "/privacy", "/terms", "/sitemap", "/contact",
    "linkedin.com/in/",        # a LinkedIn PERSON profile, not a job posting
    "linkedin.com/company/",   # a LinkedIn company page, not a specific job
    # ── EDITORIAL / MARKETING CONTENT ───────────────────────────────────
    # BUG FIX: the reported run returned Indeed's "IT Job Titles Explained:
    # Roles, Career Paths and How to Choose" and LinkedIn's "Build an AI
    # Roadmap That Delivers Results" as if they were job openings. Both are
    # career-advice ARTICLES. They cleared every existing filter because
    # nothing looked at the URL's content section, and they cleared the
    # skill check trivially — an article listing IT roles naturally contains
    # more skill keywords than a real posting does. These are the fixed path
    # segments the major boards publish editorial content under.
]

# ─── HEURISTIC FALLBACK ONLY ────────────────────────────────────────────────
# Everything below this point is NOT the primary filter. The primary filter
# is _llm_screen_listings() — an actual model reading each result and judging
# whether it's a real, open job posting in the right place. Word lists can't
# do that job well: they miss editorial pages phrased in ways nobody
# enumerated, and they wrongly drop real postings whose title happens to
# contain a listed word.
#
# These stay as a SAFETY NET for when the screening call is unavailable
# (Gemini down / quota exhausted), so a degraded run still doesn't hand back
# blog posts. They are deliberately not consulted when the model screen
# succeeds.
_EDITORIAL_URL_SIGNALS = [
    "/career-advice", "/career-guide", "/advice/", "/blog", "/articles",
    "/insights", "/resources", "/guides", "/hiring-lab", "/learning",
    "/pulse/",                 # LinkedIn articles
    "/business/",              # LinkedIn/Indeed employer-marketing pages
    "/salaries", "/salary", "/companies/", "/cmp/", "/topic/", "/news",
    "/career-paths", "/what-is-", "/how-to-",
]

# Positive signal: the URL routing pattern the big boards use for an
# INDIVIDUAL posting. Checked per-domain because a path like "/jobs/" means
# "a job" on one site and "the job search page" on another. When a result
# comes from one of these domains and does NOT match its posting pattern, it
# is an index/editorial page no matter what its title says.
_JOB_URL_PATTERNS = {
    "linkedin.com":      ("/jobs/view/",),
    "indeed.com":        ("/viewjob", "/rc/clk", "/job/", "/jobs/view"),
    "glassdoor.com":     ("/job-listing/", "/Job/", "/partner/jobListing"),
    "ziprecruiter.com":  ("/jobs/", "/c/", "/job/"),
    "monster.com":       ("/job-openings/", "/jobs/search/", "/job/"),
    "bayt.com":          ("/jobs/", "/en/", "/ar/"),
    "glassdoor.co":      ("/job-listing/",),
}


def _fails_job_url_pattern(url: str) -> bool:
    """
    True when the URL is on a board we know the posting-URL shape of, but
    doesn't match it. Only applies to the domains listed above — everything
    else (ATS platforms, regional boards) passes through untouched, since
    guessing their routing would drop real postings.
    """
    url_lower = (url or "").lower()
    for domain, patterns in _JOB_URL_PATTERNS.items():
        if domain in url_lower:
            return not any(p.lower() in url_lower for p in patterns)
    return False


# Title phrasings that belong to an article, not a posting. Complements the
# URL check above for boards whose editorial content lives on a path we
# don't recognise. Kept to constructions a real role title essentially never
# uses — a posting is named after the job, it doesn't ask or explain.
_ARTICLE_TITLE_RE = re.compile(
    r"(\bhow to\b|\bwhat is\b|\bwhat are\b|\bwhy \w+ (?:is|are)\b|\bexplained\b|"
    r"\bguide\b|\bguides\b|\btips\b|\bbest practices\b|\bcareer paths?\b|"
    r"\bstep[- ]by[- ]step\b|\bexamples?\b|\btemplates?\b|\bchecklist\b|"
    r"\bvs\.?\b|\bversus\b|\btop \d+\b|\b\d+ (?:things|ways|steps|tips|skills)\b|"
    r"\bhow do\b|\bshould you\b|\bdelivers results\b|\bcomplete guide\b)",
    re.IGNORECASE,
)


def _looks_like_article_title(title: str) -> bool:
    return bool(_ARTICLE_TITLE_RE.search(title or ""))

# Another structural (not vocabulary) signal, found via live testing against
# the expanded board list: aggregator/category pages on sites like Wuzzuf or
# Naukrigulf title themselves like "82 python Jobs in Egypt – Apply Now!" or
# "Machine Learning Jobs in Saudi Arabia - 83 Vacancies" — a standalone
# number paired with a plural count-word ("jobs"/"vacancies"/"openings"/
# "positions") anywhere in the title. A single real posting's title is
# essentially never phrased this way (it names the role, not a count of
# roles), so this is a low-false-positive way to catch a whole class of
# listing pages without needing to enumerate per-site title conventions.
_AGGREGATOR_TITLE_RE = re.compile(
    r"\b\d[\d,]*\+?\b.*\b(jobs|vacancies|openings|positions)\b", re.IGNORECASE
)


def _looks_like_aggregator_title(title: str) -> bool:
    return bool(_AGGREGATOR_TITLE_RE.search(title or ""))


def _looks_closed(content: str, title: str = "") -> bool:
    """
    Now checks the TITLE too. Tavily's crawler frequently folds a board's
    "No longer accepting applications" banner into the page title rather
    than the body snippet, which is how a closed LinkedIn posting made it
    into the reported results despite this check already existing.
    """
    haystack = f"{title or ''} {content or ''}".lower()
    return any(signal in haystack for signal in _CLOSED_SIGNALS)


def _looks_like_scam(content: str) -> bool:
    content_lower = (content or "").lower()
    return any(signal in content_lower for signal in _SCAM_SIGNALS)


def _looks_like_noise_page(title: str, url: str, content: str) -> bool:
    title_lower = (title or "").lower().strip()
    url_lower = (url or "").lower()

    # Only STRUCTURAL signals belong in this pre-screen — things whose shape
    # proves they aren't a single posting, independent of vocabulary:
    # a bare placeholder title, an /faq or /privacy path, a "1 to 10 of 5885"
    # pagination counter, a taxonomy page's long flat enumeration.
    #
    # _looks_like_article_title and _fails_job_url_pattern are deliberately
    # NOT here, even though they'd catch more. They judge by word list and by
    # guessed URL routing, and both have real false positives — "\bguide\b"
    # would drop a genuine "Tour Guide" vacancy, and a board changing its
    # posting URL shape would silently drop every result from that board.
    # That judgment now belongs to _llm_screen_listings, which reads the page
    # instead of pattern-matching it. Those two survive only in
    # _heuristic_filter, for when the screening call can't run at all.
    if title_lower in _NOISE_EXACT_TITLES:
        return True
    if any(signal in url_lower for signal in _NOISE_URL_SIGNALS):
        return True
    if _looks_like_aggregator_title(title):
        return True
    if _looks_like_listing_or_category_page(content or ""):
        return True
    return False


# Accepted when the candidate's own city/country isn't mentioned — a genuinely
# remote role is relevant regardless of where it's headquartered.
_REMOTE_SIGNALS = ("remote", "work from home", "telecommute", "anywhere",
                   "عن بعد", "من المنزل")


def _location_terms(*locations: str) -> list[str]:
    """
    Flattens every known location string ("Jeddah", "Jeddah, Saudi Arabia",
    the Supabase profile's "City, Country") into a deduplicated list of
    lowercase tokens to match against. Using BOTH the CV's location and the
    profile's is what lets a CV that only says "Jeddah" still match a
    listing that only says "Saudi Arabia" — previously only one source was
    consulted, and only its first comma-separated token at that.
    """
    terms: list[str] = []
    for location in locations:
        for part in (location or "").split(","):
            token = part.strip().lower()
            # 2-char tokens are almost always noise ("KSA" is fine, "SA" is
            # a substring of far too many unrelated words).
            if len(token) >= 3 and token not in terms:
                terms.append(token)
    return terms


def _location_ok(content: str, title: str, url: str, location_terms: list[str]) -> bool:
    """
    BUG FIX (wrong country): the previous check was documented as "soft" and
    a listing that failed it was still kept as `weak` backfill. Since weak
    results are appended whenever there are fewer than RESULT_CAP good ones
    — which is most runs — a New York role reliably shipped to a candidate
    whose CV and Supabase profile both said Jeddah. Location is now a hard
    gate whenever we actually know where the candidate is: a listing must
    mention one of their location terms, or be explicitly remote.

    Still returns True when we know nothing about the candidate's location —
    filtering on an unknown is worse than not filtering.
    """
    if not location_terms:
        return True
    haystack = f"{title or ''} {content or ''} {url or ''}".lower()
    if any(term in haystack for term in location_terms):
        return True
    return any(signal in haystack for signal in _REMOTE_SIGNALS)


# ─── THE ACTUAL SCREEN: a model reads the results and judges them ──────────

JOB_SCREEN_PROMPT = """You are screening web search results to find REAL, CURRENTLY OPEN job postings
for a specific candidate. Judge each result on its own merits — do not rely on keyword matching.

WHAT THE CANDIDATE IS LOOKING FOR:
  Target role: {job_title}
  Their location: {location}
  Their skills: {skills}

For EACH result below, decide:

1. "is_job_posting" — is this ONE specific job opening at a specific employer, that a person could
   apply to right now?
     YES: an individual posting with a role, an employer, and duties or requirements.
     NO: a careers-advice or how-to article, a blog post, a salary guide, an employer marketing
         page, a search-results or category page listing many roles, a company profile, a person's
         profile, a newsletter, or a course/training ad.
   Be strict here. If it reads like something written to be READ rather than APPLIED TO, it is not
   a job posting. An article that merely mentions many job titles is still an article.

2. "is_open" — does anything indicate it is closed, filled, or expired? If there is a clear signal
   it is no longer accepting applications, set this false. If there is no signal either way,
   assume it is open and set true.

3. "location_ok" — would this role realistically work for someone based in {location}?
     TRUE if the role is in that city, that country, or the surrounding region, OR if it is
     explicitly remote / work-from-home / hybrid-with-relocation.
     FALSE if it is clearly based in a different country with no remote option.
     If the location genuinely cannot be determined from the result, set true — do not guess a
     rejection. When the candidate's location is "unknown", always set true.

4. "relevance" — 0.0 to 1.0, how well this role matches the candidate's target role and skills.
   A closely-matching role in the right place scores high; a loosely related one scores low.

5. "role" — the actual job title, cleaned up. "company" — the employer name. Use "" if genuinely
   not determinable from the result. Do NOT invent an employer.

RESULTS:
{results}

Respond ONLY with a JSON array, one object per result id, no markdown:
[{{"id": 0, "is_job_posting": true, "is_open": true, "location_ok": true, "relevance": 0.8,
   "role": "Machine Learning Engineer", "company": "Elm"}}]
"""

# Relevance is a RANKING signal, not a cutoff.
#
# It used to be a hard filter, which combined with the location and open
# checks to return a single listing on a real run — the user asked for five
# and got one. Showing five imperfect-but-real openings is more useful than
# showing one perfect one, so nothing is dropped for being a weak match:
# results are ordered best-first and the list is filled to RESULT_CAP from
# whatever survived. The ONLY hard exclusion after screening is
# "this isn't a job posting at all", which is the thing the user actually
# complained about (articles and blog posts appearing as jobs).
#
# This threshold now only decides the "Strong / Partial / Stretch" label.
_STRONG_MATCH = 0.6
_PARTIAL_MATCH = 0.3

# How much of each result's crawled text the screener sees. Enough to judge
# "posting vs article" and spot a location, without turning one screen into
# a huge prompt.
_SCREEN_CONTENT_CHARS = 900


def _llm_screen_listings(
    candidates: list[dict],
    job_title: str,
    location: str,
    required_skills: list[str],
) -> list[dict] | None:
    """
    Asks the model to judge every candidate result at once, and returns the
    ones it accepts, ordered by relevance. Returns None (not []) when the
    screen could not run at all, so the caller can tell "the model rejected
    everything" apart from "the model never answered" and fall back to
    heuristics only in the latter case.

    This is the answer to "I want the agent itself to know jobs and give
    only jobs": the decision is made by something that actually reads the
    page text, rather than by a list of banned words that has to be
    extended every time a job board invents a new content section.
    """
    if not candidates:
        return []

    payload = [
        {
            "id": i,
            "title": c.get("title") or "",
            "url": c.get("url") or "",
            "content": (c.get("_content") or "")[:_SCREEN_CONTENT_CHARS],
        }
        for i, c in enumerate(candidates)
    ]

    prompt = JOB_SCREEN_PROMPT.format(
        job_title=job_title or "unknown",
        location=location or "unknown",
        skills=", ".join(required_skills[:8]) or "unknown",
        results=json.dumps(payload, ensure_ascii=False),
    )

    try:
        raw = generate_gemini_json(prompt)
        raw = re.sub(r"```json|```", "", raw or "").strip()
        verdicts = json.loads(raw)
        if not isinstance(verdicts, list):
            logger.warning("🔍 Job screen returned a non-list response — falling back to heuristics.")
            return None
    except Exception as e:
        logger.error(f"🔍 Job screening call failed: {e} — falling back to heuristic filters.")
        return None

    accepted: list[tuple[tuple, dict]] = []
    rejected = Counter()

    for verdict in verdicts:
        if not isinstance(verdict, dict):
            continue
        idx = verdict.get("id")
        if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
            continue

        # The ONE hard exclusion — see the note on _STRONG_MATCH above.
        if not verdict.get("is_job_posting"):
            rejected["not_a_job_posting"] += 1
            continue

        try:
            relevance = float(verdict.get("relevance", 0.0))
        except (TypeError, ValueError):
            relevance = 0.0

        # Open and in-the-right-place become SORT KEYS instead of filters:
        # a closed or far-away real opening still beats returning nothing,
        # and it sinks below every better option automatically.
        is_open = verdict.get("is_open") is not False
        location_ok = verdict.get("location_ok") is not False
        if not is_open:
            rejected["closed_kept_last"] += 1
        if not location_ok:
            rejected["wrong_location_kept_last"] += 1

        job = dict(candidates[idx])
        # Prefer the model's cleaned-up role/company over the raw crawled
        # page title, which is frequently "Company hiring Role - LinkedIn"
        # or a bare "JobDetails" placeholder.
        role = str(verdict.get("role") or "").strip()
        company = str(verdict.get("company") or "").strip()
        if role:
            job["title"] = f"{role} - {company}" if company else role
        job["company"] = company
        job["match_label"] = (
            "Strong Match" if relevance >= _STRONG_MATCH
            else "Partial Match" if relevance >= _PARTIAL_MATCH
            else "Stretch Role"
        )
        # Strip every internal field — these get serialized straight into
        # the API response and persisted in the user's resume history.
        for internal in ("_content", "_skill_ratio"):
            job.pop(internal, None)

        # Sort: open first, then right-location, then most relevant.
        accepted.append(((is_open, location_ok, relevance), job))

    if rejected:
        logger.info(f"🔍 Screener verdicts: {dict(rejected)}")

    accepted.sort(key=lambda pair: pair[0], reverse=True)
    return [job for _, job in accepted]


def _matches_any_domain(url: str, domains: list[str]) -> bool:
    """
    Tavily's include_domains parameter is a preference signal, NOT a hard
    allowlist — confirmed by live testing: a search scoped to
    FALLBACK_DOMAINS returned results from domains never listed (e.g.
    naukrigulf.com, zerotaxjobs.com). This is the actual enforcement,
    checked against every raw result before it's processed.
    """
    url_lower = (url or "").lower()
    return any(domain in url_lower for domain in domains)


def _search_tavily(client: TavilyClient, query: str, domains: list[str], max_results: int):
    try:
        results = client.search(
            query=query,
            search_depth='advanced',
            include_domains=domains,
            max_results=max_results,
            time_range=SEARCH_TIME_RANGE,
        )
        return results.get('results', [])
    except Exception as e:
        logger.error(f"❌ Tavily API search failed for domains {domains}: {e}")
        return []


def _to_candidate(r: dict, required_skills_lower: list[str]) -> tuple[dict | None, str]:
    """
    Turns one raw Tavily result into a candidate for screening, or
    (None, reason) if it's obviously unusable.

    Only CHEAP, HIGH-PRECISION drops happen here — a scam listing, a page
    that says outright it's closed, a structural non-page (an /about or
    /privacy URL, a paginated category index). Everything requiring actual
    judgment about "is this a job posting" and "is this the right place" is
    left to _llm_screen_listings, which reads the page text rather than
    matching words.

    `_content` rides along for the screener and is stripped before the job
    reaches the frontend.
    """
    content = r.get('content', '') or ''
    title = r.get('title') or 'Job Opening'
    url = r.get('url', '')

    if not url:
        return None, "no_url"
    if _looks_like_scam(content):
        return None, "scam"
    if _looks_closed(content, title):
        return None, "closed"
    if _looks_like_noise_page(title, url, content):
        return None, "noise"

    source = url.split('/')[2] if '/' in url and len(url.split('/')) > 2 else "Job Board"
    matched = sum(1 for skill in required_skills_lower if skill in content.lower())
    ratio = (matched / len(required_skills_lower[:5])) if required_skills_lower else 0.5

    return {
        'title': title,
        'url': url,
        'snippet': content[:200] + "...",
        'source': source,
        'match_label': "Strong Match" if ratio >= 0.6 else "Partial Match" if ratio >= 0.2 else "Stretch Role",
        '_content': content,
        '_skill_ratio': ratio,
    }, "ok"


def _heuristic_filter(candidates: list[dict], location_terms: list[str]) -> list[dict]:
    """
    FALLBACK ONLY — used when _llm_screen_listings couldn't run. Applies the
    old word/URL-list rules so a degraded run still doesn't return blog
    posts or wrong-country roles. See the _EDITORIAL_URL_SIGNALS banner for
    why these aren't the primary mechanism.
    """
    kept, dropped = [], Counter()
    for c in candidates:
        url_lower = (c.get('url') or "").lower()
        if any(sig in url_lower for sig in _EDITORIAL_URL_SIGNALS):
            dropped["editorial_url"] += 1
            continue
        if _looks_like_article_title(c.get('title')):
            dropped["article_title"] += 1
            continue
        if _fails_job_url_pattern(c.get('url')):
            dropped["not_a_posting_url"] += 1
            continue
        if not _location_ok(c.get('_content'), c.get('title'), c.get('url'), location_terms):
            dropped["wrong_location"] += 1
            continue
        kept.append(c)

    if dropped:
        logger.info(f"🔍 Heuristic fallback dropped: {dict(dropped)}")
    kept.sort(key=lambda c: c.get('_skill_ratio', 0), reverse=True)
    for c in kept:
        c.pop('_content', None)
        c.pop('_skill_ratio', None)
    return kept


def _collect_candidates(raw_results: list[dict], required_skills_lower: list[str]) -> list[dict]:
    candidates, dropped = [], Counter()
    for r in raw_results:
        candidate, reason = _to_candidate(r, required_skills_lower)
        if candidate is None:
            dropped[reason] += 1
            continue
        candidates.append(candidate)
    if dropped:
        # Logged because "we found 2 jobs" is useless on its own for
        # diagnosing whether the search was thin or the filters were harsh.
        logger.info(f"🔍 Dropped raw results before screening: {dict(dropped)}")
    return candidates


def _run_search_pass(
    client: TavilyClient,
    query: str,
    required_skills_lower: list[str],
) -> list[dict]:
    """
    One full search pass: Jadarat and the fallback boards queried
    concurrently, each post-filtered by _matches_any_domain (Tavily's
    include_domains is a preference, not an allowlist), then reduced to
    screening candidates. Jadarat's results lead the returned list — that's
    its priority weighting — but nothing requires it to hit any minimum.
    """
    logger.info(f"🔍 Agent 6 — Querying Tavily for listings matching: '{query}'...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        priority_future = executor.submit(_search_tavily, client, query, PRIORITY_DOMAINS, RAW_FETCH_LIMIT)
        fallback_future = executor.submit(_search_tavily, client, query, FALLBACK_DOMAINS, RAW_FETCH_LIMIT)
        priority_result = priority_future.result()
        fallback_result = fallback_future.result()

    priority_raw = [r for r in priority_result if _matches_any_domain(r.get('url', ''), PRIORITY_DOMAINS)]
    fallback_raw = [r for r in fallback_result if _matches_any_domain(r.get('url', ''), FALLBACK_DOMAINS)]

    # Tavily's include_domains is a preference, not an allowlist, so these
    # searches also return results from boards we didn't name. They used to
    # be discarded outright. They're now kept as a RESERVE, used only when
    # the allowlisted pool can't fill RESULT_CAP — a real opening on a
    # company's own careers page is far more useful to the candidate than a
    # short list, and the LLM screen still has to confirm it's a genuine job
    # posting before it can be shown. The allowlist keeps doing its real job
    # (scam avoidance) by ordering these last rather than by hiding them.
    known = set()
    for r in priority_raw + fallback_raw:
        known.add(r.get('url', ''))
    offlist_raw = [
        r for r in priority_result + fallback_result
        if r.get('url') and r['url'] not in known
    ]

    return (
        _collect_candidates(priority_raw, required_skills_lower)
        + _collect_candidates(fallback_raw, required_skills_lower),
        _collect_candidates(offlist_raw, required_skills_lower),
    )


def _run_search_passes(
    client: TavilyClient,
    queries: list[str],
    required_skills_lower: list[str],
) -> list[tuple[list[dict], list[dict]]]:
    """
    Runs several query variants at the same time, returning one
    (allowlisted, offlist) pair per query IN QUERY ORDER, not completion
    order.

    Order matters even though the model re-ranks everything afterwards: the
    caller dedupes by URL as it absorbs these, so whichever pass sees a URL
    first is the one whose copy is kept. Preserving query order keeps that
    deterministic, so the same search doesn't return subtly different
    results run to run depending on which request happened to finish first.

    Each pass internally fans out to two Tavily searches (priority board +
    fallback boards), so the real concurrency here is 2x len(queries). That
    is bounded by the caller passing at most the three follow-up variants,
    i.e. six in-flight searches, which is well within Tavily's limits and
    still just one round trip's worth of latency.
    """
    if not queries:
        return []
    if len(queries) == 1:
        return [_run_search_pass(client, queries[0], required_skills_lower)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as executor:
        futures = [
            executor.submit(_run_search_pass, client, query, required_skills_lower)
            for query in queries
        ]
        # Iterating `futures` (not as_completed) is what preserves order;
        # .result() re-raises, and _search_tavily already swallows its own
        # errors, so a dead board yields an empty list rather than killing
        # the whole batch.
        return [future.result() for future in futures]


def _normalize_for_match(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _drop_source_job(candidates: list[dict], weight_factors: dict) -> list[dict]:
    """
    Removes the very posting the user pasted in as their job description.

    "Similar jobs" that leads with the job you're already applying to is
    noise — and it always ranks first, because it matches its own JD
    perfectly. Matched on company AND role together: company alone would
    wrongly hide every other opening at the same employer, which is exactly
    the kind of listing a candidate DOES want to see.
    """
    company = _normalize_for_match(weight_factors.get("company", ""))
    title = _normalize_for_match(weight_factors.get("job_title", ""))
    if not company or not title or company == "unknown":
        return candidates

    kept, dropped = [], 0
    for candidate in candidates:
        haystack = _normalize_for_match(f"{candidate.get('title', '')} {candidate.get('_content', '')[:300]}")
        if company in haystack and title in haystack:
            dropped += 1
            continue
        kept.append(candidate)

    if dropped:
        logger.info(f"🔍 Dropped {dropped} listing(s) matching the pasted job description itself.")
    return kept


def find_similar_jobs(
    weight_factors: dict,
    facts_json: dict,
    fallback_location: str | None = None,
    profile_location: str | None = None,
) -> list:
    """
    Queries the Tavily API for relevant active job listings posted within
    the last week and applies a matching tier label based on skill overlap.

    Jadarat (Saudi Arabia's national platform) is checked as ONE of the
    boards searched, every time — not an all-or-nothing gate. It's queried
    first and its results are placed first in the final ordering (that's
    the "priority"/"more weight" part), but there's no minimum match count
    it has to clear to be included: if it has a good match, it's shown; if
    it doesn't, it simply contributes nothing and the other boards fill the
    list. Both searches run concurrently so always checking both doesn't
    cost extra wall-clock time over checking one.

    fallback_location: optional location to use when facts_json.personal.location is
    empty (e.g. a user-selected city from signup or the upload flow) — see bug #12's
    follow-up: uploaded CVs don't always yield a reliable extracted location the way
    the manual-entry form does, so callers can pass a known-good fallback here once
    that UI exists. Currently unused if not passed — this is the hook point, not a
    complete fix on its own (the actual UI/state wiring still needs to be added).
    """
    api_key = os.getenv('TAVILY_API_KEY')
    if not api_key:
        logger.error("❌ TAVILY_API_KEY is missing from environment variables.")
        return []

    client = TavilyClient(api_key=api_key)

    job_title = weight_factors.get("job_title", "Software Engineer")
    required_skills = weight_factors.get("required_skills", [])
    search_skills = " ".join(required_skills[:3])  # top 3 skills — targeted but flexible

    # BUG FIX (#12): the candidate's location (from facts_json.personal.location,
    # populated either from the uploaded CV or the manual-entry location field)
    # was never actually included in the query before — Tavily had no signal
    # to prefer local listings, which is why testers in Saudi Arabia were
    # getting jobs recommended in the UK. Generic — uses whatever location
    # string the candidate actually provided, nothing hardcoded to one country.
    candidate_location = ((facts_json.get("personal", {}) or {}).get("location") or "").strip()
    effective_location = candidate_location or (fallback_location or "").strip()

    # Match against the CV's location AND the Supabase profile's, not just
    # whichever one happened to be picked. The profile location comes from
    # the signup/Settings country+city dropdown, so it's the one that
    # reliably carries a COUNTRY — the CV often only says "Jeddah", which on
    # its own can't rule out a listing that says "Saudi Arabia".
    location_terms = _location_terms(candidate_location, fallback_location or "", profile_location or "")
    location_query_part = f" in {effective_location}" if effective_location else ""

    required_skills_lower = [s.lower() for s in required_skills]

    # PROGRESSIVELY BROADER QUERIES. Each is run only while the candidate
    # pool is still too thin to reliably yield RESULT_CAP after screening.
    # The pool target is a multiple of RESULT_CAP because screening drops a
    # meaningful share (articles, category pages), and a pool of exactly 5
    # reliably produced 1-2 survivors.
    queries = [
        f"{job_title} active job openings hiring {search_skills}{location_query_part}",
        f"{job_title} jobs vacancies apply{location_query_part}",
        # Drops the location so a nearby-city or remote posting can surface.
        # Location is a sort key now, not a filter, so these still rank below
        # local ones rather than displacing them.
        f"{job_title} jobs hiring now",
        # Last resort: the single strongest skill instead of the job title,
        # which catches roles titled differently for the same actual work.
        f"{(required_skills[0] if required_skills else job_title)} jobs{location_query_part}",
    ]

    candidates: list[dict] = []
    reserve: list[dict] = []
    seen_urls: set[str] = set()

    def _absorb(batch: list[dict], into: list[dict]) -> None:
        # Dedupe as we go — no reason to pay to screen the same URL twice.
        for candidate in batch:
            if candidate["url"] in seen_urls:
                continue
            seen_urls.add(candidate["url"])
            into.append(candidate)

    # PASS 1 runs alone. It's the most specific query and usually fills the
    # pool by itself, and running it first is what keeps the common case at
    # exactly 2 Tavily searches. Firing all four variants up front would be
    # simpler but would quadruple the search spend on every single request
    # to buy latency the common case never needed.
    allowlisted, offlist = _run_search_pass(client, queries[0], required_skills_lower)
    _absorb(allowlisted, candidates)
    _absorb(offlist, reserve)

    # THE REMAINING PASSES RUN CONCURRENTLY, not one after another.
    #
    # These only fire when pass 1 came up short, but when they do fire they
    # are independent of each other — none reads the others' output, they
    # just widen the same pool. Sequentially that was up to three ~5s round
    # trips stacked back to back; together it's one. Worst-case Tavily spend
    # is unchanged (the same four queries, two searches each); only the
    # wall-clock arrangement differs.
    if len(candidates) < RESULT_CAP * 3 and len(queries) > 1:
        remaining = queries[1:]
        logger.info(
            f"🔍 Pool at {len(candidates)} candidate(s) — broadening with "
            f"{len(remaining)} more queries, run concurrently..."
        )
        for allowlisted, offlist in _run_search_passes(client, remaining, required_skills_lower):
            _absorb(allowlisted, candidates)
            _absorb(offlist, reserve)

    # Pull in off-allowlist results only if the trusted pool is too thin to
    # produce RESULT_CAP after screening — see _run_search_pass.
    if len(candidates) < RESULT_CAP * 2 and reserve:
        logger.info(f"🔍 Trusted pool at {len(candidates)} — adding {len(reserve)} off-allowlist candidate(s) as reserve.")
        candidates += reserve

    # Drop the posting the user pasted in as their job description. It's a
    # guaranteed "Strong Match" against itself, and recommending someone the
    # exact job they're already applying to is noise, not a suggestion.
    candidates = _drop_source_job(candidates, weight_factors)

    # THE SCREEN — a model reads each candidate and decides whether it's a
    # real posting. Heuristics only step in if that call couldn't be made.
    screened = _llm_screen_listings(candidates, job_title, effective_location, required_skills)
    if screened is None:
        final = _heuristic_filter(candidates, location_terms)[:RESULT_CAP]
        logger.info(f"✅ Found {len(final)} job listings via heuristic fallback (screening unavailable).")
        return final

    final = screened[:RESULT_CAP]
    if len(final) < RESULT_CAP:
        # Worth knowing: means the pool itself was thin, not that the
        # filters were harsh — nothing is dropped for being a weak match.
        logger.warning(
            f"⚠️  Only {len(final)}/{RESULT_CAP} listings after screening from "
            f"{len(candidates)} candidates — the search pool was too small."
        )
    logger.info(
        f"✅ Found {len(final)} screened job listings "
        f"({len(candidates)} candidates screened, location: {effective_location or 'unknown'})."
    )
    return final


_LOCATION_PLACEHOLDER_WORDS = {"n/a", "na", "none", "test", "asdf", "city", "location", "unknown", "-", "tbd"}


def _looks_like_real_location(text: str) -> bool:
    """
    Coarse sanity check, NOT real geo-validation — that would need a bundled
    cities dataset or a geocoding API call, neither of which this file has.
    This only catches the obvious cases: empty, absurdly long, no letters at
    all, or a common placeholder word. The real fix for garbage manual-entry
    input is upstream — components/manual-cv-form.tsx's free-text location
    field should use the same country+city dropdown as signup/Settings
    (lib/countries.ts on the frontend) so bad input can't be typed in the
    first place. This is a safety net for whatever gets past that, not a
    replacement for it.
    """
    cleaned = (text or "").strip()
    if not cleaned or len(cleaned) > 60:
        return False
    if not any(ch.isalpha() for ch in cleaned):
        return False
    if cleaned.lower() in _LOCATION_PLACEHOLDER_WORDS:
        return False
    return True


def _fetch_profile_location(user_id: str | None) -> str | None:
    """
    Fallback source for a candidate's location, used ONLY when the CV
    itself (facts_json.personal.location) didn't yield one — see
    run_jobs_finder below, which always checks the CV first. Reads
    profiles.location, set either at signup (register-page.tsx's city
    dropdown, riding through auth signUp metadata) or later from Settings
    (settings-page.tsx, via core/location.py). Reuses credits.py's admin
    client rather than opening a second Supabase connection.
    """
    if not user_id:
        return None
    try:
        admin = get_admin_client()
        profile = admin.table("profiles").select("location").eq("id", user_id).maybe_single().execute().data
        return (profile or {}).get("location") or None
    except Exception as e:
        logger.warning(f"Couldn't fetch profile location fallback for user {user_id}: {e}")
        return None


def run_jobs_finder(state: AgentState) -> dict:
    """
    LangGraph execution node for Agent 6.
    Reads input values from state and writes back the structured findings list.
    """
    weight_factors = state.get("weight_factors", {})
    facts_json = state.get("facts_json", {})

    cv_location = ((facts_json.get("personal", {}) or {}).get("location") or "").strip()

    # BUG FIX: the profile location is now ALWAYS fetched, not only when the
    # CV's location looks fake.
    #
    # Two separate problems were stacked here. First, state["user_id"] was
    # never actually reaching this node — `user_id` wasn't declared in
    # AgentState, so LangGraph silently dropped it and this call received
    # None on every request, meaning the Supabase location has never once
    # been read (fixed in core/state.py). Second, even with a working
    # user_id, the old condition skipped the profile entirely whenever the
    # CV had *any* plausible-looking location — so a CV saying "Jeddah"
    # meant the profile's "Jeddah, Saudi Arabia" was never consulted, and
    # the country was unavailable to filter on. Both sources are now passed
    # through and merged into the match terms.
    user_id = state.get("user_id")
    profile_location = _fetch_profile_location(user_id)
    if not user_id:
        logger.warning("Agent 6 has no user_id in state — falling back to the CV's location only.")

    fallback_location = None if _looks_like_real_location(cv_location) else profile_location

    similar_jobs = find_similar_jobs(
        weight_factors,
        facts_json,
        fallback_location=fallback_location,
        profile_location=profile_location,
    )

    return {"similar_jobs": similar_jobs}
