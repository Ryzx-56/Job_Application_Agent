# core/search_provider.py
#
# EVERY WEB SEARCH IN THE PRODUCT GOES THROUGH HERE. Two providers, one
# interface, one switch.
#
# ⚠️ SEARCH_PROVIDER IS THE SWITCH. It is the only line that decides which
# provider answers, and it is env-overridable so a bad day can be rolled back
# from the Render dashboard without a deploy. Both paths are kept and both are
# maintained — this is not a replacement, it is a dispatcher, the same shape
# core/llm_config.py's WRITING_MODEL takes for the writing model.
#
# ─── WHY SERPER ─────────────────────────────────────────────────────────────
#
# Tavily at search_depth='advanced' is 2 credits a call, and its credits cost
# $0.008 — so $0.016 per call. Serper is $0.001 per search. Sixteen times
# cheaper, and its free tier is 2,500 searches against Tavily's 1,000 credits
# (500 advanced calls), so five times more free calls as well.
#
# ─── THE SHAPE OF A RESULT ──────────────────────────────────────────────────
#
# Both providers are normalised to the dict agents/jobs_finder.py already
# consumes:
#
#     {"url": str, "title": str, "content": str, "published_date": str | None}
#
# `content` is the one field that differs in kind rather than in name. Tavily
# returns extracted PAGE CONTENT; Serper returns a Google SNIPPET, which is
# shorter. Three filters in jobs_finder read it —
# _looks_like_listing_or_category_page, _looks_closed and _looks_like_scam —
# and they are the main quality risk in this migration. See SNIPPET_IS_SHORT
# below and the note on each filter.
import contextlib
import os
import threading
import time
from typing import Any, Optional

import httpx
from loguru import logger

# "tavily" or "serper". Env-overridable — see the note above.
SEARCH_PROVIDER = (os.getenv("SEARCH_PROVIDER", "serper") or "serper").strip().lower()


class SearchQuotaExhausted(RuntimeError):
    """The provider is refusing requests because the plan's allowance is spent.

    ITS OWN EXCEPTION, because it is the one search failure that is neither
    transient nor about the query. A network blip should be swallowed and a
    lane should return nothing; THIS must reach the user as "search is
    unavailable this month", not as an empty results page reading "there are
    no jobs for you". Telling a paying subscriber there are no jobs when the
    truth is that we ran out of quota is the worst available reading of this
    failure, and it is what the code did before this existed.
    """


class SearchUnavailable(RuntimeError):
    """The provider could not be reached at all — no key, DNS, a 5xx.

    Distinct from SearchQuotaExhausted because the remedy is different (wait
    and retry, versus top up) and distinct from an empty result because "we
    could not look" is not "there is nothing there". See the rule in
    CLAUDE.md.
    """


# ─── WHAT A CALL COSTS ──────────────────────────────────────────────────────
#
# Per PROVIDER CALL, in the provider's own unit, and the USD each unit costs.
# Reported by the counter below so a search's cost is attributable in one
# place rather than inferred from an invoice.
_PROVIDER_COST = {
    # search_depth='advanced' is 2 credits; Tavily credits are $0.008 on
    # Pay-As-You-Go. Verified against their published API-credit table.
    "tavily": {"units_per_call": 2, "usd_per_unit": 0.008, "unit": "credit"},
    # Serper bills one search per call, $0.001 each on the paid tier.
    "serper": {"units_per_call": 1, "usd_per_unit": 0.001, "unit": "search"},
}


def cost_per_call_usd(provider: str | None = None) -> float:
    c = _PROVIDER_COST[provider or SEARCH_PROVIDER]
    return c["units_per_call"] * c["usd_per_unit"]


def units_per_call(provider: str | None = None) -> int:
    return _PROVIDER_COST[provider or SEARCH_PROVIDER]["units_per_call"]


# ─── CALL ACCOUNTING ────────────────────────────────────────────────────────
#
# Both providers bill PER REQUEST, not per result — so `num`/`max_results` is
# free to raise and the only thing that costs money is how many times a search
# call happens. That single fact is why the Section 9 cuts are about call
# count and why they still apply at any per-call price.
_counter_state = threading.local()


