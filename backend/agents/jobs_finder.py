# agents/jobs_finder.py
import json
import os
import re
import concurrent.futures
from collections import Counter

import httpx
from tavily import TavilyClient
from loguru import logger
from core.state import AgentState
from core.credits import get_admin_client
from core.llm_config import generate_gemini_json
# The same phrase matcher the ATS scorer uses, so "does this listing talk
# about the candidate's field" is answered the same way "does this CV cover
# the JD" is — see utils/ats_scorer.py's BM25 section.
# _title_subject comes from the same module's title component: it strips
# seniority words ("Senior", "Junior") so two postings for the same role at
# different levels still compare as the same role. Reused by the Job Search
# page's exact-vs-adjacent split — see _title_closeness.
from utils.ats_scorer import (
    PHRASE_COVERAGE_THRESHOLD,
    _stem_counts,
    _title_subject,
    phrase_coverage,
)

# Priority job board — searched every time and ranked ahead of
# equally-relevant results from anywhere else. Jadarat (jadarat.sa) is Saudi
# Arabia's national employment platform, general-purpose across public and
# private sector.
#
# ── WHY AJEER IS NOT HERE ────────────────────────────────────────────────
# It was added to this lane and then removed, on measurement rather than
# opinion. Three findings, each independently disqualifying:
#
#   1. ajeer.com.sa 301s to ajeer.qiwa.sa, so an include_domains of
#      "ajeer.com.sa" could never match an indexed page in the first place.
#   2. Searched under BOTH hostnames, across four queries in English and
#      Arabic, Tavily returned 0 results. Not thin — zero. (The parent
#      platform qiwa.sa returns 39, so this is not a Tavily gap.)
#   3. The site itself is reachable and NOT bot-blocked (HTTP 200, real
#      content), but what it serves is a login-gated portal for temporary
#      labour permits — services, FAQ, contact, sign-in. There are no
#      public vacancy pages to index, which is why 1 and 2 are true.
#
# So Ajeer cannot contribute listings, and a priority lane that always
# returns nothing is worse than no lane: it spends a search per query and
# occupies weighting that then goes unused. If Ajeer ever publishes public
# postings, add 'ajeer.qiwa.sa' (not ajeer.com.sa) and re-measure.
PRIORITY_DOMAINS = ['jadarat.sa']

