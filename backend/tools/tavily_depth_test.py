"""Compare Tavily search_depth basic vs advanced, on real calls.

    cd backend && python tools/tavily_depth_test.py

WHY IT COMPARES LANE CALLS AND NOT WHOLE SEARCHES. Tavily bills per request,
and search_depth is a per-request parameter, so a lane call is both the unit
that is billed and the unit the question is about. Running whole searches
instead would cost far more to answer a question paired lane calls answer
much more cheaply.

COST: 12 basic (1 credit each) + 12 advanced (2 each) = 36 credits.

WHAT DECIDES IT: not just b_only / a_only (whether advanced finds URLs basic
misses) but whether the two depths' `content` disagree on the dead-listing
and scam filter DECISIONS for the same listing. Everything downstream of
those two filters reads title/url/snippet, so a URL-set match alone is
necessary but not sufficient — see pricing-reference-v7.md §1.1 and
prompts/claude-code-prompt-depth-history-allowance.md Part 1 for why.
"""
import concurrent.futures
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()
from tavily import TavilyClient
from agents.jobs_finder import (
    PRIORITY_DOMAINS, TRUSTED_DOMAINS, SAUDI_AGGREGATOR_DOMAINS,
    RAW_FETCH_LIMIT, SEARCH_TIME_RANGE, _looks_like_scam, _listing_is_dead,
)

client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"].strip())