@contextlib.contextmanager
def search_call_counter():
    """
    Counts provider calls, billing units and estimated USD inside the block.

        with search_call_counter() as counter:
            results = search_jobs_by_title(...)
        counter["calls"], counter["units"], counter["usd"]

    ⚠️ THE COUNTER IS PASSED DOWN AS AN ARGUMENT, NOT READ FROM HERE, by
    everything inside jobs_finder. That module nests thread pools two deep —
    queries fan out, then lanes fan out inside each query — and a
    ThreadPoolExecutor worker inherits NO thread-local state. The first
    version of this read the counter from a thread-local inside the lane and
    reported 24 calls for a search that made 72: a 3x undercount that looked
    entirely plausible.
    """
    counter = {"calls": 0, "units": 0, "usd": 0.0, "provider": SEARCH_PROVIDER}
    previous = getattr(_counter_state, "counter", None)
    _counter_state.counter = counter
    try:
        yield counter
    finally:
        _counter_state.counter = previous


def current_counter() -> dict | None:
    """The active counter for THIS thread, to hand down to workers."""
    return getattr(_counter_state, "counter", None)


def record_call(counter: dict | None) -> None:
    """One provider call happened. Counted BEFORE the request, because it is
    billed whether or not it returns anything."""
    target = counter if counter is not None else current_counter()
    if target is None:
        return
    target["calls"] += 1
    target["units"] += units_per_call()
    target["usd"] += cost_per_call_usd()


# ─── HOW MANY site: OPERATORS GOOGLE WILL HONOUR ────────────────────────────
#
# Tavily takes include_domains as a list and applies all of it. Google has no
# such parameter — the equivalent is `(site:a.com OR site:b.com OR ...)` in the
# query text, and it DEGRADES rather than erroring: past roughly eight OR'd
# site: terms Google starts quietly ignoring the later ones, so a lane with
# sixteen domains would silently search the first handful and report that as
# the whole lane.
#
# TRUSTED_DOMAINS currently holds sixteen. So the trusted lane cannot be a
# straight translation; it is split into chunks of this size, and the caller
# decides whether to spend a call on each chunk or to fall back to filtering
# a broad result set by domain (which is what BROAD_THEN_FILTER below does,
# and what Serper's cheap 100-result responses make viable).
MAX_SITE_OPERATORS = 8

# Serper returns up to 100 organic results for the SAME price as 10. Tavily's
# include_domains existed because Tavily returns few results per call; with a
# hundred in hand, filtering by domain after the fact costs nothing and saves
# an entire lane's worth of calls.
SERPER_MAX_RESULTS = 100

# A Google snippet is ~150-300 characters against Tavily's extracted page
# content, which can run to thousands. Three filters in jobs_finder read this
# field; this constant is what they check to know they are working on a
# snippet and must not treat "I did not see it" as "it is not there".
SNIPPET_IS_SHORT = SEARCH_PROVIDER == "serper"


def site_filter(domains: list[str] | None) -> str:
    """`(site:a.com OR site:b.com)` for a Google query, or "" for the open web.

    Truncated at MAX_SITE_OPERATORS and logged when it truncates, because the
    alternative — Google silently honouring the first few — is a lane that
    reports success while searching a fraction of what it was asked to.
    """
    if not domains:
        return ""
    used = domains[:MAX_SITE_OPERATORS]
    if len(domains) > MAX_SITE_OPERATORS:
        logger.warning(
            f"🔍 {len(domains)} domains requested but Google reliably honours about "
            f"{MAX_SITE_OPERATORS} site: operators — searching {used} and dropping "
            f"{domains[MAX_SITE_OPERATORS:]}. Split the lane or filter a broad "
            "result set instead."
        )
    return "(" + " OR ".join(f"site:{d}" for d in used) + ")"


def chunk_domains(domains: list[str]) -> list[list[str]]:
    """A domain list split into groups Google will actually honour in full."""
    return [domains[i:i + MAX_SITE_OPERATORS]
            for i in range(0, len(domains), MAX_SITE_OPERATORS)]