# Established boards and aggregators. These are PRE-VETTED: a result from
# one of them skips the legitimacy filter below, because the platform itself
# is the vetting. Every entry is a well-established board verified as
# legitimate, not paid-access (excludes e.g. FlexJobs, which paywalls
# listings from a candidate without their own subscription), and either
# global or specifically relevant to a Gulf/Saudi candidate base.
TRUSTED_DOMAINS = [
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

# Saudi-specific aggregators, SEARCHED IN THEIR OWN LANE rather than added
# to the list above — and that placement is the whole point.
#
# Added to TRUSTED_DOMAINS first, and it made results WORSE, measured: the
# genomics run went from one good listing to zero. include_domains splits a
# single search's result budget across every domain named in it, and these
# two sites are heavily indexed on SEO CATEGORY pages ("وظائف مهندس زراعي -
# جدة", "Get Jobs in Jeddah Saudi Arabia 2026") rather than on individual
# postings. Sharing a lane, those category pages consumed slots and pushed
# the one genuinely relevant LinkedIn posting out of the pool entirely.
#
# In their own lane they are purely ADDITIVE: they contribute their own
# results without taking any from the established boards. Fetched shallower
# than the other lanes for the same reason — the useful density is lower.
SAUDI_AGGREGATOR_DOMAINS = ['getsaudijobs.com', 'saudi.tanqeeb.com']
SAUDI_AGGREGATOR_FETCH_LIMIT = 10

# BACK-COMPAT: the old name for what is now TRUSTED_DOMAINS. Kept because
# tests/test_jobs_finder.py imports it.
FALLBACK_DOMAINS = TRUSTED_DOMAINS

# ─── LEGITIMACY FILTER: HOW AN UNKNOWN DOMAIN EARNS ITS PLACE ──────────────
#
# THE MODEL CHANGED HERE, DELIBERATELY. Sourcing used to be allowlist-only:
# if a domain wasn't named above, its results were discarded (or held back
# as a thin "reserve"). That is safe and it is also why a real opening
# posted ONLY on a company's own careers page — the common case for
# specialist employers, e.g. a genomics lab hiring through its own site —
# could never be found no matter how well it matched.
#
# A hand-maintained list of every employer in Saudi Arabia is not a thing
# that can exist. So the allowlist stops being the gate and becomes a
# FAST PATH: named sources are pre-vetted and skip these checks, while
# anything else has to show it is a real job posting on a real
# organisation's site. That is a property of the page, which can be
# checked, rather than a name on a list, which has to be maintained.
#
# What is NOT done here: no WHOIS/domain-age lookup (an extra network call
# per result, and plenty of legitimate Saudi employers have young domains),
# and no Google SERP scraping (against their terms, and brittle).

# Platforms that host CONTENT, not employment. A job "posting" on one of
# these is a blog article, a newsletter or a forum thread about a job — not
# an opening at that platform. Excluded regardless of how well it reads.
_CONTENT_HOST_SIGNALS = (
    "blogspot.", "wordpress.com", "medium.com", "substack.com", "tumblr.",
    "wixsite.com", "weebly.com", "blogger.com", "quora.com", "reddit.com",
    "facebook.com", "twitter.com", "x.com", "instagram.com", "tiktok.com",
    "youtube.com", "pinterest.", "t.me", "telegram.",
)

# Applicant tracking systems. A posting on one of these is hosted by the
# employer's own recruiting instance, which is about as strong a legitimacy
# signal as exists: you cannot post to another company's Workday.
_ATS_HOST_SIGNALS = (
    "greenhouse.io", "lever.co", "myworkdayjobs.com", "workday.com",
    "smartrecruiters.com", "icims.com", "ashbyhq.com", "recruitee.com",
    "bamboohr.com", "teamtailor.com", "personio.", "workable.com",
    "jazz.co", "breezy.hr", "taleo.net", "successfactors.com", "oraclecloud.com",
)

# A careers section on an organisation's own site. Weaker than an ATS host
# but still says "this is an employer publishing its own vacancies".
_CAREER_PATH_SIGNALS = (
    "/careers", "/career", "/jobs", "/job/", "/vacancy", "/vacancies",
    "/join-us", "/work-with-us", "/opportunities", "/recruitment", "/hiring",
    "/التوظيف", "/وظائف", "/الوظائف",
)

# The shape of a real posting: it tells you what the job is and asks you to
# apply. An article about a job does none of these. Bilingual because a
# Saudi employer's own careers page is as likely to be in Arabic.
_JOB_STRUCTURE_SIGNALS = (
    "responsibilities", "requirements", "qualifications", "apply now",
    "how to apply", "job description", "what you'll do", "what you will do",
    "we are looking for", "we're looking for", "minimum qualifications",
    "years of experience", "full-time", "full time", "employment type",
    "المسؤوليات", "المؤهلات", "المتطلبات", "الوصف الوظيفي", "قدم الآن",
    "التقديم", "الخبرات المطلوبة", "دوام كامل", "نبحث عن",
)

# How many structural signals an unknown domain must show. Two, because one
# is cheap coincidence — "years of experience" appears in careers advice
# articles constantly — while two together rarely occur outside a real ad.
_MIN_STRUCTURE_SIGNALS = 2


def _host_of(url: str) -> str:
    parts = (url or "").split("/")
    return parts[2].lower() if len(parts) > 2 else ""


def is_legitimate_open_web_result(url: str, title: str, content: str) -> tuple[bool, str]:
    """
    Should this result from an UNKNOWN domain be allowed into the pool?

    Returns (ok, reason) — the reason is logged in aggregate so the filter's
    behaviour is visible rather than a silent black box.

    Named sources never reach here; this is only for the open lane.
    """
    host = _host_of(url)
    if not host:
        return False, "no_host"
    # A bare IP address is never a real employer's careers site.
    if re.fullmatch(r"[\d.:\[\]]+", host):
        return False, "ip_host"
    if any(signal in host for signal in _CONTENT_HOST_SIGNALS):
        return False, "content_platform"

    url_lower = (url or "").lower()
    # An employer's own ATS or careers path is sufficient on its own.
    if any(signal in url_lower for signal in _ATS_HOST_SIGNALS):
        return True, "ats_host"

    haystack = f"{title or ''} {content or ''}".lower()
    structure_hits = sum(1 for signal in _JOB_STRUCTURE_SIGNALS if signal in haystack)

    # A careers path is enough on its own. This deliberately does NOT also
    # require posting structure: what reaches here is Tavily's SNIPPET, a few
    # hundred characters, and demanding two structural phrases from an
    # excerpt rejected genuine company postings — 39 of them in one measured
    # run. Deciding "one posting vs a category index" is the SCREENER's job,
    # and it reads the page for exactly that. This filter answers the
    # narrower question the screener cannot: is this a real organisation's
    # site at all, or a content farm.
    if any(signal in url_lower for signal in _CAREER_PATH_SIGNALS):
        return True, "careers_path"
    if structure_hits >= _MIN_STRUCTURE_SIGNALS:
        return True, "posting_structure"
    return False, "no_posting_signals"


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

# ─── JADARAT IS A JAVASCRIPT SPA, AND THAT WAS BREAKING ITS OWN LANE ───────
#
# jadarat.sa serves "JavaScript is required" and nothing else to a non-JS
# client — 22 characters of visible text. Tavily renders it, so real content
# does come back, but every posting is served under the SPA's route name:
# the page <title> of an actual vacancy is the literal string "JobDetails".
#
# "jobdetails" is in _NOISE_EXACT_TITLES above, added to drop the platform's
# own chrome pages. The effect was that Jadarat's REAL postings were dropped
# by our own filter, every time. Measured across four queries: 25 results,
# 3 survived, and all five /JobDetails routes — the actual vacancies — were
# rejected on their title. The priority lane was not failing because Jadarat
# had nothing; it was failing because we threw its postings away.
#
# The route distinguishes them: /JobDetails is one vacancy, while
# "Entity Profile", "About Jadarat Platform" and the bare platform home are
# genuinely not postings and must keep being dropped. The real role and
# employer sit in the rendered content after an "ID:" label, e.g.
# "ID: Strategy Specialist هيئة تطوير محمية الملك سلمان بن عبدالعزيز".
_JADARAT_TITLE_RE = re.compile(r"\bID:\s*(.{3,80})")


def jadarat_posting_title(url: str, content: str) -> str | None:
    """
    The real role/employer text for a Jadarat vacancy page, or None.

    None also means "do not rescue this one": a /JobDetails page whose
    content has no readable ID: line gives us nothing to show a user, so it
    is left to be dropped rather than surfaced with "JobDetails" as its
    title. Deliberately conservative — a listing with a meaningless title in
    the UI is worse than one fewer listing.
    """
    if "/jobdetails" not in (url or "").lower():
        return None
    match = _JADARAT_TITLE_RE.search(re.sub(r"\s+", " ", content or ""))
    if not match:
        return None
    title = match.group(1).strip(" -–—|·")
    # The screener re-extracts a clean role and company from this anyway
    # (see JOB_SCREEN_PROMPT), so this only has to be honest text from the
    # page, not a perfectly parsed job title.
    return title or None

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

4. "relevance" — 0.0 to 1.0, how well this role matches the candidate's FIELD and skills.

   JUDGE THE FIELD, NOT THE JOB TITLE. This is the mistake to avoid: a
   "Senior R&D Scientist" at a glass manufacturer and a "Principal R&D Scientist" at an aluminium
   company both share almost every word with a molecular geneticist's title and are completely
   wrong for them — different industry, different science, no transferable day-to-day work. Score
   those low (0.1-0.2) no matter how similar the words look.
     0.8-1.0  same field, doing the same kind of work with the same tools
     0.5-0.7  adjacent field — a real career step across, skills mostly transfer
     0.1-0.3  the title reads similar but the actual work and industry are unrelated
     0.0      no connection at all
   Ask: would someone with THESE skills be a credible applicant, or would the employer see an
   unrelated background? Title overlap alone is not relevance.

5. "role" — the actual job title, cleaned up. "company" — the employer name. Use "" if genuinely
   not determinable from the result. Do NOT invent an employer.

RESULTS:
{results}

Respond ONLY with a JSON array, one object per result id, no markdown:
[{{"id": 0, "is_job_posting": true, "is_open": true, "location_ok": true, "relevance": 0.8,
   "role": "Machine Learning Engineer", "company": "Elm"}}]
"""

# Relevance decides the "Strong / Partial / Stretch" label.
_STRONG_MATCH = 0.6
_PARTIAL_MATCH = 0.3

# ─── DOMAIN RELEVANCE: THE FLOOR A LISTING HAS TO CLEAR TO BE SHOWN ─────────
#
# THIS REVERSES AN EARLIER DECISION, DELIBERATELY. Relevance used to be a
# ranking signal only, on the reasoning that five imperfect openings beat one
# perfect one, so the list was always padded to RESULT_CAP from whatever
# survived. On a real run for a genomics researcher that produced: one
# bioinformatics role, one regional research role, and then a Senior R&D
# Scientist at a GLASS MANUFACTURER, the same glass role a second time under
# a different URL, and an R&D specialist at an ALUMINIUM company. Three of
# five slots were filled with things the candidate could not plausibly want,
# purely to reach a number.
#
# Padding to a fixed count is now off. A short list of real matches is the
# product; a full list of noise is not. If only two listings clear the floor,
# two are returned.
#
# TWO BANDS, because a single relevance floor did not work. Measured on the
# live genomics run: the screener rated the aluminium role 0.5 and the glass
# role 0.4 — above any floor low enough to keep honest mid-range matches —
# because those titles share almost every word with "Senior Research
# Scientist". Relevance alone cannot separate "same words" from "same work".
#
#   at or above HIGH_CONFIDENCE_RELEVANCE : the screener is sure, that stands
#   below it                              : the listing must also actually
#                                           mention the candidate's own skills
#
# So a strong match never needs corroborating, and everything else has to
# show real evidence rather than a familiar-looking title.
HIGH_CONFIDENCE_RELEVANCE = 0.7

# HOW MUCH SKILL EVIDENCE, BY HOW BADLY THE SCREENER RATED IT. Graded rather
# than flat, and the reason is what this check reads: Tavily's `content` is a
# SNIPPET, a few hundred characters, not the full posting. Demanding two
# skill names from a paragraph fails honest matches that simply didn't fit
# both into the excerpt — measured, a flat two-hit bar cut the genomics run
# to a single listing by dropping real research roles.
#
#   relevance 0.3-0.7 : one skill hit. The screener already thinks it is
#                       plausible; one concrete term confirms the field.
#   relevance below   : two hits. The screener thinks it is wrong, so
#     0.3               overriding that needs more than a coincidence —
#                       "Python" alone appears in plenty of unrelated ads.
MIN_SKILL_HITS_PLAUSIBLE = 1
MIN_SKILL_HITS_TO_RESCUE = 2

# How many of the candidate's skills to test. Enough to characterise a field
# without turning the check into a scan of a 40-item list per listing.
_FIELD_SKILL_SAMPLE = 20

# The heuristic fallback path (_normalize_result) scores on a plain skill
# ratio rather than the screener's relevance, and has always been more
# generous about what counts as a partial match. Named rather than inline so
# the difference between the two paths is visible instead of accidental.
_HEURISTIC_PARTIAL_MATCH = 0.2


def candidate_field_terms(facts_json: dict, required_skills: list[str]) -> list[str]:
    """
    The vocabulary that characterises this candidate's field, taken verbatim
    from their CV — their own skills first, then the JD's required skills.

    Nothing is inferred about the candidate here: these are strings they (or
    the posting) actually wrote. Deduplicated case-insensitively, order
    preserved so the CV's own wording leads.
    """
    terms: list[str] = []
    seen: set[str] = set()
    skills = (facts_json.get("skills") or {}) if isinstance(facts_json, dict) else {}
    for bucket in list(skills.values()) + [required_skills]:
        if not isinstance(bucket, list):
            continue
        for raw in bucket:
            term = str(raw or "").strip()
            key = term.lower()
            # One- and two-character "skills" match everything; skip them.
            if len(term) < 3 or key in seen:
                continue
            seen.add(key)
            terms.append(term)
            if len(terms) >= _FIELD_SKILL_SAMPLE:
                return terms
    return terms


def field_skill_hits(content: str, title: str, field_terms: list[str]) -> int:
    """
    How many of the candidate's own skills this listing actually mentions.

    Reuses the BM25 phrase coverage built for the ATS scorer in Section 4
    rather than substring matching, so "variant calling" still counts when a
    posting says "calls variants" — the same grammatical-variant tolerance,
    and the same refusal to invent a match that isn't there.
    """
    if not field_terms:
        return 0
    counts, length = _stem_counts(f"{title or ''} {content or ''}")
    if not length:
        return 0
    return sum(
        1 for term in field_terms
        if phrase_coverage(term, counts, length) >= PHRASE_COVERAGE_THRESHOLD
    )


# ─── MATCH TIER ──────────────────────────────────────────────────────────────
# THE TIER IS THE VALUE; THE LABEL IS A RENDERING OF IT.
#
# This used to emit only "Strong Match" / "Partial Match" / "Stretch Role" as
# English prose, which the frontend then had to substring-match to pick a
# colour and printed verbatim. On an Arabic generation the user got an
# otherwise fully Arabic result with three English badges in it, on the
# primary language of the product.
#
# match_tier is a stable machine-readable key, so the UI localizes it the same
# way it localizes everything else and nothing downstream has to parse prose.
#
# match_label IS STILL SENT, and must stay. Every similar_jobs list ever
# returned has been persisted into the user's resume history (see
# lib/supabase/resumes.ts), so rows written before this change carry only the
# English label and still have to render. The frontend prefers the tier and
# falls back to deriving it from the label for those rows.
MATCH_LABELS_EN = {
    "strong":  "Strong Match",
    "partial": "Partial Match",
    "stretch": "Stretch Role",
}


def _match_tier(score: float, strong: float, partial: float) -> str:
    """Score to tier key. Thresholds are passed in because the screened and
    heuristic paths genuinely use different ones."""
    if score >= strong:
        return "strong"
    if score >= partial:
        return "partial"
    return "stretch"


def _set_match(job: dict, score: float, strong: float, partial: float) -> None:
    """Writes both fields together, so they can never disagree."""
    tier = _match_tier(score, strong, partial)
    job["match_tier"] = tier
    job["match_label"] = MATCH_LABELS_EN[tier]

# How much of each result's crawled text the screener sees. Enough to judge
# "posting vs article" and spot a location, without turning one screen into
# a huge prompt.
_SCREEN_CONTENT_CHARS = 900


def _llm_screen_listings(
    candidates: list[dict],
    job_title: str,
    location: str,
    required_skills: list[str],
    field_terms: list[str] | None = None,
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

        # CLOSED IS NOW A HARD EXCLUSION, not a sort key.
        #
        # It used to only sink a closed listing to the bottom, on the theory
        # that a closed real opening beats returning nothing. It does not: a
        # user who clicks through to "this position has been filled" has been
        # sent to a dead end, which is worse than a shorter list. This is the
        # "1 relevant listing that was already closed" from the report.
        if verdict.get("is_open") is False:
            rejected["closed"] += 1
            continue

        # DOMAIN RELEVANCE — see HIGH_CONFIDENCE_RELEVANCE for the two bands.
        # A confident match stands on its own; anything less has to show the
        # candidate's own skills in the listing text before it can be shown.
        if relevance < HIGH_CONFIDENCE_RELEVANCE:
            required_hits = (
                MIN_SKILL_HITS_PLAUSIBLE if relevance >= _PARTIAL_MATCH
                else MIN_SKILL_HITS_TO_RESCUE
            )
            hits = field_skill_hits(
                candidates[idx].get("_content") or "",
                candidates[idx].get("title") or "",
                field_terms or [],
            )
            if hits < required_hits:
                rejected["off_field"] += 1
                continue
            if relevance < _PARTIAL_MATCH:
                # The screener rated it poorly but the candidate's skills are
                # demonstrably in it — worth knowing how often that happens.
                rejected["low_score_kept_on_skill_evidence"] += 1

        # Location stays a SORT KEY rather than a filter: the screener is
        # told to accept the surrounding region, so a Gulf role for a Saudi
        # candidate is legitimate and simply ranks below a local one.
        location_ok = verdict.get("location_ok") is not False
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
        # Carried through so the ranking is inspectable rather than implied
        # by the tier label alone. Additive and optional — older persisted
        # rows simply don't have it.
        job["relevance"] = round(relevance, 2)
        _set_match(job, relevance, _STRONG_MATCH, _PARTIAL_MATCH)
        # `_content` is kept for now: the liveness pass and the duplicate
        # check below still need it. It is stripped in _finalize_listings
        # before anything is serialized to the API or the user's history.
        job.pop("_skill_ratio", None)

        # Sort: right-location first, then relevance BANDED to one decimal,
        # then source tier, then exact relevance. Banding is what makes the
        # priority weighting real without letting it distort: 0.9 from
        # Jadarat and 0.9 from LinkedIn land in the same band and Jadarat
        # takes it, while 0.9 from LinkedIn still beats 0.6 from Jadarat.
        tier_rank = _TIER_RANK.get(candidates[idx].get("_tier", "open"), 1)
        accepted.append(((location_ok, round(relevance, 1), tier_rank, relevance), job))

    if rejected:
        logger.info(f"🔍 Screener verdicts: {dict(rejected)}")

    accepted.sort(key=lambda pair: pair[0], reverse=True)
    return [job for _, job in accepted]


# ─── LIVENESS: IS THE LISTING STILL THERE? ──────────────────────────────────
#
# The screener can only judge what Tavily crawled, which may be days old, and
# _CLOSED_SIGNALS only catches boards that render "this job has closed" as
# text. Neither notices a posting that has simply been DELETED. A single
# request per finalist answers that directly.
#
# WHAT IS AND ISN'T TREATED AS DEAD, and why the asymmetry:
#   404 / 410  -> dead. The page is gone; the user would land on nothing.
#   anything else, including 403, 429, timeouts, connection errors -> KEPT.
#     Job boards block automated requests constantly (LinkedIn in
#     particular). Reading "403 Forbidden" as "the job is gone" would delete
#     good listings from the biggest boards on the list. When the check
#     cannot answer, it must not vote.
_LIVENESS_TIMEOUT_SECONDS = 4.0
_LIVENESS_DEAD_STATUSES = {404, 410}
# Enough to look like a browser; boards routinely 403 an unadorned client.
_LIVENESS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TarshihJobCheck/1.0; +https://tarshih.com)",
    "Accept": "text/html,application/xhtml+xml",
}

# Only worth checking the listings that could actually be shown, plus a
# little headroom to backfill from when one turns out to be dead.
_LIVENESS_CHECK_LIMIT = RESULT_CAP + 3


def _listing_is_dead(url: str) -> bool:
    """
    True only when the URL definitively no longer exists.

    HEAD first because it costs a fraction of a GET; some boards don't
    implement it and answer 405, in which case a GET settles it.
    """
    try:
        with httpx.Client(
            timeout=_LIVENESS_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers=_LIVENESS_HEADERS,
        ) as client:
            response = client.head(url)
            if response.status_code in (405, 501):
                response = client.get(url)
            return response.status_code in _LIVENESS_DEAD_STATUSES
    except Exception:
        # Timeout, DNS failure, TLS problem, blocked — all "cannot answer".
        return False


def _drop_dead_listings(jobs: list[dict]) -> list[dict]:
    """Removes listings whose URL 404s, checking them concurrently."""
    to_check = jobs[:_LIVENESS_CHECK_LIMIT]
    if not to_check:
        return jobs

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(to_check)) as executor:
        dead_flags = list(executor.map(lambda j: _listing_is_dead(j.get("url", "")), to_check))

    alive = [job for job, dead in zip(to_check, dead_flags) if not dead]
    dropped = len(to_check) - len(alive)
    if dropped:
        logger.info(f"🔍 Liveness check dropped {dropped} listing(s) whose page no longer exists.")
    return alive + jobs[_LIVENESS_CHECK_LIMIT:]


def _drop_duplicate_roles(jobs: list[dict]) -> list[dict]:
    """
    Collapses the same opening posted at more than one URL.

    URL de-duplication already happens while candidates are gathered, but the
    same role at the same employer routinely appears under two different
    listing ids on the same board — the genomics test run returned the
    identical Guardian Industries role twice, occupying two of five slots.
    Keyed on role plus employer, so genuinely different openings at one
    company are untouched.
    """
    kept, seen = [], set()
    for job in jobs:
        key = (
            _normalize_for_match(job.get("title", "")),
            _normalize_for_match(job.get("company", "")),
        )
        if key in seen and any(key):
            continue
        seen.add(key)
        kept.append(job)
    if len(kept) < len(jobs):
        logger.info(f"🔍 Collapsed {len(jobs) - len(kept)} duplicate listing(s) of the same role.")
    return kept


def _finalize_listings(jobs: list[dict]) -> list[dict]:
    """Duplicate collapse, then liveness, then cap — and strip internals."""
    jobs = _drop_duplicate_roles(jobs)
    jobs = _drop_dead_listings(jobs)
    final = jobs[:RESULT_CAP]
    for job in final:
        # Every leading-underscore field is internal and must not reach the
        # API response or the user's persisted resume history.
        for internal in ("_content", "_skill_ratio", "_tier"):
            job.pop(internal, None)
    return final


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


# Ranking weight per source lane. Used as a TIE-BREAK behind relevance, not
# ahead of it: "priority weighting" means Jadarat wins against an equally
# good match elsewhere, NOT that a weak government listing outranks a strong
# one from anywhere else. Sorting tier above relevance would have done the
# latter, which is how a priority board becomes a way to show worse results.
_TIER_RANK = {"priority": 4, "trusted": 3, "saudi": 2, "open": 1}


def _tag_tier(candidates: list[dict], tier: str) -> list[dict]:
    for candidate in candidates:
        candidate["_tier"] = tier
    return candidates


def _search_tavily(client: TavilyClient, query: str, domains: list[str] | None, max_results: int):
    """`domains=None` searches the whole web — that's the open lane."""
    try:
        kwargs = dict(
            query=query,
            search_depth='advanced',
            max_results=max_results,
            time_range=SEARCH_TIME_RANGE,
        )
        if domains:
            kwargs["include_domains"] = domains
        results = client.search(**kwargs)
        return results.get('results', [])
    except Exception as e:
        logger.error(f"❌ Tavily API search failed for domains {domains or 'OPEN WEB'}: {e}")
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

    # Recover the real title for a Jadarat vacancy before the noise checks
    # run, or its route-name title ("JobDetails") trips _NOISE_EXACT_TITLES
    # and the priority lane silently drops its own postings. See
    # jadarat_posting_title.
    recovered = jadarat_posting_title(url, content)
    if recovered:
        title = recovered
    if _looks_like_scam(content):
        return None, "scam"
    if _looks_closed(content, title):
        return None, "closed"
    if _looks_like_noise_page(title, url, content):
        return None, "noise"

    source = url.split('/')[2] if '/' in url and len(url.split('/')) > 2 else "Job Board"
    matched = sum(1 for skill in required_skills_lower if skill in content.lower())
    ratio = (matched / len(required_skills_lower[:5])) if required_skills_lower else 0.5

    job = {
        'title': title,
        'url': url,
        'snippet': content[:200] + "...",
        'source': source,
        '_content': content,
        '_skill_ratio': ratio,
    }
    _set_match(job, ratio, _STRONG_MATCH, _HEURISTIC_PARTIAL_MATCH)
    return job, "ok"


def _heuristic_filter(
    candidates: list[dict],
    location_terms: list[str],
    field_terms: list[str] | None = None,
) -> list[dict]:
    """
    FALLBACK ONLY — used when _llm_screen_listings couldn't run. Applies the
    old word/URL-list rules so a degraded run still doesn't return blog
    posts or wrong-country roles. See the _EDITORIAL_URL_SIGNALS banner for
    why these aren't the primary mechanism.

    The domain-relevance floor applies here too, using the candidate's own
    skills directly since there is no screener relevance to lean on. A
    degraded run should still not hand a geneticist an aluminium job.
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
        if field_terms and field_skill_hits(
            c.get('_content') or "", c.get('title') or "", field_terms
        ) < MIN_SKILL_HITS_TO_RESCUE:
            dropped["off_field"] += 1
            continue
        kept.append(c)

    if dropped:
        logger.info(f"🔍 Heuristic fallback dropped: {dict(dropped)}")
    kept.sort(key=lambda c: c.get('_skill_ratio', 0), reverse=True)
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
) -> tuple[list[dict], list[dict]]:
    """
    One full search pass across THREE LANES, queried concurrently:

      priority : Jadarat and Ajeer, the Saudi government platforms.
      trusted  : the established boards and aggregators in TRUSTED_DOMAINS.
      open     : Tavily with NO domain restriction at all.

    The open lane is the point of this pass. It is what lets a vacancy that
    exists only on an employer's own careers page be found, which no
    allowlist can do. Its results are held to is_legitimate_open_web_result
    before they are allowed into the pool; the other two lanes are
    pre-vetted by being named and skip that check.

    Returns (named, open_web) so the caller can keep priority and trusted
    results ahead of open-web ones in the pool.
    """
    logger.info(f"🔍 Agent 6 — Querying Tavily for listings matching: '{query}'...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        priority_future = executor.submit(_search_tavily, client, query, PRIORITY_DOMAINS, RAW_FETCH_LIMIT)
        trusted_future = executor.submit(_search_tavily, client, query, TRUSTED_DOMAINS, RAW_FETCH_LIMIT)
        saudi_future = executor.submit(
            _search_tavily, client, query, SAUDI_AGGREGATOR_DOMAINS, SAUDI_AGGREGATOR_FETCH_LIMIT
        )
        # domains=None -> no include_domains -> the whole web.
        open_future = executor.submit(_search_tavily, client, query, None, RAW_FETCH_LIMIT)
        priority_result = priority_future.result()
        trusted_result = trusted_future.result()
        saudi_result = saudi_future.result()
        open_result = open_future.result()

    priority_raw = [r for r in priority_result if _matches_any_domain(r.get('url', ''), PRIORITY_DOMAINS)]
    trusted_raw = [r for r in trusted_result if _matches_any_domain(r.get('url', ''), TRUSTED_DOMAINS)]
    saudi_raw = [r for r in saudi_result if _matches_any_domain(r.get('url', ''), SAUDI_AGGREGATOR_DOMAINS)]

    # Anything from any lane that isn't on a named domain goes through the
    # legitimacy filter. Pulling these from every lane (not just the open
    # one) matters because include_domains is a PREFERENCE — the priority
    # and trusted searches return off-list results too, and those used to be
    # discarded or held in reserve.
    named_urls = {r.get('url', '') for r in priority_raw + trusted_raw + saudi_raw}
    open_raw, rejected = [], Counter()
    for r in priority_result + trusted_result + saudi_result + open_result:
        url = r.get('url') or ''
        if not url or url in named_urls:
            continue
        named_urls.add(url)  # also dedupes the open lane against itself
        ok, reason = is_legitimate_open_web_result(url, r.get('title') or '', r.get('content') or '')
        if ok:
            open_raw.append(r)
        else:
            rejected[reason] += 1
    if rejected:
        logger.info(f"🔍 Legitimacy filter rejected off-list results: {dict(rejected)}")

    priority_candidates = _tag_tier(_collect_candidates(priority_raw, required_skills_lower), "priority")
    trusted_candidates = _tag_tier(_collect_candidates(trusted_raw, required_skills_lower), "trusted")
    saudi_candidates = _tag_tier(_collect_candidates(saudi_raw, required_skills_lower), "saudi")
    open_candidates = _tag_tier(_collect_candidates(open_raw, required_skills_lower), "open")

    # PER-LANE HEALTH, LOGGED EVERY PASS. A lane that returns nothing looks
    # identical to a lane that was never queried, which is how Ajeer sat in
    # the priority list contributing zero — and how Jadarat's postings were
    # being dropped by our own noise filter — without either being visible.
    # Raw vs. usable is the pair that matters: raw>0 with usable=0 means WE
    # are rejecting them, while raw=0 means the source has nothing to give.
    lanes = (
        ("priority", len(priority_result), len(priority_raw), len(priority_candidates)),
        ("trusted", len(trusted_result), len(trusted_raw), len(trusted_candidates)),
        ("saudi", len(saudi_result), len(saudi_raw), len(saudi_candidates)),
        ("open", len(open_result), len(open_raw), len(open_candidates)),
    )
    logger.info(
        "🔍 Lane health (returned/on-domain/usable): "
        + ", ".join(f"{name} {ret}/{on}/{use}" for name, ret, on, use in lanes)
    )
    for name, ret, on, use in lanes:
        if on and not use:
            logger.warning(
                f"⚠️  Lane '{name}' returned {on} on-domain result(s) but none survived "
                f"pre-screen filtering — the filters are rejecting this source, not the "
                f"source being empty."
            )

    return priority_candidates + trusted_candidates + saudi_candidates, open_candidates


def _run_search_passes(
    client: TavilyClient,
    queries: list[str],
    required_skills_lower: list[str],
) -> list[tuple[list[dict], list[dict]]]:
    """
    Runs several query variants at the same time, returning one
    (named, open_web) pair per query IN QUERY ORDER, not completion order.

    Order matters even though the model re-ranks everything afterwards: the
    caller dedupes by URL as it absorbs these, so whichever pass sees a URL
    first is the one whose copy is kept. Preserving query order keeps that
    deterministic, so the same search doesn't return subtly different
    results run to run depending on which request happened to finish first.

    Each pass now fans out to THREE Tavily searches (priority, trusted,
    open web), so the real concurrency is 3x len(queries) — at most twelve
    in flight given the caller's four query variants, still one round
    trip's worth of latency and well inside Tavily's limits.
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


# ─── SOURCING REAL POSTINGS FOR A BARE JOB TITLE ────────────────────────────
#
# Used by agents/jd_analyzer.py when the user gave a job TITLE and no job
# description. Tailoring against a bare title produces almost no weight
# factors — no required skills, no ATS keywords, no seniority — and every
# stage downstream (tailoring, ATS scoring, match scoring) is only as good as
# what it was given. So the title is turned into a representative JD built
# out of real, current postings for that title first.
#
# THIS DELIBERATELY REUSES THE SEARCH LANES rather than adding a second
# search path: _run_search_passes is the same priority/trusted/Saudi/open-web
# fan-out the similar-jobs feature uses, with the same legitimacy filter on
# off-list domains and the same recency window. A separate "just get me some
# JD text" search would have quietly reintroduced the spam and dead-listing
# problems that filter exists to solve.
JD_SOURCE_POSTINGS = 6           # how many postings to compose a JD from
JD_SOURCE_MIN_CONTENT = 400      # chars — below this it's a search snippet, not a posting


def fetch_postings_for_title(
    job_title: str,
    location: str | None = None,
    limit: int = JD_SOURCE_POSTINGS,
) -> list[dict]:
    """
    Real, currently-live postings for a job title, as raw text to compose a
    representative JD from.

    Returns [{title, url, source, content}], most authoritative lane first
    (Jadarat and the trusted boards ahead of open-web finds). Returns [] on
    any failure — the caller falls back to analysing the bare title, which is
    worse but still works, and is never worth failing a paid run over.

    Note this returns the postings' TEXT, not listings for display. Nothing
    here is shown to the user; agents/jd_analyzer.py reads these to build one
    composite description of what the role generally requires.
    """
    title = (job_title or "").strip()
    if not title:
        return []

    api_key = os.getenv('TAVILY_API_KEY')
    if not api_key:
        logger.error("❌ TAVILY_API_KEY missing — cannot source postings for a title-only submission.")
        return []

    where = (location or "").strip()
    # Two query shapes: one aimed at the body of a posting (the words that
    # appear in a real requirements section), one at the vacancy itself.
    # Both are location-qualified when we know where the candidate is, so a
    # Saudi applicant gets a JD reflecting the market they're applying into.
    queries = [
        f'"{title}" job description responsibilities requirements qualifications {where}'.strip(),
        f'{title} vacancy hiring {where}'.strip(),
    ]

    try:
        client = TavilyClient(api_key=api_key)
        # required_skills_lower=[] — there are no known required skills yet;
        # that is the entire reason this function is being called. It only
        # affects the heuristic skill ratio, which this caller ignores.
        passes = _run_search_passes(client, queries, required_skills_lower=[])
    except Exception as e:
        logger.error(f"❌ Sourcing postings for title '{title}' failed: {e}")
        return []

    postings: list[dict] = []
    seen_urls: set[str] = set()
    # named lanes first across all passes, then open web — same precedence
    # the similar-jobs pool uses.
    for group_index in (0, 1):
        for named, open_web in passes:
            for candidate in (named, open_web)[group_index]:
                url = candidate.get("url") or ""
                content = candidate.get("_content") or ""
                if not url or url in seen_urls:
                    continue
                if len(content) < JD_SOURCE_MIN_CONTENT:
                    continue
                seen_urls.add(url)
                postings.append({
                    "title": candidate.get("title") or title,
                    "url": url,
                    "source": candidate.get("source") or "",
                    "content": content,
                })
                if len(postings) >= limit:
                    break
            if len(postings) >= limit:
                break
        if len(postings) >= limit:
            break

    logger.info(
        f"🧾 Sourced {len(postings)} real posting(s) for title-only submission '{title}'"
        + (f" near '{where}'" if where else "")
    )
    return postings


# ─── STANDALONE TITLE SEARCH (the Job Search page) ──────────────────────────
#
# Powers /api/v1/job-search: a title, optionally "internships", and nothing
# else. No CV, no JD, no weight factors.
#
# EVERYTHING BELOW GOES THROUGH THE SAME PIPELINE find_similar_jobs USES —
# the four search lanes, the legitimacy filter on off-list domains, the model
# screen, duplicate collapse and the liveness check (_finalize_listings). A
# second, simpler search path would have been much less code and would have
# reintroduced every problem Sections 5 and 6 exist to solve: closed
# listings, content-farm pages, and results from nowhere near the user.
#
# WHAT'S DIFFERENT is only what the search has to work with. There is no CV,
# so there are no required skills to weight a query by and no candidate field
# vocabulary to act as the relevance safety net. The title carries all of it,
# which is why the related-title expansion below matters more here than it
# would inside the tailoring flow.

# How close a listing's title must sit to the requested one to count as an
# EXACT/CLOSE match rather than an adjacent role. Uses the ATS scorer's own
# title machinery (_title_subject strips seniority words, phrase_coverage
# does stemmed partial-phrase coverage) so "is this the same role" is
# answered the same way here as it is when scoring a CV against a JD.
TITLE_CLOSE_COVERAGE = 0.6

# Related titles are only searched when the exact pass came up short. Set at
# the display cap: if the exact pass already fills the page, adjacent roles
# would push genuine matches off it.
RELATED_TITLES_MAX = 5

# How many listings the "related roles" group can hold. Larger than
# RESULT_CAP because this group carries BOTH the pass-1 results whose titles
# didn't match closely AND everything the adjacent-title searches found —
# capping it at RESULT_CAP meant paying for expansion searches whose results
# were then sliced away.
RELATED_CAP = RESULT_CAP * 2

RELATED_TITLES_PROMPT = """
List job titles that a person searching for "{job_title}" would also realistically
apply to, in the same field and at a similar level.

RULES:
- Return between 3 and {count} titles.
- They must be ADJACENT ROLES, not rewordings of the same title. For
  "IT Technician" good answers are "IT Support Specialist", "Help Desk
  Technician", "Desktop Support Engineer". A bad answer is "Technician, IT".
- Stay at the same seniority. Do not return manager titles for a junior role.
- Stay in the same field. A "Data Analyst" must not return "Data Entry Clerk".
- Use the ordinary English title an employer would advertise.

Return ONLY a JSON array of strings. No commentary.
"""


def related_job_titles(job_title: str, count: int = RELATED_TITLES_MAX) -> list[str]:
    """
    Adjacent roles for a title, for the expansion pass.

    WHY A MODEL CALL AND NOT A MAPPING. The codebase's existing variant
    machinery (utils/ats_scorer.py's _KNOWN_EQUIVALENTS) is a hand-maintained
    list of unambiguous ABBREVIATIONS — "js"/"javascript", "ml"/"machine
    learning". That shape works because the pairs are closed and universal.
    Adjacent job titles are neither: they differ per field, per country and
    per employer, and a hand-kept table would need entries for nursing,
    logistics, genomics and every other field this product serves before it
    helped anyone. So the mapping pattern is reused where it fits — matching
    a returned listing back to the requested title, via _title_subject and
    phrase_coverage below — and a model generates the adjacent titles, which
    is the half no table can cover.

    Returns [] on any failure; the caller then simply shows the exact matches
    it already has.
    """
    title = (job_title or "").strip()
    if not title:
        return []
    try:
        raw = generate_gemini_json(RELATED_TITLES_PROMPT.format(job_title=title, count=count))
        parsed = json.loads(raw)
    except Exception as e:
        logger.warning(f"🧭 Could not generate related titles for '{title}': {e}")
        return []

    if not isinstance(parsed, list):
        return []

    requested_subject = _title_subject(title)
    out: list[str] = []
    for item in parsed:
        candidate = str(item or "").strip()
        if not candidate or len(candidate) > 80:
            continue
        # Drop anything that is really the same title reworded — it would
        # just re-run the exact pass under a different string.
        if _title_subject(candidate) == requested_subject:
            continue
        if candidate.lower() in {o.lower() for o in out}:
            continue
        out.append(candidate)
        if len(out) >= count:
            break
    return out


def _title_closeness(listing_title: str, requested_title: str) -> float:
    """
    How well a listing's title covers the requested one, 0-1.

    Same two helpers the ATS title component uses: seniority words are
    stripped so "Senior IT Technician" still reads as the same ROLE as
    "IT Technician", and coverage is stemmed partial-phrase rather than exact
    string equality.
    """
    subject = _title_subject(requested_title)
    if not subject:
        return 0.0
    return phrase_coverage(subject, *_stem_counts(_title_subject(listing_title)))


def _title_search_queries(job_title: str, location: str, internships: bool) -> list[str]:
    """Progressively broader queries for one title, same shape as
    find_similar_jobs' ladder."""
    where = f" in {location}" if location else ""
    if internships:
        return [
            f"{job_title} internship trainee program applications open{where}",
            f"{job_title} intern vacancies apply{where}",
            f"{job_title} internship hiring now",
        ]
    return [
        f"{job_title} active job openings hiring{where}",
        f"{job_title} jobs vacancies apply{where}",
        f"{job_title} jobs hiring now",
    ]


def _search_one_title(
    client: TavilyClient,
    job_title: str,
    location: str,
    internships: bool,
    seen_urls: set[str],
) -> list[dict]:
    """One title's worth of candidates, deduped against everything already
    seen. Named-source results first, open-web after, exactly as the
    similar-jobs pool orders them."""
    queries = _title_search_queries(job_title, location, internships)
    candidates: list[dict] = []
    open_web: list[dict] = []

    def absorb(batch: list[dict], into: list[dict]) -> None:
        for candidate in batch:
            url = candidate.get("url") or ""
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            into.append(candidate)

    # Same staging as find_similar_jobs: the most specific query alone
    # first, the broader ones only if the pool is thin, and concurrently.
    named, opened = _run_search_pass(client, queries[0], [])
    absorb(named, candidates)
    absorb(opened, open_web)

    if len(candidates) + len(open_web) < RESULT_CAP * 3:
        for named, opened in _run_search_passes(client, queries[1:], []):
            absorb(named, candidates)
            absorb(opened, open_web)

    return candidates + open_web


def _screen_and_finalize(
    candidates: list[dict],
    job_title: str,
    location: str,
    internships: bool,
) -> list[dict]:
    """The model screen plus duplicate/liveness finalisation, with the same
    heuristic fallback find_similar_jobs uses when the screen can't run.

    field_terms is the requested title's own words: with no CV there is no
    candidate vocabulary, and the title is the only statement of field the
    user gave us.
    """
    if not candidates:
        return []
    field_terms = [t for t in _title_subject(job_title).split() if len(t) > 2]
    screen_title = f"{job_title} (internship)" if internships else job_title
    screened = _llm_screen_listings(candidates, screen_title, location, [], field_terms=field_terms)
    if screened is None:
        logger.info("🧭 Screening unavailable — falling back to heuristics for this title search.")
        return _finalize_listings(_heuristic_filter(candidates, _location_terms(location), field_terms))
    return _finalize_listings(screened)


def search_jobs_by_title(
    job_title: str,
    location: str | None = None,
    internships: bool = False,
) -> dict:
    """
    The Job Search page's one entry point.

    TWO PASSES, IN ORDER:
      1. EXACT/CLOSE — the requested title. Everything it returns is split by
         _title_closeness into genuine matches for the title and listings
         that came back under it but are really something else.
      2. RELATED — adjacent titles from related_job_titles, and ONLY when
         pass 1 didn't fill the page. This is the "IT Technician then IT
         Support" behaviour: close matches are never displaced by adjacent
         ones, they're appended after them.

    Returns {"exact": [...], "related": [...], "related_titles": [...]} —
    kept as two lists rather than one merged list so the page can label the
    second group honestly instead of implying everything matched the search.
    """
    title = (job_title or "").strip()
    if not title:
        return {"exact": [], "related": [], "related_titles": []}

    api_key = os.getenv('TAVILY_API_KEY')
    if not api_key:
        logger.error("❌ TAVILY_API_KEY missing — job search cannot run.")
        return {"exact": [], "related": [], "related_titles": []}

    client = TavilyClient(api_key=api_key)
    where = (location or "").strip()
    seen_urls: set[str] = set()

    # ── PASS 1: the title itself ──────────────────────────────────────────
    raw = _search_one_title(client, title, where, internships, seen_urls)
    screened = _screen_and_finalize(raw, title, where, internships)

    exact, loose = [], []
    for job in screened:
        closeness = _title_closeness(job.get("title") or "", title)
        (exact if closeness >= TITLE_CLOSE_COVERAGE else loose).append(job)

    logger.info(
        f"🧭 Job search '{title}': {len(exact)} close title match(es), "
        f"{len(loose)} looser result(s) from the same pass."
    )

    # ── PASS 2: adjacent titles, once the EXACT matches are exhausted ─────
    #
    # Gated on len(exact), not on the combined total: a page showing five
    # listings that are all titled something other than what the user typed
    # has not answered the search, so adjacent roles are still worth
    # offering. `loose` (pass-1 results whose titles didn't match closely)
    # shares the related group with them.
    #
    # RELATED_CAP is deliberately larger than RESULT_CAP so the expansion's
    # results are actually shown. Sized at RESULT_CAP it ran five extra
    # Tavily fan-outs and then sliced every one of their results off again —
    # paid for, screened, liveness-checked, discarded. The loop also stops
    # the moment the group is full rather than searching every adjacent
    # title regardless.
    related = loose
    searched_titles: list[str] = []
    if len(exact) < RESULT_CAP:
        for adjacent in related_job_titles(title):
            if len(related) >= RELATED_CAP:
                break
            logger.info(f"🧭 Expanding '{title}' to adjacent role: '{adjacent}'")
            searched_titles.append(adjacent)
            adjacent_raw = _search_one_title(client, adjacent, where, internships, seen_urls)
            related += _screen_and_finalize(adjacent_raw, adjacent, where, internships)

    # A listing can only appear once, and an exact match always wins its slot.
    exact_urls = {job.get("url") for job in exact}
    related = [job for job in related if job.get("url") not in exact_urls]
    related = _drop_duplicate_roles(related)[:RELATED_CAP]

    logger.info(
        f"🧭 Job search '{title}' returning {len(exact)} exact + {len(related)} related"
        + (f" (expanded to {searched_titles})" if searched_titles else " (no expansion needed)")
    )
    # Only titles actually SEARCHED are reported, so the page never labels
    # pass-1 leftovers as having come from an adjacent role.
    return {"exact": exact, "related": related, "related_titles": searched_titles}


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
    open_web: list[dict] = []
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
    # exactly 3 Tavily searches. Firing all four variants up front would be
    # simpler but would quadruple the search spend on every single request
    # to buy latency the common case never needed.
    named, opened = _run_search_pass(client, queries[0], required_skills_lower)
    _absorb(named, candidates)
    _absorb(opened, open_web)

    # THE REMAINING PASSES RUN CONCURRENTLY, not one after another.
    #
    # These only fire when pass 1 came up short, but when they do fire they
    # are independent of each other — none reads the others' output, they
    # just widen the same pool. Sequentially that was up to three ~5s round
    # trips stacked back to back; together it's one. Worst-case Tavily spend
    # is unchanged (the same four queries, three searches each); only the
    # wall-clock arrangement differs.
    #
    # The pool now counts named AND open-web candidates, because open-web
    # results are first-class here rather than a reserve — if the open lane
    # has already produced plenty of legitimate postings there is no reason
    # to keep querying.
    if len(candidates) + len(open_web) < RESULT_CAP * 3 and len(queries) > 1:
        remaining = queries[1:]
        logger.info(
            f"🔍 Pool at {len(candidates)} named + {len(open_web)} open-web candidate(s) — "
            f"broadening with {len(remaining)} more queries, run concurrently..."
        )
        for named, opened in _run_search_passes(client, remaining, required_skills_lower):
            _absorb(named, candidates)
            _absorb(opened, open_web)

    # OPEN-WEB RESULTS ALWAYS JOIN THE POOL — they are no longer a reserve
    # held back until the named boards come up short. They have already
    # passed the legitimacy filter, and they still have to pass the screener,
    # the relevance floor and the liveness check like everything else. This
    # is the change that lets an employer's own careers page compete: held in
    # reserve, a genuine vacancy at a specialist lab was only ever seen when
    # the big boards happened to return too little.
    #
    # They are appended AFTER the named ones so that, when two lanes surface
    # the same role, the pre-vetted copy is the one kept.
    if open_web:
        logger.info(
            f"🔍 Pool: {len(candidates)} from named sources + "
            f"{len(open_web)} legitimacy-checked open-web candidate(s)."
        )
        candidates += open_web

    # Drop the posting the user pasted in as their job description. It's a
    # guaranteed "Strong Match" against itself, and recommending someone the
    # exact job they're already applying to is noise, not a suggestion.
    candidates = _drop_source_job(candidates, weight_factors)

    # The candidate's own field vocabulary, used as the safety net under the
    # screener's relevance judgement — see MIN_SKILL_HITS_TO_RESCUE.
    field_terms = candidate_field_terms(facts_json, required_skills)

    # THE SCREEN — a model reads each candidate and decides whether it's a
    # real posting. Heuristics only step in if that call couldn't be made.
    screened = _llm_screen_listings(
        candidates, job_title, effective_location, required_skills, field_terms=field_terms
    )
    if screened is None:
        filtered = _heuristic_filter(candidates, location_terms, field_terms)
        final = _finalize_listings(filtered)
        logger.info(f"✅ Found {len(final)} job listings via heuristic fallback (screening unavailable).")
        return final

    final = _finalize_listings(screened)
    if len(final) < RESULT_CAP:
        # NOT padded back up to RESULT_CAP. A short list of listings the
        # candidate could actually want is the intended outcome — see
        # MIN_RELEVANCE for the run that made this the rule.
        logger.info(
            f"🔍 Returning {len(final)}/{RESULT_CAP} listings — the rest were off-field, "
            f"closed, duplicated or gone. Not padding with irrelevant results."
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
