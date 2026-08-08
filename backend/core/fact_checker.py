# core/fact_checker.py
import json
import re
import os
import time
import threading
import concurrent.futures
from google import genai
from google.genai import types
from loguru import logger
from core.state import AgentState
from agents.tailoring_engine import make_regeneration_fn

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Batched prompt: checks ALL bullets in a single Gemini call instead of one call per bullet.
BATCH_FACT_CHECK_PROMPT = """
You are a fact checker for resume bullets. Your job is narrower than it sounds:
you are NOT a style critic, and you are NOT checking whether the wording matches
the original phrasing. You are checking ONE thing only — does every concrete
claim in the bullet trace back to VERIFIED FACTS.

VERIFIED FACTS:
{facts_json}

THE DISTINCTION THAT MATTERS:
  ALLOWED — rewording, reframing, reordering, or elevating the TONE of a true
  fact, even if it reads completely differently from how it's phrased in
  VERIFIED FACTS. Business framing, stronger verbs, synthesized "strategy"
  or "outcome" language ARE allowed as long as they describe something that
  is actually true per VERIFIED FACTS.

  NOT ALLOWED — a NEW concrete claim that cannot be derived from VERIFIED
  FACTS: a metric/number that wasn't stated, a skill/tool/company/timeframe
  that isn't listed, an outcome or scale that was never claimed, or a
  responsibility/achievement invented from nothing.

LANGUAGE UPGRADES ARE ALWAYS ALLOWED — READ THIS BEFORE FAILING ANYTHING.
Improving HOW something is said is never fabrication. This applies to every
part of speech, not just verbs:

  VERBS — a stronger verb for the same activity:
    "managed X"     -> "led X" / "owned X" / "ran X" / "directed X"
    "helped with X" -> "drove X" / "supported delivery of X"
    "worked on X"   -> "built X" / "delivered X" (when X was in fact built)

  ADJECTIVES — descriptive words characterizing work that was actually done:
    "high-traffic", "fast-paced", "customer-facing", "hands-on",
    "end-to-end", "day-to-day", "cross-functional" (when more than one
    function is evident in the facts), "production" (when the thing was in
    fact shipped/used). These describe the nature of the work, not its size.

  ADVERBS — manner and consistency words: "consistently", "directly",
    "proactively", "independently", "closely", "reliably", "regularly".
    These characterize how work was performed and assert no new fact.

  NOUNS — a more professional name for the same thing:
    "customers"   -> "clients" / "visitors" / "stakeholders"
    "selling"     -> "revenue generation" / "sales performance"
    "fixing bugs" -> "defect resolution"
    "reception work" -> "front-of-house operations"
    A noun that RENAMES something in the facts is fine. A noun that
    introduces something absent from the facts (a client name, a product,
    a certification, a team) is not.

  FRAMING AND STRUCTURE — connective and positioning language that
    reorganizes existing facts: "end to end", "from X through Y" (where both
    X and Y are in the facts), "spanning", "across", "while also",
    "which supported". Merging two facts into one sentence, splitting one
    into two, or leading with the outcome instead of the task are all fine.

  The single test is unchanged: does the bullet assert a FACT that isn't in
  VERIFIED FACTS? Word choice, tone, register, and sentence shape are never
  that. Only a new number, name, tool, date, scope, headcount, or outcome is.

  Seniority-flavored verbs like "owned", "led", "spearheaded", "drove"
  applied to work the candidate demonstrably did are NOT claims of a
  management title and NOT claims of supervising people. Do not fail them on
  that basis. Only fail if the bullet states an actual headcount, an actual
  reporting relationship, or an actual title that VERIFIED FACTS does not
  support (e.g. "led a team of 12" when no team or number appears anywhere).

  Likewise, restating a listed responsibility in more professional or more
  business-oriented language PASSES, even when the restatement sounds more
  impressive than the original wording. "Sounds stronger than the source
  sentence" is not a defect. Only NEW FACTS are a defect.

  WHERE THE LINE ACTUALLY IS — quantity words:
    PASS: "high-traffic museum"  (describes the environment, no number claimed)
    FAIL: "served 500 visitors daily"  (a specific number that wasn't stated)
    PASS: "supported new staff during onboarding"  (facts say training was given)
    FAIL: "onboarded a team of 12"  (headcount invented)
    PASS: "improved the customer experience"  (qualitative, follows from the duties)
    FAIL: "improved satisfaction scores by 20%"  (metric invented)

WORD-LEVEL SIMILARITY IS NEVER A REASON TO FAIL A BULLET. A tailored bullet is
EXPECTED to share very few words with the original — different verbs, different
sentence order, different structure, synonyms throughout, clauses merged or
split, the whole thing reframed around a different angle (impact instead of
task, outcome instead of activity). None of that is grounds for failure by
itself. You are checking truth of claims, not resemblance to the source text.
A bullet that has been completely rewritten, reordered, and reframed should
PASS as long as it does not assert anything beyond VERIFIED FACTS.

CALIBRATION EXAMPLES:
  Fact: "Set three-tier pricing (Free/Pro/Elite) and picked a local payment gateway"
    PASS: "Owned go-to-market strategy, defining a three-tier pricing model and
           selecting a payment gateway for the local market" — same facts, elevated framing.
    PASS: "Shaped the product's monetization path end to end, from structuring a
           three-tier pricing model to choosing the payment infrastructure that
           would support it" — heavily rewritten, reordered, restructured, still
           only describes the same two facts. This should PASS even though almost
           no words match the original.
    FAIL: "Increased revenue by 40% after launching pricing tiers" — the 40% is invented.
  Fact: "Sold merchandise in the gift shop"
    PASS: "Drove gift shop revenue through proactive upselling and product recommendations"
          — still just describes selling merchandise, no new claim.
    FAIL: "Managed a team of 5 in the gift shop" — team size/management was never stated.
  Fact: "Led a team analyzing 880K+ flight records to classify routes by demand"
    PASS: "Spearheaded a data driven investigation into airline route viability,
           interrogating 880K+ flight records to surface clear demand signals"
          — very different wording and structure, same underlying facts (led,
          analyzed 880K+ records, classified by demand). PASS.

When in doubt whether something is a new claim or just a bolder, more heavily
rewritten restatement of an existing one, ask: does this bullet assert something
a reader could reasonably expect to see evidence for that ISN'T in VERIFIED
FACTS? If yes, fail it. If it's the same underlying fact in different words, no
matter how different those words are, pass it.

DEFAULT TO PASSING. A false rejection is more damaging here than a marginal
pass: it strips a truthful bullet out of the candidate's CV. Fail a bullet only
when you can point at the SPECIFIC invented element — quote the number, tool,
employer, title, date, or scope claim that is absent from VERIFIED FACTS — in
your "issue" text. If you cannot name that specific element, the bullet passes.
"Feels exaggerated", "tone is too strong", "wording differs from the source"
and "cannot be fully verified" are NOT valid reasons to fail, and any issue
you write that amounts to one of those means the bullet should have passed.

Below is a JSON array of bullets to check, each with an "id".

BULLETS:
{bullets_json}

Respond ONLY with a JSON array (no markdown, no explanation), one object per bullet id, in this exact format:
[
  {{"id": 0, "passes": true, "issue": null}},
  {{"id": 1, "passes": false, "issue": "specific description of what was invented"}}
]
"""

