# agents/jobs_finder.py
import os
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
FALLBACK_DOMAINS = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'lever.co', 'greenhouse.io']

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


def _looks_closed(content: str) -> bool:
    content_lower = (content or "").lower()
    return any(signal in content_lower for signal in _CLOSED_SIGNALS)


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


def find_similar_jobs(weight_factors: dict, facts_json: dict, fallback_location: str | None = None) -> list:
    """
    Queries the Tavily API for relevant active job listings posted within the last week
    and applies a matching tier label based on skill overlap.

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
    
    # Extract structural factors for optimal querying
    job_title = weight_factors.get("job_title", "Software Engineer")
    required_skills = weight_factors.get("required_skills", [])
    
    # Take top 3 key skills to make the search targeted but flexible
    search_skills = " ".join(required_skills[:3])

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

    # Two-tier search: Jadarat/Ajeer first, general job boards fill the rest.
    # Tavily's include_domains doesn't support per-domain weighting in one
    # call, so this runs as two searches and merges — priority results
    # first, then fallback results only for whatever's left of the cap.
    RESULT_CAP = 5
    priority_raw = _search_tavily(client, query, PRIORITY_DOMAINS, max_results=RESULT_CAP)
    remaining = RESULT_CAP - len(priority_raw)
    fallback_raw = (
        _search_tavily(client, query, FALLBACK_DOMAINS, max_results=remaining)
        if remaining > 0 else []
    )
    raw_listings = priority_raw + fallback_raw
    processed_jobs = []
    
    # Extract candidate skills for matching comparison
    candidate_skills = []
    skills_dict = facts_json.get("skills", {})
    if isinstance(skills_dict, dict):
        for sublist in skills_dict.values():
            if isinstance(sublist, list):
                candidate_skills.extend([s.lower() for s in sublist])
    
    required_skills_lower = [s.lower() for s in required_skills]

    for r in raw_listings:
        content = r.get('content', '')

        # Skip listings that show their own "closed/expired" boilerplate —
        # better to return fewer, real results than a dead link.
        if _looks_closed(content):
            logger.info(f"⏭️  Skipping likely-closed listing: {r.get('url', '')}")
            continue

        # Determine the source domain gracefully
        url = r.get('url', '')
        source = url.split('/')[2] if '/' in url and len(url.split('/')) > 2 else "Job Board"
        
        # Skill-match grading logic (Labeling mechanism)
        snippet_content = content.lower()
        matched_count = 0
        
        for skill in required_skills_lower:
            if skill in snippet_content:
                matched_count += 1
                
        # Label calculation based on overlap depth
        if len(required_skills_lower) == 0:
            match_label = "Partial Match"
        else:
            match_ratio = matched_count / len(required_skills_lower[:5]) # Grade against top 5 needed skills
            if match_ratio >= 0.6:
                match_label = "Strong Match"
            elif match_ratio >= 0.2:
                match_label = "Partial Match"
            else:
                match_label = "Stretch Role"

        processed_jobs.append({
            'title': r.get('title', 'Job Opening'),
            'url': url,
            'snippet': content[:200] + "...",
            'source': source,
            'match_label': match_label
        })

    logger.info(f"✅ Found {len(processed_jobs)} matching job listings via Tavily "
                f"({len(priority_raw)} from priority boards).")
    return processed_jobs


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

    # CV location always wins if present — this only kicks in when it's
    # empty (e.g. an uploaded PDF with an unusual layout cv_parser.py
    # couldn't extract from). NOTE: assumes state["user_id"] exists —
    # confirm this key name against core/state.py's AgentState; adjust if
    # main.py populates the authenticated user's id under a different key.
    cv_location = ((facts_json.get("personal", {}) or {}).get("location") or "").strip()
    fallback_location = None if cv_location else _fetch_profile_location(state.get("user_id"))

    similar_jobs = find_similar_jobs(weight_factors, facts_json, fallback_location=fallback_location)
    
    return {"similar_jobs": similar_jobs}
