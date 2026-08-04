# agents/jobs_finder.py
import os
import re
import concurrent.futures
from collections import Counter

from tavily import TavilyClient
from loguru import logger
from core.state import AgentState
from core.credits import get_admin_client

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
RAW_FETCH_LIMIT = 10

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
]

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


def _looks_closed(content: str) -> bool:
    content_lower = (content or "").lower()
    return any(signal in content_lower for signal in _CLOSED_SIGNALS)


def _looks_like_scam(content: str) -> bool:
    content_lower = (content or "").lower()
    return any(signal in content_lower for signal in _SCAM_SIGNALS)


def _looks_like_noise_page(title: str, url: str, content: str) -> bool:
    title_lower = (title or "").lower().strip()
    url_lower = (url or "").lower()

    if title_lower in _NOISE_EXACT_TITLES:
        return True
    if any(signal in url_lower for signal in _NOISE_URL_SIGNALS):
        return True
    if _looks_like_aggregator_title(title):
        return True
    if _looks_like_listing_or_category_page(content or ""):
        return True
    return False


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


def _mentions_location(content: str, location: str) -> bool:
    """
    Soft location relevance check — NOT a hard geo-filter (a good remote or
    relocation-friendly listing shouldn't be dropped just because the city
    name isn't in the crawled snippet). Matches on the first comma-separated
    token of the location (usually the city) rather than the full "City,
    Country" string, since listings rarely repeat the candidate's exact
    phrasing.
    """
    if not location:
        return True  # nothing to check against — don't penalize
    city = location.split(",")[0].strip().lower()
    if not city:
        return True
    return city in (content or "").lower()


def _search_tavily(client: TavilyClient, query: str, domains: list[str], max_results: int):
    try:
        results = client.search(
            query=query,
            search_depth='advanced',
            include_domains=domains,
            max_results=max_results,
            time_range='week'
        )
        return results.get('results', [])
    except Exception as e:
        logger.error(f"❌ Tavily API search failed for domains {domains}: {e}")
        return []


def _process_listing(r: dict, required_skills_lower: list[str], effective_location: str) -> tuple[dict | None, str]:
    """
    Turns one raw Tavily result into (job_dict, tier), or (None, reason) if
    it should be dropped outright. tier is "good" (skill AND location both
    check out) or "weak" (only one of the two does — kept only as backfill
    if there isn't enough "good" material). A listing that clears NEITHER
    signal is dropped outright rather than kept as filler — this is what
    keeps a wrong-field, wrong-country result from padding out the list to
    RESULT_CAP.
    """
    content = r.get('content', '') or ''
    title = r.get('title') or 'Job Opening'
    url = r.get('url', '')

    if _looks_closed(content):
        return None, "closed"
    if _looks_like_scam(content):
        return None, "scam"
    if _looks_like_noise_page(title, url, content):
        return None, "noise"

    source = url.split('/')[2] if '/' in url and len(url.split('/')) > 2 else "Job Board"
    snippet_content = content.lower()
    matched_count = sum(1 for skill in required_skills_lower if skill in snippet_content)

    if len(required_skills_lower) == 0:
        match_label = "Partial Match"
        match_ratio = 0.5
    else:
        match_ratio = matched_count / len(required_skills_lower[:5])  # grade against top 5 needed skills
        if match_ratio >= 0.6:
            match_label = "Strong Match"
        elif match_ratio >= 0.2:
            match_label = "Partial Match"
        else:
            match_label = "Stretch Role"

    location_ok = _mentions_location(content, effective_location)
    skill_ok = match_ratio >= 0.2

    if skill_ok and location_ok:
        tier = "good"
    elif skill_ok or location_ok:
        tier = "weak"
    else:
        return None, "irrelevant"

    job = {
        'title': title,
        'url': url,
        'snippet': content[:200] + "...",
        'source': source,
        'match_label': match_label,
    }
    return job, tier


def _classify(raw_results: list[dict], required_skills_lower: list[str], effective_location: str) -> tuple[list[dict], list[dict]]:
    good, weak = [], []
    for r in raw_results:
        job, tier = _process_listing(r, required_skills_lower, effective_location)
        if job is None:
            continue
        (good if tier == "good" else weak).append(job)
    return good, weak


def find_similar_jobs(weight_factors: dict, facts_json: dict, fallback_location: str | None = None) -> list:
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
    location_query_part = f" in {effective_location}" if effective_location else ""

    query = f"{job_title} active job openings hiring {search_skills}{location_query_part}"
    logger.info(f"🔍 Agent 6 — Querying Tavily for listings matching: '{query}'...")

    required_skills_lower = [s.lower() for s in required_skills]

    # Query Jadarat and the fallback boards concurrently — always both,
    # every time (see docstring). Each raw list is post-filtered by
    # _matches_any_domain since Tavily's include_domains isn't a hard
    # allowlist (confirmed by live testing).
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        priority_future = executor.submit(_search_tavily, client, query, PRIORITY_DOMAINS, RAW_FETCH_LIMIT)
        fallback_future = executor.submit(_search_tavily, client, query, FALLBACK_DOMAINS, RAW_FETCH_LIMIT)
        priority_raw = [r for r in priority_future.result() if _matches_any_domain(r.get('url', ''), PRIORITY_DOMAINS)]
        fallback_raw = [r for r in fallback_future.result() if _matches_any_domain(r.get('url', ''), FALLBACK_DOMAINS)]

    good_priority, weak_priority = _classify(priority_raw, required_skills_lower, effective_location)
    good_fallback, weak_fallback = _classify(fallback_raw, required_skills_lower, effective_location)

    # Jadarat's results lead the merged list — that's its "priority"
    # weighting — but nothing here requires it to hit any minimum count.
    combined = good_priority + good_fallback
    if len(combined) < RESULT_CAP:
        combined += weak_priority + weak_fallback

    seen_urls = set()
    final = []
    for job in combined:
        if job['url'] in seen_urls:
            continue
        seen_urls.add(job['url'])
        final.append(job)
        if len(final) >= RESULT_CAP:
            break

    logger.info(
        f"✅ Found {len(final)} matching job listings via Tavily "
        f"({len(good_priority)} good from Jadarat, {len(good_fallback)} good from fallback boards)."
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
    fallback_location = (
        None if _looks_like_real_location(cv_location) else _fetch_profile_location(state.get("user_id"))
    )

    similar_jobs = find_similar_jobs(weight_factors, facts_json, fallback_location=fallback_location)

    return {"similar_jobs": similar_jobs}
