"""Compare Tavily search_depth basic vs advanced, on real calls.

    cd backend && python tools/tavily_depth_test.py

WHY IT COMPARES LANE CALLS AND NOT WHOLE SEARCHES. Tavily bills per request,
and search_depth is a per-request parameter, so a lane call is both the unit
that is billed and the unit the question is about. Running ten whole searches
instead would cost ~720 credits to answer a question ten paired lane calls
answer for 30.

COST: 10 basic (1 credit each) + 10 advanced (2 each) = 30 credits.

WHAT DECIDES IT: the b_only / a_only columns. If advanced returns URLs basic
does not, the trade is a quality change and not just a cost one — everything
downstream reads title/url/snippet, but `content` also feeds the dead-listing
and scam filters, so a shorter one could weaken them silently.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()
from tavily import TavilyClient
from agents.jobs_finder import (PRIORITY_DOMAINS, TRUSTED_DOMAINS,
                                SAUDI_AGGREGATOR_DOMAINS, RAW_FETCH_LIMIT,
                                SEARCH_TIME_RANGE)

client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"].strip())

# Ten real queries the product actually builds, across the lanes it uses.
CASES = [
    ("Machine Learning Engineer active job openings hiring in Jeddah", None),
    ("Machine Learning Engineer active job openings hiring in Jeddah", TRUSTED_DOMAINS),
    ("Software Engineer jobs vacancies apply in Riyadh", None),
    ("Software Engineer jobs vacancies apply in Riyadh", TRUSTED_DOMAINS),
    ("Accountant active job openings hiring in Saudi Arabia", None),
    ("Accountant active job openings hiring in Saudi Arabia", SAUDI_AGGREGATOR_DOMAINS),
    ("Data Analyst jobs hiring now", None),
    ("Nurse active job openings hiring in Riyadh", None),
    ("Graphic Designer jobs vacancies apply in Jeddah", None),
    ("Civil Engineer active job openings hiring in Dammam", PRIORITY_DOMAINS),
]

def call(query, domains, depth):
    kwargs = dict(query=query, search_depth=depth, max_results=RAW_FETCH_LIMIT,
                  time_range=SEARCH_TIME_RANGE)
    if domains:
        kwargs["include_domains"] = domains
    t0 = time.time()
    try:
        r = client.search(**kwargs).get("results", [])
    except Exception as e:
        print(f"    ERROR {depth}: {type(e).__name__}: {str(e)[:90]}")
        return [], 0.0
    return r, time.time() - t0

rows = []
for i, (query, domains) in enumerate(CASES, 1):
    lane = "open" if domains is None else ("trusted" if domains is TRUSTED_DOMAINS
           else "saudi" if domains is SAUDI_AGGREGATOR_DOMAINS else "priority")
    basic, tb = call(query, domains, "basic")
    adv, ta = call(query, domains, "advanced")
    burls, aurls = {r.get("url") for r in basic}, {r.get("url") for r in adv}
    overlap = len(burls & aurls)
    def avg_content(rs):
        lens = [len(r.get("content") or "") for r in rs]
        return sum(lens) / len(lens) if lens else 0
    def has_title(rs):
        return sum(1 for r in rs if (r.get("title") or "").strip())
    rows.append(dict(n=i, lane=lane, q=query[:44],
                     b=len(basic), a=len(adv), overlap=overlap,
                     b_content=avg_content(basic), a_content=avg_content(adv),
                     b_titles=has_title(basic), a_titles=has_title(adv),
                     tb=tb, ta=ta,
                     b_only=len(burls - aurls), a_only=len(aurls - burls)))
    print(f"{i:2}. [{lane:8}] {query[:44]:44} basic={len(basic):2} adv={len(adv):2} "
          f"overlap={overlap:2} content b/a={avg_content(basic):.0f}/{avg_content(adv):.0f}")

json.dump(rows, open("tavily_depth_results.json", "w"), indent=1)
n = len(rows)
print(f"\n=== SUMMARY over {n} paired lane calls (30 Tavily credits spent) ===")
print(f"results returned      basic {sum(r['b'] for r in rows):3}   advanced {sum(r['a'] for r in rows):3}")
print(f"URLs in both          {sum(r['overlap'] for r in rows):3}")
print(f"only in basic         {sum(r['b_only'] for r in rows):3}")
print(f"only in advanced      {sum(r['a_only'] for r in rows):3}")
print(f"avg content chars     basic {sum(r['b_content'] for r in rows)/n:6.0f}   advanced {sum(r['a_content'] for r in rows)/n:6.0f}")
print(f"results with a title  basic {sum(r['b_titles'] for r in rows):3}   advanced {sum(r['a_titles'] for r in rows):3}")
print(f"avg latency           basic {sum(r['tb'] for r in rows)/n:.2f}s  advanced {sum(r['ta'] for r in rows)/n:.2f}s")
