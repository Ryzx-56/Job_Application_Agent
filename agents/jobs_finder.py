# agents/jobs_finder.py
import os
from tavily import TavilyClient
from loguru import logger
from core.state import AgentState

def find_similar_jobs(weight_factors: dict, facts_json: dict) -> list:
    """
    Queries the Tavily API for relevant active job listings posted within the last week
    and applies a matching tier label based on skill overlap.
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
    query = f"{job_title} active job openings hiring {search_skills}"
    
    logger.info(f"🔍 Agent 6 — Querying Tavily for listings matching: '{query}'...")
    
    try:
        # Use Tavily's specialized search arguments for real-time aggregation
        results = client.search(
            query=query,
            search_depth='advanced',
            include_domains=['linkedin.com', 'indeed.com', 'glassdoor.com', 'lever.co', 'greenhouse.io'],
            max_results=5,
            time_range='week'  # Filters for active postings within the last 7 days
        )
    except Exception as e:
        logger.error(f"❌ Tavily API search failed: {e}")
        return []

    raw_listings = results.get('results', [])
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
        # Determine the source domain gracefully
        url = r.get('url', '')
        source = url.split('/')[2] if '/' in url and len(url.split('/')) > 2 else "Job Board"
        
        # Skill-match grading logic (Labeling mechanism)
        snippet_content = r.get('content', '').lower()
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
            'snippet': r.get('content', '')[:200] + "...",
            'source': source,
            'match_label': match_label
        })

    logger.info(f"✅ Found {len(processed_jobs)} matching job listings via Tavily.")
    return processed_jobs


def run_jobs_finder(state: AgentState) -> dict:
    """
    LangGraph execution node for Agent 6.
    Reads input values from state and writes back the structured findings list.
    """
    weight_factors = state.get("weight_factors", {})
    facts_json = state.get("facts_json", {})
    
    similar_jobs = find_similar_jobs(weight_factors, facts_json)
    
    return {"similar_jobs": similar_jobs}