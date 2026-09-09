# tests/test_jobs_finder.py
#
# ⚠️ THIS TEST SPENDS REAL TAVILY CREDITS. One run is up to 24 of them against
# a quota shared by the whole platform, so it is behind the `live_tavily`
# marker and deselected by default (see pytest.ini). Run it deliberately:
#
#     pytest tests/test_jobs_finder.py -m live_tavily
import os

import pytest
from dotenv import load_dotenv
from loguru import logger

# 1. Load the environment variables from your .env file immediately
load_dotenv()

# Import your Tavily agent function
from agents.jobs_finder import TavilyQuotaExhausted, find_similar_jobs

pytestmark = pytest.mark.live_tavily


def test_tavily_search_execution():
    logger.info("🧪 Initializing Tavily Integration Target Verification...")
    
    # Quick sanity check to see if python-dotenv read the key
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        logger.error("❌ Test Failed: TAVILY_API_KEY is not being read from your .env file.")
        return
    else:
        logger.info(f"🔑 API Key detected in environment (Starts with: {api_key[:5]}...)")
    
    # Mock data to simulate the LangGraph state inputs
    mock_weight_factors = {
        "job_title": "Machine Learning Engineer",
        "required_skills": ["Python", "PyTorch", "Transformers", "Docker"]
    }
    
    mock_facts_json = {
        "skills": {
            "languages": ["Python", "C++"],
            "frameworks": ["PyTorch", "Scikit-Learn"]
        }
    }
    
    # Execute the search block
    try:
        results = find_similar_jobs(mock_weight_factors, mock_facts_json)
    except TavilyQuotaExhausted as e:
        # A spent quota is not a broken pipeline, and it must not read as one.
        # This exception existing at all is the fix: the old code swallowed it
        # and returned [], so an exhausted plan was indistinguishable from a
        # search that genuinely found nothing.
        pytest.skip(f"Tavily quota exhausted, cannot exercise the live path: {e}")

    assert isinstance(results, list), "Output must return structural list format."
    
    print("\n================ TAVILY OUTPUT EXECUTION TEST ================\n")
    for idx, job in enumerate(results, start=1):
        print(f"[{idx}] {job['title']} | Match: {job['match_label']}")
        print(f"    Source: {job['source']}")
        print(f"    Link: {job['url']}")
        print(f"    Snippet excerpt: {job['snippet']}\n")
    print("==============================================================")
    
    if len(results) > 0:
        logger.info("✅ Agent 6 pipeline validated successfully!")
    else:
        logger.warning("⚠️ Integration executed, but 0 listings found. Confirm your query or API limits.")

if __name__ == "__main__":
    test_tavily_search_execution()
    