MAX_RETRIES = 2  # rounds of batch re-checking for bullets that fail — kept low so a
                  # single generation run can't spiral into minutes of retries

_GEMINI_MAX_ATTEMPTS = 3   # attempts for a single Gemini call before giving up
_GEMINI_MAX_WAIT     = 12  # seconds — appropriate for a burst limit, not a daily quota


def _extract_retry_delay(exc: Exception, default: float = 3.0) -> float:
    """
    Google's 429 errors usually include the exact wait it wants
    (e.g. "Please retry in 12.35s"). Honor that instead of guessing —
    it's both faster on average and less likely to re-trigger the
    burst-limit guard than blind exponential backoff.
    """
    match = re.search(r"retry in ([\d.]+)s", str(exc))
    if match:
        return float(match.group(1)) + 0.5  # small safety buffer
    return default


def _is_daily_quota_exhausted(exc: Exception) -> bool:
    """
    A $0-balance Gemini account has two different failure modes:
      1. Burst limit — too many concurrent requests in the same second.
         Transient, clears in seconds, worth a short retry.
      2. Daily free-tier quota — a hard cap that doesn't reset until
         tomorrow. Retrying this (even with backoff) is pure wasted time.
    This distinguishes the two so we never wait on a wall that isn't moving.
    """
    msg = str(exc)
    return "RESOURCE_EXHAUSTED" in msg and "PerDay" in msg