# Twelve real queries the product actually builds, across the four lanes it
# uses, split deliberately into two shapes:
#
#   EXACT  — common titles a search fills entirely from pass 1. These are
#            "convenient": high posting volume, long content, easy for both
#            depths to look fine on. The original 10-query set was entirely
#            this shape.
#   ADJACENT-PRONE — real Saudi-market titles thin enough on any given board
#            that production's search_jobs_by_title would plausibly fall
#            through to the adjacent-title expansion
#            (ADJACENT_EXPANSION_THRESHOLD=1 exact match). If `basic`
#            content is thinner in a way that matters, a low-volume title
#            with fewer, shorter candidate postings is exactly where it
#            would show up first — the filters have less content to work
#            with and no surplus of good candidates to fall back on.
CASES = [
    # -- exact-match, common titles --------------------------------------
    ("Machine Learning Engineer active job openings hiring in Jeddah", None, "exact"),
    ("Machine Learning Engineer active job openings hiring in Jeddah", TRUSTED_DOMAINS, "exact"),
    ("Software Engineer jobs vacancies apply in Riyadh", None, "exact"),
    ("Software Engineer jobs vacancies apply in Riyadh", TRUSTED_DOMAINS, "exact"),
    ("Accountant active job openings hiring in Saudi Arabia", None, "exact"),
    ("Accountant active job openings hiring in Saudi Arabia", SAUDI_AGGREGATOR_DOMAINS, "exact"),
    ("Civil Engineer active job openings hiring in Dammam", PRIORITY_DOMAINS, "exact"),
    # -- adjacent-prone, real but lower-volume Saudi-market titles --------
    ("Genomics Data Analyst active job openings hiring in Saudi Arabia", None, "adjacent-prone"),
    ("Desalination Plant Process Engineer jobs vacancies apply in Saudi Arabia", TRUSTED_DOMAINS, "adjacent-prone"),
    ("Zakat Compliance Specialist jobs vacancies apply in Saudi Arabia", SAUDI_AGGREGATOR_DOMAINS, "adjacent-prone"),
    ("Renewable Energy Technician active job openings hiring in Saudi Arabia", PRIORITY_DOMAINS, "adjacent-prone"),
    ("Halal Certification Auditor jobs hiring now", None, "adjacent-prone"),
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


def has_title(rs):
    return sum(1 for r in rs if (r.get("title") or "").strip())


rows = []
scam_disagreements = []   # same URL, different scam verdict across depths
b_content_lens, a_content_lens = [], []  # pooled per-result lengths, for the true distribution
all_urls_seen = set()     # every URL either depth returned, for one liveness pass

for i, (query, domains, kind) in enumerate(CASES, 1):
    lane = ("open" if domains is None else "trusted" if domains is TRUSTED_DOMAINS
            else "saudi" if domains is SAUDI_AGGREGATOR_DOMAINS else "priority")
    basic, tb = call(query, domains, "basic")
    adv, ta = call(query, domains, "advanced")
    burls, aurls = {r.get("url") for r in basic}, {r.get("url") for r in adv}
    overlap = burls & aurls
    all_urls_seen |= burls | aurls
    b_content_lens += [len(r.get("content") or "") for r in basic]
    a_content_lens += [len(r.get("content") or "") for r in adv]

    # Scam filter decision, per listing, at each depth — content-dependent,
    # so this is where a depth difference could actually show up.
    b_scam = {r.get("url"): _looks_like_scam(r.get("content", "")) for r in basic}
    a_scam = {r.get("url"): _looks_like_scam(r.get("content", "")) for r in adv}
    for url in overlap:
        if b_scam.get(url) != a_scam.get(url):
            scam_disagreements.append(dict(
                query=query[:44], lane=lane, url=url,
                basic_verdict=b_scam.get(url), advanced_verdict=a_scam.get(url),
            ))

    b_med = statistics.median([len(r.get("content") or "") for r in basic]) if basic else 0
    a_med = statistics.median([len(r.get("content") or "") for r in adv]) if adv else 0
    rows.append(dict(
        n=i, lane=lane, kind=kind, q=query[:44],
        b=len(basic), a=len(adv), overlap=len(overlap),
        b_titles=has_title(basic), a_titles=has_title(adv),
        tb=tb, ta=ta,
        b_only=len(burls - aurls), a_only=len(aurls - burls),
    ))
    print(f"{i:2}. [{lane:8}|{kind:14}] {query[:44]:44} basic={len(basic):2} adv={len(adv):2} "
          f"overlap={len(overlap):2} content(median) b/a={b_med:.0f}/{a_med:.0f}")

# ── Dead-listing filter decision, per URL, run ONCE per unique URL ──────────
# `_listing_is_dead` is a pure function of the URL — one live HTTP check
# against the posting page, never reading Tavily's `content` field. That
# means a URL present in both depths' result sets CANNOT get a different
# liveness verdict from the depth itself; the only way `basic` and
# `advanced` could disagree on liveness is a URL that only one depth
# happened to return (a coverage difference, already captured by
# b_only/a_only) or transient network flakiness on the same URL checked
# twice. Checking every URL exactly once (cached) removes that flakiness
# risk rather than assuming the disagreement count is zero.
print(f"\nRunning liveness check against {len(all_urls_seen)} unique URLs...")
dead_cache = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
    futures = {executor.submit(_listing_is_dead, u): u for u in all_urls_seen if u}
    for fut in concurrent.futures.as_completed(futures):
        dead_cache[futures[fut]] = fut.result()

json.dump(dict(
    rows=rows,
    scam_disagreements=scam_disagreements,
    dead_listing_flagged=sum(1 for v in dead_cache.values() if v),
    urls_checked=len(dead_cache),
    b_content_lens=b_content_lens,
    a_content_lens=a_content_lens,
), open("tavily_depth_results.json", "w"), indent=1, default=str)

n = len(rows)
print(f"\n=== SUMMARY over {n} paired lane calls (36 Tavily credits spent) ===")
print(f"results returned          basic {sum(r['b'] for r in rows):3}   advanced {sum(r['a'] for r in rows):3}")
print(f"URLs in both              {sum(r['overlap'] for r in rows):3}")
print(f"only in basic             {sum(r['b_only'] for r in rows):3}")
print(f"only in advanced          {sum(r['a_only'] for r in rows):3}  <- headline number")
print(f"content chars (min/median/max)  "
      f"basic {min(b_content_lens, default=0)}/{statistics.median(b_content_lens) if b_content_lens else 0:.0f}/{max(b_content_lens, default=0)}   "
      f"advanced {min(a_content_lens, default=0)}/{statistics.median(a_content_lens) if a_content_lens else 0:.0f}/{max(a_content_lens, default=0)}")
print(f"results with a title      basic {sum(r['b_titles'] for r in rows):3}   advanced {sum(r['a_titles'] for r in rows):3}")
print(f"avg latency               basic {sum(r['tb'] for r in rows)/n:.2f}s  advanced {sum(r['ta'] for r in rows)/n:.2f}s")
print(f"\nscam filter disagreements (same URL, different verdict): {len(scam_disagreements)}")
for d in scam_disagreements:
    print(f"  [{d['lane']}] {d['query']}: basic={d['basic_verdict']} advanced={d['advanced_verdict']} {d['url']}")
print(f"dead-listing check: {sum(1 for v in dead_cache.values() if v)} of {len(dead_cache)} unique URLs flagged dead "
      "(URL-keyed — cannot disagree by depth for a shared URL; see comment above)")