# ─── QUOTA DETECTION ────────────────────────────────────────────────────────
#
# Each provider says "you are out" in its own words. Matched loosely because
# the exact sentence is theirs to change, and verified against a real refusal
# in Tavily's case — the Researcher plan at 976/1000 answered:
#   "This request exceeds your plan's set usage limit."
_QUOTA_MARKERS = (
    "usage limit", "exceeds your plan", "upgrade your plan", "quota",
    "insufficient credits", "not enough credits", "out of credits",
    "rate limit exceeded", "payment required",
)


def _is_quota_error(exc_or_text: Any) -> bool:
    text = str(exc_or_text).lower()
    return any(marker in text for marker in _QUOTA_MARKERS)


# ─── TAVILY ─────────────────────────────────────────────────────────────────

_SEARCH_TIME_RANGE = "month"


def _search_tavily(query: str, domains: list[str] | None, max_results: int) -> list[dict]:
    """The path this product used until the Serper migration. Kept and
    maintained so SEARCH_PROVIDER=tavily is a real revert, not a dead branch."""
    from tavily import TavilyClient

    api_key = (os.getenv("TAVILY_API_KEY") or "").strip()
    if not api_key:
        raise SearchUnavailable("TAVILY_API_KEY is not set.")

    kwargs: dict[str, Any] = dict(
        query=query,
        search_depth="advanced",
        max_results=max_results,
        time_range=_SEARCH_TIME_RANGE,
    )
    if domains:
        kwargs["include_domains"] = domains

    try:
        raw = TavilyClient(api_key=api_key).search(**kwargs)
    except Exception as e:
        if _is_quota_error(e):
            raise SearchQuotaExhausted(str(e)) from e
        raise SearchUnavailable(str(e)) from e

    return [
        {
            "url": r.get("url") or "",
            "title": r.get("title") or "",
            "content": r.get("content") or "",
            "published_date": r.get("published_date"),
        }
        for r in (raw.get("results") or [])
        if r.get("url")
    ]


# ─── SERPER ─────────────────────────────────────────────────────────────────

_SERPER_BASE = "https://google.serper.dev"
_SERPER_TIMEOUT = 20.0

# Saudi Arabia, Arabic-and-English. gl steers WHICH Google index answers, which
# is the single biggest lever on result relevance for this product and has no
# Tavily equivalent — Tavily had no country parameter at all, which is part of
# why American jobs turned up in a Jeddah search.
SERPER_DEFAULT_COUNTRY = "sa"
SERPER_DEFAULT_LOCALE = "en"

# Google's own recency filter. qdr:m is "past month", matching the time_range
# the Tavily path used, so the two providers see the same window.
SERPER_RECENCY = "qdr:m"


def _serper_post(path: str, payload: dict) -> dict:
    api_key = (os.getenv("SERPER_API_KEY") or "").strip()
    if not api_key:
        raise SearchUnavailable(
            "SERPER_API_KEY is not set. Set it in Render, or set "
            "SEARCH_PROVIDER=tavily to fall back."
        )
    try:
        response = httpx.post(
            f"{_SERPER_BASE}/{path}",
            headers={"X-API-KEY": api_key, "content-type": "application/json"},
            json=payload,
            timeout=_SERPER_TIMEOUT,
        )
    except Exception as e:
        raise SearchUnavailable(f"could not reach Serper: {e}") from e

    if response.status_code in (401, 402, 403, 429):
        body = response.text[:300]
        # 403 is Serper's answer to a bad key AND to an exhausted plan, so the
        # body is what separates them. Getting this wrong in either direction
        # is costly: a bad key reported as "out of quota" sends you to top up
        # an account that is fine, and an exhausted plan reported as a config
        # error sends you to check a key that is correct.
        if response.status_code == 429 or _is_quota_error(body):
            raise SearchQuotaExhausted(f"Serper refused: {body}")
        raise SearchUnavailable(f"Serper rejected the request ({response.status_code}): {body}")
    if response.status_code >= 400:
        raise SearchUnavailable(f"Serper error {response.status_code}: {response.text[:300]}")

    # Every response carries the remaining balance, so the ceiling is kept
    # current for free — no extra call, unlike Tavily's /usage.
    _note_balance_from_headers(response.headers)

    try:
        return response.json() or {}
    except Exception as e:
        raise SearchUnavailable(f"Serper returned unparseable JSON: {e}") from e