def _call_gemini_raw(prompt: str) -> str:
    last_exc = None
    for attempt in range(1, _GEMINI_MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model    = "gemini-3.1-flash-lite",
                contents = prompt,
                config   = types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            return response.text.strip()
        except Exception as e:
            last_exc = e
            if _is_daily_quota_exhausted(e):
                logger.error("🚫 Gemini daily quota exhausted — skipping retries, won't reset until tomorrow.")
                raise
            if attempt == _GEMINI_MAX_ATTEMPTS:
                raise
            delay = min(_extract_retry_delay(e), _GEMINI_MAX_WAIT)
            logger.warning(f"Gemini burst-limited, retrying in {delay:.1f}s (attempt {attempt}/{_GEMINI_MAX_ATTEMPTS})...")
            time.sleep(delay)
    raise last_exc


class FactCheckerUnavailable(RuntimeError):
    """
    The checker itself could not run (Gemini down, quota exhausted, or
    returning unparseable output) — as distinct from the checker running and
    rejecting a bullet. The two used to be collapsed into "everything
    failed", which meant an outage looked identical to wholesale
    fabrication. They need different handling: rejected content is the
    candidate's problem to fix, an outage is ours, and only one of the two
    should be described to the user as a fact-check failure.
    """


def _call_gemini_batch(bullet_objs: list[dict], facts_json: dict) -> dict:
    """
    Sends ALL bullets in one Gemini call.
    bullet_objs: list of {"id": int, "text": str}
    Returns: dict mapping id -> {"passes": bool, "issue": str|None}
    Raises FactCheckerUnavailable if the call itself could not be completed.
    """
    prompt = BATCH_FACT_CHECK_PROMPT.format(
        facts_json=json.dumps(facts_json, ensure_ascii=False),
        bullets_json=json.dumps(
            [{"id": b["id"], "text": b["text"]} for b in bullet_objs],
            ensure_ascii=False
        )
    )

    try:
        text = _call_gemini_raw(prompt)
        text = re.sub(r"```json|```", "", text).strip()
        results = json.loads(text)
        return {r["id"]: {"passes": r["passes"], "issue": r.get("issue")} for r in results}
    except Exception as e:
        # Previously this returned "passes: False" for every bullet, which
        # made an API outage indistinguishable from the model finding real
        # fabrications — the run then continued and shipped a CV with every
        # bullet stripped out. Raise instead, so the caller can abort the
        # run and refund rather than charge for an empty document.
        logger.error(f"Batch fact check could not be completed after retries: {e}")
        raise FactCheckerUnavailable(str(e)) from e


def run_fact_check_loop(
    bullets: list[dict],
    facts_json: dict,
    tailoring_fn,
) -> tuple[list[dict], list[dict]]:
    """
    Batched fact-check loop.
    Round 1: check ALL bullets in a single Gemini call.
    Each subsequent round: only re-check bullets that failed, still batched into one call.

    SPEED: when multiple bullets fail in the same round, their regeneration
    calls (tailoring_fn -> a Claude API call each) used to run one at a time
    in a plain for-loop — a CV with, say, 5 flagged bullets paid for 5
    sequential network round-trips before the next fact-check round could
    even start. Each regeneration is independent (bullet N's rewrite
    doesn't depend on bullet M's), so they're fired concurrently via a
    thread pool instead — wall-clock cost collapses to roughly the slowest
    single call rather than the sum of all of them.
    """
    verified_bullets    = []
    hallucination_flags = []

    # Working set: id -> current bullet text/obj, tracks what's still unverified
    # Fact-checking runs against "tailored" (the rewritten text) — "original" is
    # the ground-truth source bullet, not something that needs verifying.
    pending = {i: {**b, "id": i, "current_text": b["tailored"]} for i, b in enumerate(bullets)}

    for attempt in range(1, MAX_RETRIES + 1):
        if not pending:
            break

        batch_input = [{"id": i, "text": p["current_text"]} for i, p in pending.items()]
        logger.info(f"🛡️  Batch fact-check round {attempt}/{MAX_RETRIES} — checking {len(batch_input)} bullet(s) in 1 call...")

        results = _call_gemini_batch(batch_input, facts_json)

        still_pending = {}
        to_regenerate: dict[int, str] = {}  # id -> issue, for bullets getting one more attempt
        for i, p in pending.items():
            result = results.get(i, {"passes": False, "issue": "no result returned"})

            if result["passes"]:
                verified_bullets.append({
                    "original": p["original"],
                    "tailored": p["current_text"],
                    "relevance_score": p.get("relevance_score"),
                })
                logger.info(f"✅ Bullet {i} passed on round {attempt}: {p['current_text'][:60]}...")
            else:
                issue = result.get("issue") or "Unknown hallucination"
                logger.warning(f"⚠️  Bullet {i} round {attempt}/{MAX_RETRIES} failed — {issue}")

                hallucination_flags.append({
                    "bullet":   p["current_text"],
                    "issue":    issue,
                    "attempt":  attempt,
                    "excluded": False
                })

                if attempt < MAX_RETRIES:
                    to_regenerate[i] = issue
                    still_pending[i] = p
                else:
                    for flag in reversed(hallucination_flags):
                        if flag["bullet"] == p["current_text"]:
                            flag["excluded"] = True
                            break
                    logger.error(f"❌ Bullet {i} excluded after {MAX_RETRIES} rounds.")

        if to_regenerate:
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(to_regenerate)) as executor:
                future_to_id = {
                    executor.submit(tailoring_fn, still_pending[i]["current_text"], issue): i
                    for i, issue in to_regenerate.items()
                }
                for future in concurrent.futures.as_completed(future_to_id):
                    i = future_to_id[future]
                    try:
                        still_pending[i]["current_text"] = future.result()
                    except Exception as e:
                        logger.error(f"Bullet {i} regeneration failed, keeping prior text for next round: {e}")

        pending = still_pending

    return verified_bullets, hallucination_flags


def run_fact_checker(state: AgentState) -> dict:
    """
    LangGraph Validation Node wrapper.
    """
    if state.get("error"):
        return {}

    logger.info("🛡️  Agent Node — Executing Strict Fact Checker (batched)...")

    tailored_bullets = state.get("tailored_bullets", []) or []
    facts_json = state.get("facts_json", {}) or {}

    # Tracks how many bullets actually needed a regeneration call (business
    # metric) separately from raw Claude call/token counts (cost metric) —
    # a single regeneration can itself involve more than one underlying API
    # call if generate_claude_text has to retry internally, so these two
    # numbers legitimately diverge. Both get folded into the return dict
    # below and read back out by UsageEvent.from_pipeline_result in
    # core/usage_tracker.py.
    usage_counters = {
        "bullets_regenerated_count": 0,
        "regen_calls": 0,
        "regen_input_tokens": 0,
        "regen_output_tokens": 0,
    }
    # run_fact_check_loop now fires regeneration calls for a round's failing
    # bullets concurrently (see its docstring) — these counters are shared
    # mutable state read/written from multiple worker threads, so updates
    # need a lock even though CPython's GIL makes each individual += "look"
    # atomic; `dict[key] += 1` is actually read-modify-write across several
    # bytecode ops, which IS a real race under real thread interleaving.
    _usage_lock = threading.Lock()

    def _record_regen_usage(input_tokens: int, output_tokens: int):
        with _usage_lock:
            usage_counters["regen_calls"] += 1
            usage_counters["regen_input_tokens"] += input_tokens
            usage_counters["regen_output_tokens"] += output_tokens

    # BUG FIX: this previously called make_regeneration_fn(facts_json) with
    # no cv_language, which defaults to "en" inside that function — meaning
    # a bullet from an ARABIC CV that failed fact-checking was silently
    # regenerated with "Write the corrected bullet in English." as its
    # instruction. Passing cv_language through fixes that; flagging it here
    # since it's a real correctness bug I found while wiring usage
    # tracking, not something I introduced.
    regenerate_bullet_fn = make_regeneration_fn(
        facts_json,
        cv_language=state.get("cv_language", "en") or "en",
        on_usage=_record_regen_usage,
    )

    def _counted_tailoring_fn(bullet_text: str, issue: str) -> str:
        with _usage_lock:
            usage_counters["bullets_regenerated_count"] += 1
        return regenerate_bullet_fn(bullet_text, issue)

    usage_fields = {
        "usage_bullets_regenerated_count": state.get("usage_bullets_regenerated_count", 0) + usage_counters["bullets_regenerated_count"],
        "usage_regen_calls": state.get("usage_regen_calls", 0) + usage_counters["regen_calls"],
        "usage_regen_input_tokens": state.get("usage_regen_input_tokens", 0) + usage_counters["regen_input_tokens"],
        "usage_regen_output_tokens": state.get("usage_regen_output_tokens", 0) + usage_counters["regen_output_tokens"],
    }

    try:
        verified_bullets, hallucination_flags = run_fact_check_loop(
            bullets=tailored_bullets,
            facts_json=facts_json,
            tailoring_fn=_counted_tailoring_fn
        )
    except FactCheckerUnavailable as e:
        # Abort rather than continue: without a working checker we can
        # neither verify the bullets nor honestly claim we did. Marked
        # fatal so orchestrator.py stops here instead of paying for the
        # cover letter, match score, and job search on a run that is
        # already going to be refunded.
        logger.error(f"🛡️  Fact checker unavailable — aborting run so the user isn't charged: {e}")
        return {
            "fact_check_passed": False,
            "fact_check_unavailable": True,
            "fatal_error_code": "fact_check_unavailable",
            "error": f"Fact checker unavailable: {e}",
            **usage_fields,
        }

    # A CV with no work-experience bullets at all (student/projects-only CVs
    # are common here) legitimately produces zero verified bullets. That is
    # "nothing to check", not "everything was rejected" — treating the two
    # the same would abort a perfectly good run, so the empty-input case
    # passes explicitly. Otherwise the bar stays exactly where it was:
    # at least one bullet survived.
    if not tailored_bullets:
        fact_check_passed = True
    else:
        fact_check_passed = len(verified_bullets) > 0
    logger.info(f"🛡️  Fact check complete. Passed: {fact_check_passed}")

    return {
        "tailored_bullets": verified_bullets,
        "hallucination_flags": hallucination_flags,
        "fact_check_passed": fact_check_passed,
        "fact_check_unavailable": False,
        # Cumulative, not a fresh count — this node can run multiple times
        # in the tailoring_engine <-> fact_checker loop (see
        # MAX_TAILORING_ATTEMPTS in orchestrator.py), and LangGraph
        # overwrites state keys per node return rather than summing them.
        # Same reasoning as _cumulative_usage_fields() in tailoring_engine.py.
        **usage_fields,
    }