def _search_serper(query: str, domains: list[str] | None, max_results: int,
                   country: str | None = None) -> list[dict]:
    """
    One Google search through Serper.

    `domains` becomes a `site:` filter in the query text — Google has no
    include_domains parameter. See site_filter() for why the list is capped.
    """
    site = site_filter(domains)
    payload = {
        "q": f"{query} {site}".strip() if site else query,
        "gl": (country or SERPER_DEFAULT_COUNTRY),
        "hl": SERPER_DEFAULT_LOCALE,
        # Free to raise — billed per request, not per result. More results
        # means the screener has more to choose from and, on the open lane,
        # means a domain filter can be applied afterwards instead of costing
        # its own call.
        "num": min(max(max_results, 10), SERPER_MAX_RESULTS),
        "tbs": SERPER_RECENCY,
    }
    data = _serper_post("search", payload)

    results = []
    for r in (data.get("organic") or []):
        url = r.get("link") or ""
        if not url:
            continue
        results.append({
            "url": url,
            "title": r.get("title") or "",
            # A GOOGLE SNIPPET, NOT PAGE CONTENT. Roughly 150-300 characters
            # against Tavily's thousands. jobs_finder's content-reading
            # filters must treat absence as "not seen", never as "not there".
            "content": r.get("snippet") or "",
            # Google's own "3 days ago" / "Jan 5, 2026" string when it has one.
            # Tavily had no equivalent; this is strictly more than we had.
            "published_date": r.get("date"),
        })
    return results


# ─── THE DISPATCHER ─────────────────────────────────────────────────────────

def search(query: str, domains: list[str] | None = None, max_results: int = 20,
           counter: dict | None = None, country: str | None = None) -> list[dict]:
    """
    One web search on whichever provider SEARCH_PROVIDER names.

    THIS IS THE ONLY FUNCTION AGENTS CALL. Both provider paths are kept and
    both keep working, so reverting is one environment variable and nothing
    else. No agent knows which provider answered, which is what stops a vendor
    name leaking into an agent, a log line or a filter — and what makes the
    next swap a config change instead of another migration.

    Raises SearchQuotaExhausted when the plan is spent and SearchUnavailable
    when the provider could not be reached. Neither is caught here: the
    difference between "no results" and "could not look" belongs to the
    caller, and collapsing it is the defect CLAUDE.md now has a rule about.
    """
    # Counted BEFORE the call — it is billed whether or not it returns
    # anything, and a failed call that went unrecorded is how a quota
    # disappears faster than the counter says it should.
    record_call(counter)

    if SEARCH_PROVIDER == "tavily":
        return _search_tavily(query, domains, max_results)
    if SEARCH_PROVIDER == "serper":
        return _search_serper(query, domains, max_results, country=country)
    raise SearchUnavailable(
        f"SEARCH_PROVIDER={SEARCH_PROVIDER!r} is not a provider. "
        "Set it to 'serper' or 'tavily'."
    )


# ─── THE PLATFORM-WIDE CEILING ──────────────────────────────────────────────
#
# The point is to REFUSE A SEARCH WE CANNOT AFFORD TO FINISH rather than start
# one, spend most of a page's worth of allowance, and hand back a half-empty
# result that reads as a bad search.
#
# ⚠️ THE TWO PROVIDERS SUPPORT THIS DIFFERENTLY, AND THAT IS THE ONE REAL
# REGRESSION IN THIS MIGRATION.
#
#   Tavily publishes GET /usage — authoritative across restarts, instances and
#   any spend from outside this codebase. A local counter could match none of
#   that, and on a free tier that spins down it would reset constantly.
#
#   Serper publishes no usage endpoint. It reports the remaining balance in a
#   response HEADER on every search (X-Credits-Remaining or similar, confirmed
#   at wiring time), which is nearly as good and strictly cheaper — it costs
#   no extra call — but it is only knowable AFTER a search, not before the
#   first one of a cold process.
#
# So the guard is now two-sided:
#
#   BEFORE  — the last known balance, if this process has seen one. On a cold
#             start it has not, and the first search proceeds. That is a
#             deliberate one-search-per-restart hole: refusing every search
#             after a deploy because we have not looked yet would be a worse
#             failure than overspending by one call.
#   AFTER   — every response updates the balance, so the SECOND search of a
#             process is guarded and every one after it.
#
# Combined with the per-user monthly cap (ADDON_CAPS) and the per-search cuts,
# an exhausted plan can cost at most one extra call per restart rather than a
# whole month of empty pages.
_balance_lock = threading.Lock()
_balance: dict[str, Any] = {"remaining": None, "at": 0.0, "source": None}

# Header names providers use for the remaining balance. Checked in order; the
# first present wins. Kept as a list because this is the kind of thing a
# provider renames without telling anyone, and a missing header must degrade
# to "unknown" rather than to "zero".
_BALANCE_HEADERS = (
    "x-credits-remaining", "x-ratelimit-remaining", "x-quota-remaining",
    "x-credits-left", "x-remaining-credits",
)


def _note_balance_from_headers(headers: Any) -> None:
    """Record the remaining balance if the provider volunteered one."""
    if not headers:
        return
    for name in _BALANCE_HEADERS:
        raw = headers.get(name)
        if raw is None:
            continue
        try:
            value = int(str(raw).strip())
        except (TypeError, ValueError):
            continue
        with _balance_lock:
            _balance.update({"remaining": value, "at": time.time(), "source": name})
        return


def credits_remaining() -> Optional[int]:
    """
    Allowance left, or None when it genuinely is not known.

    None means "carry on" — a usage endpoint that is down, or a provider that
    does not report one, must not take job search offline with it. The real
    quota error still arrives from the search call itself; this is the early,
    honest warning, not the enforcement.
    """
    if SEARCH_PROVIDER == "tavily":
        return _tavily_credits_remaining()
    with _balance_lock:
        return _balance["remaining"]


_TAVILY_USAGE_URL = "https://api.tavily.com/usage"
_USAGE_CACHE_SECONDS = 300
_tavily_usage_cache: dict = {"at": 0.0, "value": None}


def _tavily_credits_remaining(force: bool = False) -> Optional[int]:
    now = time.time()
    if not force and _tavily_usage_cache["value"] is not None \
            and now - _tavily_usage_cache["at"] < _USAGE_CACHE_SECONDS:
        return _tavily_usage_cache["value"]

    api_key = (os.getenv("TAVILY_API_KEY") or "").strip()
    if not api_key:
        return None
    try:
        response = httpx.get(_TAVILY_USAGE_URL,
                             headers={"Authorization": f"Bearer {api_key}"}, timeout=5.0)
        account = (response.json() or {}).get("account") or {}
        limit, used = account.get("plan_limit"), account.get("plan_usage")
        remaining = None if (limit is None or used is None) else max(0, int(limit) - int(used))
    except Exception as e:
        logger.warning(f"Could not read Tavily usage ({e}) — proceeding without a quota check.")
        remaining = None

    _tavily_usage_cache.update({"at": now, "value": remaining})
    return remaining


# What one standalone search can cost at worst under cuts A-E: 12 calls for the
# primary title's full ladder + 2 adjacent titles x 3 lanes = 18 calls.
WORST_CASE_CALLS = 18


def worst_case_units() -> int:
    return WORST_CASE_CALLS * units_per_call()


def assert_search_headroom(needed: int | None = None) -> None:
    """Raise SearchQuotaExhausted if a search this size cannot be paid for."""
    required = needed if needed is not None else worst_case_units()
    remaining = credits_remaining()
    if remaining is not None and remaining < required:
        logger.error(
            f"🚫 Refusing a job search: {remaining} {_PROVIDER_COST[SEARCH_PROVIDER]['unit']}(s) "
            f"left on {SEARCH_PROVIDER}, this search needs up to {required}. "
            "Top up, or switch SEARCH_PROVIDER."
        )
        raise SearchQuotaExhausted(
            f"Only {remaining} search {_PROVIDER_COST[SEARCH_PROVIDER]['unit']}s remain this month."
        )
