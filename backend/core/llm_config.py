# core/llm_config.py
#
# EVERY MODEL CALL IN THE BACKEND IS CONFIGURED HERE. Two jobs, two providers:
#
#   EXTRACTION  (structured data out of unstructured text) -> Gemini.
#               cv_parser, jd_analyzer, fact_checker, the jobs_finder screener.
#               Its gates (truncation, partial extraction, structural-first
#               usability) were built around Gemini's specific failure modes.
#
#   WRITING     (tailoring, cover letters, scoring, LinkedIn, interview prep,
#               the Arabic purity pass) -> WRITING_MODEL below.
#
# ⚠️ WRITING_MODEL IS THE SWITCH. It is the only line that decides which
# provider answers every writing call in the product. Setting it back to
# "claude-sonnet-5" reverts the entire migration — both call paths are kept
# and both are maintained. No agent hardcodes a model id; if one ever needs
# to, that is a bug to raise rather than a line to write.
import contextlib
import os
import re
import threading
import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
import anthropic
import openai


def _key(name: str) -> str:
    """An API key from the environment, whitespace stripped.

    Not paranoia: this project's own .env has CRLF line terminators, so
    OPENAI_API_KEY arrived carrying a trailing \r and the OpenAI SDK died on
    `Illegal header value` — which it reports as APIConnectionError, i.e. it
    looks exactly like the network being down. A key pasted into a Render or
    Vercel dashboard with a stray space fails the same way. One strip() is
    cheaper than diagnosing that twice.
    """
    return (os.getenv(name) or "").strip()


# Gemini client — used for cheap extraction tasks
gemini_client = genai.Client(api_key=_key("GEMINI_API_KEY"))
GEMINI_MODEL = "gemini-3.1-flash-lite"

# ─── THE WRITING MODEL ──────────────────────────────────────────────────────
#
# Chosen by a blind six-model comparison (two runs each, production pipeline
# unchanged, only the model id swapped): Luna passed every objective check on
# both runs at roughly 1/43rd of Claude Sonnet's per-CV cost. Env-overridable
# so a bad day can be rolled back from the Render dashboard without a deploy.
WRITING_MODEL = os.getenv("WRITING_MODEL", "gpt-5.6-luna").strip()

anthropic_client = anthropic.Anthropic(api_key=_key("ANTHROPIC_API_KEY"))
openai_client = openai.OpenAI(api_key=_key("OPENAI_API_KEY"))


def _is_anthropic(model: str) -> bool:
    return model.startswith("claude")


# Both SDKs' base API-error class, as one tuple. Agents catch this rather than
# a vendor's exception, so an `except anthropic.APIError` cannot quietly stop
# catching anything the day WRITING_MODEL changes provider — which is exactly
# what happened to the cover letter path in this migration.
ProviderAPIError = (anthropic.APIError, openai.APIError)

# Default ceiling for the auto-escalation in generate_writing_text below.
# Sonnet 5 supports up to 128k output tokens on the synchronous Messages
# API, so this is nowhere near the model's real limit — it's just a sane cap
# so a broken prompt can't spin the retry loop into something huge.
#
# BUG FIX (Arabic generation): 8000 was a HARD ceiling for every caller, and
# it is simply not enough for a full Arabic CV JSON. Arabic costs roughly
# 2-3x more tokens than the same text in English under this tokenizer, so
# tailoring_engine's 6000-token budget escalated once to 8000, hit this
# ceiling, came back truncated a second time, and returned invalid JSON —
# which the caller then retried from scratch. Every Arabic run therefore
# burned 4 long Claude calls and still failed. Callers that legitimately
# need more can now pass max_tokens_ceiling explicitly.
_MAX_TOKENS_CEILING = 8000

# Hard cap on how many times ONE generate_writing_text call is allowed to
# double its budget and try again after a truncated/empty response. Separate
# from max_retries (which also covers transient 429/5xx errors) so a prompt
# that keeps overflowing can't quietly consume the entire retry allowance in
# ever-larger — and ever more expensive — calls. Two escalations means a
# worst case of 3 billed responses instead of 5.
_MAX_TRUNCATION_RETRIES = 2

# Gemini's own ceiling for this model, read from the API rather than assumed:
#   client.models.get(model="gemini-3.1-flash-lite").output_token_limit -> 65536
#
# SET EXPLICITLY because this config had no cap at all, which leaves the
# model on its default budget — and a genuinely large CV (16 jobs, 7 degrees,
# every bullet extracted verbatim) is exactly the input that runs past a
# default. Asking for the documented maximum costs nothing: max_output_tokens
# is a ceiling, not a target, and short extractions still stop when they stop.
GEMINI_MAX_OUTPUT_TOKENS = 65536

# Shared config for Gemini JSON responses
gemini_json_config = types.GenerateContentConfig(
    response_mime_type="application/json",
    max_output_tokens=GEMINI_MAX_OUTPUT_TOKENS,
)


class GeminiTruncationError(RuntimeError):
    """
    Raised when Gemini stopped before finishing its response.

    Exists because `response.text` HIDES this: the SDK concatenates whatever
    text parts came back and returns them as an ordinary string, with the
    stop reason recorded only on the candidate. A response cut off by
    max_output_tokens therefore arrives looking exactly like a complete one.
    Today that surfaces downstream as a JSON parse error, which is loud but
    misleading (it reads as "the model emitted bad JSON" and burns the
    caller's full retry allowance re-asking an identical, over-budget
    question). Worse, a truncation that happens to leave parseable JSON —
    or any caller reading plain text — would pass silently, which on the CV
    parser means a partial extraction rendered as a complete CV.
    """


def _gemini_text_or_raise(response, context: str) -> str:
    """
    The response's text, or a raised error if the model did not finish.

    Anything other than a normal STOP means the output is not the whole
    answer, so no caller should treat it as one. SAFETY and RECITATION are
    included deliberately: both truncate mid-answer, and both would
    otherwise reach the caller as a short-but-valid-looking string.
    """
    candidates = getattr(response, "candidates", None) or []
    finish_reason = getattr(candidates[0], "finish_reason", None) if candidates else None
    # The SDK hands this back as an enum on the happy path but a plain string
    # on some transports, so normalise before comparing rather than trusting
    # either shape.
    reason = getattr(finish_reason, "name", None) or str(finish_reason or "")

    if reason and reason.upper() not in ("STOP", "FINISH_REASON_UNSPECIFIED"):
        usage = getattr(response, "usage_metadata", None)
        raise GeminiTruncationError(
            f"Gemini stopped early during {context}: finish_reason={reason} "
            f"(output tokens: {getattr(usage, 'candidates_token_count', '?')}, "
            f"cap: {GEMINI_MAX_OUTPUT_TOKENS}). The response is incomplete and must not be "
            f"used as if it were the whole answer."
        )

    text = response.text
    if text is None:
        raise GeminiTruncationError(
            f"Gemini returned no text during {context} (finish_reason={reason or 'unknown'})."
        )
    return text


class TruncationError(RuntimeError):
    """
    Raised when a response is still cut off after the truncation escalation
    above has run out of headroom. Distinct from a transient API error and
    from malformed model output: retrying the identical prompt cannot fix
    it, so callers should give up rather than spend another full generation
    discovering the same thing. This is what stops an over-budget Arabic run
    from silently retrying itself into a large bill.
    """


# Output-budget presets, by CV language. Arabic needs far more room for the
# same content — see _MAX_TOKENS_CEILING's note. Sized from the real
# failing run: an English CV JSON finishes comfortably inside ~4k output
# tokens, the same CV in Arabic did not fit in 8k.
WRITING_BUDGETS = {
    "en": {"tailoring": 6000,  "tailoring_ceiling": 12000,
           "purity": 6000,     "purity_ceiling": 12000},
    "ar": {"tailoring": 14000, "tailoring_ceiling": 32000,
           "purity": 14000,    "purity_ceiling": 32000},
}


def writing_budget(cv_language: str, key: str) -> int:
    """Look up an output-token budget for this CV language, defaulting to
    the English preset for any unrecognized language."""
    lang = "ar" if str(cv_language or "en").lower().startswith("ar") else "en"
    return WRITING_BUDGETS[lang][key]


def _retry_delay_seconds(exc: Exception, attempt: int) -> float:
    """Use Retry-After from Gemini when present, else backoff."""
    match = re.search(r"retry in ([\d.]+)s", str(exc), re.IGNORECASE)
    if match:
        return float(match.group(1)) + 1
    return min(60, 12 * attempt)


def _is_retryable_gemini_error(exc: Exception) -> bool:
    # A depleted prepayment balance is permanent until you top up — no
    # amount of waiting fixes it, so don't burn 5 retries finding that out.
    if "prepayment credits are depleted" in str(exc).lower():
        return False
    if isinstance(exc, genai_errors.ServerError):
        return True
    if isinstance(exc, genai_errors.ClientError):
        return getattr(exc, "code", None) == 429
    return False


def generate_gemini_json(prompt: str, max_retries: int = 5) -> str:
    """
    Call Gemini and return JSON text. Retries on 429/503 with backoff
    so free-tier rate limits don't fail immediately.
    """
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            response = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=gemini_json_config,
            )
            return _gemini_text_or_raise(response, "JSON generation")
        except (genai_errors.ClientError, genai_errors.ServerError) as e:
            last_error = e
            if _is_retryable_gemini_error(e) and attempt < max_retries:
                delay = _retry_delay_seconds(e, attempt)
                print(f"[Gemini] Rate limited, retrying in {delay:.0f}s (attempt {attempt}/{max_retries})")
                time.sleep(delay)
                continue
            raise

    raise RuntimeError(f"Gemini failed after {max_retries} attempts: {last_error}")


def _is_retryable_anthropic_error(exc: Exception) -> bool:
    if isinstance(exc, (anthropic.RateLimitError, anthropic.APIStatusError)):
        status = getattr(exc, "status_code", None)
        return status in (429, 529, 500, 503)
    return isinstance(exc, anthropic.APIConnectionError)


def _generate_anthropic_text(
    model: str,
    prompt: str,
    max_tokens: int = 3000,
    max_retries: int = 5,
    on_usage=None,
    system: str | None = None,
    max_tokens_ceiling: int | None = None,
) -> str:
    """
    Call Claude and return plain text. Retries on rate limits / transient
    server errors with backoff.

    max_tokens_ceiling: how far the truncation auto-escalation below is
    allowed to raise max_tokens. Defaults to _MAX_TOKENS_CEILING.
    Arabic callers pass a higher value — see that constant's docstring for
    why a single global ceiling made Arabic generation impossible.

    Raises TruncationError if the response is still truncated once the
    ceiling is reached. Previously this returned the truncated text and left
    every caller to fail on json.loads() a moment later, which read as a
    "bad model output" and triggered a full, expensive regeneration of a
    request that was only ever going to overflow again.

    on_usage: optional callback `fn(input_tokens: int, output_tokens: int)`.
    If provided, it's called once for every response actually received from
    the API — including responses that get discarded and retried due to
    truncation/empty output, since those still cost tokens. It is NOT
    called for the transient-error retry path (rate limit / 5xx), since no
    response was returned there. Default is None so existing callers are
    unaffected.

    system: optional static instruction text, sent via the API's `system`
    parameter with `cache_control: {"type": "ephemeral"}` instead of being
    concatenated into `prompt`. This is what makes prompt caching actually
    work — Anthropic only caches content in `system` (or earlier `messages`
    turns), never inside a single user-turn string. On a cache hit, that
    block is billed at a fraction of normal input-token price instead of
    full price. Only pass text here that is IDENTICAL across calls — if it
    has any per-request data spliced in, every call becomes a fresh cache
    write instead of a hit, and you get none of the saving. The cache also
    only pays off on requests that come within the cache's TTL (~5 minutes
    per Anthropic's ephemeral cache) of the previous one — the very first
    call after a quiet period still pays full price to populate the cache.
    Default None preserves the old behavior (no system prompt sent).

    IMPORTANT — Claude Sonnet 5 behavior change vs 4.6: adaptive thinking is
    ON BY DEFAULT (no `thinking` field needed to trigger it), and thinking
    tokens count against `max_tokens` — it's a hard cap on thinking + visible
    text combined, not just visible text. We deliberately do NOT disable
    thinking here (it improves output quality, and quality > speed for this
    pipeline). Instead, if a response comes back truncated (stop_reason ==
    "max_tokens") or thinking consumed the entire budget and left zero
    visible text, we automatically double the budget and retry rather than
    silently shipping a cut-off CV / cover letter / JSON blob.

    STREAMING — this uses client.messages.stream(...) instead of a single
    blocking .create() call. Not for UI purposes (the caller still just
    gets a plain string back) — this is purely to keep the underlying HTTP
    connection alive while Claude thinks. A long, heavy prompt (like
    tailoring_engine.py's, with max_tokens=6000 and a large amount of
    reasoning instruction) can leave a non-streaming request sitting
    completely silent for 2+ minutes while adaptive thinking runs, and
    Render's (or any platform's) outbound proxy will kill an idle
    connection like that, which the SDK reports as a plain "Connection
    error" — indistinguishable from a real network failure, but it isn't
    one. Streaming sends data continuously as it's generated, so the
    connection never goes idle long enough to get killed. The caller-facing
    behavior (return a string, same retry/truncation logic) is unchanged.
    """
    last_error = None
    current_max_tokens = max_tokens
    ceiling = max(max_tokens, max_tokens_ceiling or _MAX_TOKENS_CEILING)
    truncation_retries = 0

    for attempt in range(1, max_retries + 1):
        try:
            call_kwargs = dict(
                            model=model,
                max_tokens=current_max_tokens,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )
            if system:
                call_kwargs["system"] = [
                    {
                        "type": "text",
                        "text": system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]

            with anthropic_client.messages.stream(**call_kwargs) as stream:
                # Draining the stream is what keeps the connection alive —
                # we don't need the chunks themselves, get_final_message()
                # below returns the same shape generate_writing_text always
                # returned (content blocks + stop_reason).
                for _ in stream.text_stream:
                    pass
                response = stream.get_final_message()

            text = "".join(
                block.text
                for block in response.content
                if getattr(block, "type", None) == "text"
            ).strip()

            usage = getattr(response, "usage", None)
            _meter(
                getattr(usage, "input_tokens", 0) or 0,
                getattr(usage, "output_tokens", 0) or 0,
                getattr(usage, "cache_read_input_tokens", 0) or 0,
            )
            if on_usage is not None:
                on_usage(
                    getattr(usage, "input_tokens", 0) or 0,
                    getattr(usage, "output_tokens", 0) or 0,
                )
            # NOTE: when `system` caching is in play, `usage` also carries
            # `cache_creation_input_tokens` (first call, populates the
            # cache — billed higher than normal input) and
            # `cache_read_input_tokens` (subsequent calls, billed far
            # lower). Not wired into on_usage/UsageEvent yet — the two
            # numbers above already show your real spend either way — but
            # logging those two fields separately later would let you see
            # the cache hit rate directly instead of inferring it from the
            # cost drop.

            truncated = response.stop_reason == "max_tokens"
            empty = not text

            if truncated or empty:
                reason = "truncated by max_tokens" if truncated else "empty (thinking used the whole budget)"
                can_escalate = (
                    attempt < max_retries
                    and truncation_retries < _MAX_TRUNCATION_RETRIES
                    and current_max_tokens < ceiling
                )
                if can_escalate:
                    truncation_retries += 1
                    previous_max_tokens = current_max_tokens
                    current_max_tokens = min(current_max_tokens * 2, ceiling)
                    # NOTE: this used to report the failing budget as
                    # `current_max_tokens // 2`, computed AFTER the min()
                    # clamp — so a 6000-token call that clamped to 8000 was
                    # logged as having failed at 4000, a number no caller
                    # ever passed. That made the real Arabic failure point
                    # impossible to find in the logs.
                    print(
                        f"[Claude] Response {reason} at max_tokens={previous_max_tokens}. "
                        f"Retrying with max_tokens={current_max_tokens} "
                        f"(truncation retry {truncation_retries}/{_MAX_TRUNCATION_RETRIES})..."
                    )
                    continue

                # Out of headroom. Fail loudly instead of handing back a
                # half-finished string — see the docstring.
                raise TruncationError(
                    f"Claude response {reason} and could not be completed within "
                    f"max_tokens={current_max_tokens} (ceiling={ceiling})."
                )

            return text
        except TruncationError:
            raise
        except Exception as e:
            last_error = e
            if _is_retryable_anthropic_error(e) and attempt < max_retries:
                delay = min(60, 8 * attempt)
                print(f"[Claude] Transient error, retrying in {delay:.0f}s (attempt {attempt}/{max_retries})")
                time.sleep(delay)
                continue
            raise

    raise RuntimeError(f"Claude failed after {max_retries} attempts: {last_error}")


# ─── THE OPENAI WRITING PATH ────────────────────────────────────────────────
#
# Reaching parity with the Anthropic path above is the actual work of the
# migration. The blind model comparison ran Luna through an eval shim, which
# measured its WRITING and exercised none of this: retries, truncation
# escalation, caching, or usage reporting. Each of the five differences is
# called out where it is handled.

# Cache statistics for the most recent call, so the migration can report a
# real hit rate instead of an assumption. Read by tools/measure_costs.py.
# Deliberately not thread-safe and deliberately not authoritative — it is an
# observation aid, and every real number still comes from on_usage.
LAST_CACHE_STATS: dict = {"cached_tokens": 0, "prompt_tokens": 0}


def _is_retryable_openai_error(exc: Exception) -> bool:
    """
    Retry the same things the Anthropic path retries, mapped onto OpenAI's
    exception classes: rate limits, 5xx, and connection failures. A 400 or a
    401 is retried by neither — no amount of waiting fixes a malformed
    request or a bad key, and burning five attempts to discover that is how
    a broken deploy looks like a slow one.
    """
    if isinstance(exc, openai.RateLimitError):
        return True
    if isinstance(exc, openai.APIStatusError):
        return getattr(exc, "status_code", None) in (429, 500, 502, 503, 529)
    return isinstance(exc, (openai.APIConnectionError, openai.APITimeoutError))


def _generate_openai_text(
    model: str,
    prompt: str,
    max_tokens: int = 3000,
    max_retries: int = 5,
    on_usage=None,
    system: str | None = None,
    max_tokens_ceiling: int | None = None,
) -> str:
    """
    Call the OpenAI writing model and return plain text. Same contract as
    _generate_anthropic_text — same arguments, same return, same exceptions —
    so callers cannot tell which provider answered.

    FIVE THINGS THAT ARE NOT THE SAME AS THE ANTHROPIC PATH:

    1. TRUNCATION IS SIGNALLED DIFFERENTLY. Anthropic sets
       `stop_reason == "max_tokens"`; OpenAI sets
       `choices[0].finish_reason == "length"`. Reading the Anthropic field off
       an OpenAI response returns None, which reads as "finished normally" —
       so a cut-off CV would have been returned as a complete one. Mapped
       explicitly below onto the identical double-the-budget escalation.

    2. THE TOKEN PARAMETER IS `max_completion_tokens`. `max_tokens` is
       rejected outright by this model generation.

    3. CACHING IS AUTOMATIC AND PREFIX-BASED. Anthropic needs explicit
       `cache_control` breakpoints; OpenAI caches the longest common prefix of
       a request with no markup at all. That is why `system` goes in as the
       FIRST message and the per-request data goes last — static first,
       variable last, which is the layout that makes an automatic prefix cache
       actually fire. Any `cache_control` marker sent here would be an
       unrecognised field, so there are none.

    4. USAGE IS `prompt_tokens` / `completion_tokens`, not
       `input_tokens` / `output_tokens`. Normalised into the same on_usage
       callback so the cost instrumentation cannot silently start reading
       zeroes.

    5. REASONING TOKENS COUNT AGAINST THE BUDGET, exactly the way Anthropic's
       adaptive thinking does — `completion_tokens_details.reasoning_tokens`
       is a subset of `completion_tokens`. So the "thinking consumed the whole
       budget and left no visible text" case exists here too, and is escalated
       identically.
    """
    last_error = None
    current_max_tokens = max_tokens
    ceiling = max(max_tokens, max_tokens_ceiling or _MAX_TOKENS_CEILING)
    truncation_retries = 0

    for attempt in range(1, max_retries + 1):
        try:
            messages = []
            if system:
                # FIRST, and byte-identical on every call — this is the
                # cacheable prefix. See note 3.
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            response = openai_client.chat.completions.create(
                model=model,
                max_completion_tokens=current_max_tokens,
                messages=messages,
            )

            choice = response.choices[0] if response.choices else None
            text = ((choice.message.content if choice else None) or "").strip()

            usage = getattr(response, "usage", None)
            if usage is not None:
                details = getattr(usage, "prompt_tokens_details", None)
                LAST_CACHE_STATS["cached_tokens"] = getattr(details, "cached_tokens", 0) or 0
                LAST_CACHE_STATS["prompt_tokens"] = getattr(usage, "prompt_tokens", 0) or 0
            _meter(
                getattr(usage, "prompt_tokens", 0) or 0,
                getattr(usage, "completion_tokens", 0) or 0,
                LAST_CACHE_STATS["cached_tokens"],
            )
            if on_usage is not None:
                # Called for every response actually received, including ones
                # discarded and retried for truncation — those still cost
                # tokens. Same rule as the Anthropic path.
                on_usage(
                    getattr(usage, "prompt_tokens", 0) or 0,
                    getattr(usage, "completion_tokens", 0) or 0,
                )

            truncated = bool(choice) and choice.finish_reason == "length"
            empty = not text

            if truncated or empty:
                reason = ("truncated by max_completion_tokens" if truncated
                          else "empty (reasoning used the whole budget)")
                can_escalate = (
                    attempt < max_retries
                    and truncation_retries < _MAX_TRUNCATION_RETRIES
                    and current_max_tokens < ceiling
                )
                if can_escalate:
                    truncation_retries += 1
                    previous_max_tokens = current_max_tokens
                    current_max_tokens = min(current_max_tokens * 2, ceiling)
                    print(
                        f"[{model}] Response {reason} at max_completion_tokens="
                        f"{previous_max_tokens}. Retrying with {current_max_tokens} "
                        f"(truncation retry {truncation_retries}/{_MAX_TRUNCATION_RETRIES})..."
                    )
                    continue

                raise TruncationError(
                    f"{model} response {reason} and could not be completed within "
                    f"max_completion_tokens={current_max_tokens} (ceiling={ceiling})."
                )

            return text
        except TruncationError:
            raise
        except Exception as e:
            last_error = e
            if _is_retryable_openai_error(e) and attempt < max_retries:
                delay = min(60, 8 * attempt)
                print(f"[{model}] Transient error, retrying in {delay:.0f}s "
                      f"(attempt {attempt}/{max_retries})")
                time.sleep(delay)
                continue
            raise

    raise RuntimeError(f"{model} failed after {max_retries} attempts: {last_error}")


def generate_writing_text(
    prompt: str,
    max_tokens: int = 3000,
    max_retries: int = 5,
    on_usage=None,
    system: str | None = None,
    max_tokens_ceiling: int | None = None,
) -> str:
    """
    Run one writing call on whichever provider WRITING_MODEL names.

    THIS IS THE ONLY FUNCTION AGENTS CALL. Both provider paths are kept and
    both keep working, so reverting the migration is one line at the top of
    this file and nothing else. No agent knows which provider answered, which
    is what stops a vendor name leaking into an agent, a log line, or a
    prompt — and what makes the next migration a config change instead of
    another one of these.

    See _generate_anthropic_text and _generate_openai_text for the contract
    both honour: same arguments, same return, same TruncationError.
    """
    backend = _generate_anthropic_text if _is_anthropic(WRITING_MODEL) else _generate_openai_text
    return backend(
        WRITING_MODEL,
        prompt,
        max_tokens=max_tokens,
        max_retries=max_retries,
        on_usage=on_usage,
        system=system,
        max_tokens_ceiling=max_tokens_ceiling,
    )


# ─── WHOLE-FEATURE USAGE ACCOUNTING ─────────────────────────────────────────
#
# on_usage is per-call and every caller has to opt in, which is why
# tailoring_engine and fact_checker are instrumented and the cover letter,
# match scorer, LinkedIn and interview prep are not — so "what does one CV
# cost" has never had an answer that covered the whole pipeline.
#
# This measures a BLOCK instead of a call. Wrap any feature and get its total:
#
#     with usage_meter() as usage:
#         run_interview_prep(row)
#     usage["calls"], usage["input_tokens"], usage["output_tokens"], usage["cached_tokens"]
#
# Not a replacement for on_usage — that stays the production path, because it
# attributes tokens to a specific agent and survives the LangGraph fan-out.
# This is for answering cost questions about a feature end to end, which is
# what Section 10 of the pre-launch plan needs.
#
# THREAD SCOPE, stated plainly because getting this wrong produces numbers
# that are quietly too low: the meter is thread-local and does NOT follow
# calls made inside a ThreadPoolExecutor started within the block. The fact
# checker's concurrent bullet regeneration is the one place in this codebase
# that matters, and it reports its own counts separately. Everything else in
# the writing path is sequential on the calling thread.
_usage_meter = threading.local()


@contextlib.contextmanager
def usage_meter():
    """Totals every writing call made on this thread inside the block."""
    totals = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cached_tokens": 0}
    previous = getattr(_usage_meter, "totals", None)
    _usage_meter.totals = totals
    try:
        yield totals
    finally:
        _usage_meter.totals = previous


def _meter(input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> None:
    totals = getattr(_usage_meter, "totals", None)
    if totals is None:
        return
    totals["calls"] += 1
    totals["input_tokens"] += input_tokens
    totals["output_tokens"] += output_tokens
    totals["cached_tokens"] += cached_tokens


# ─── WHAT A CALL COSTS ──────────────────────────────────────────────────────
#
# Published list prices, USD per million tokens. Verified against each
# provider's own pricing page rather than carried over from a spreadsheet.
# Used only for reporting — nothing bills off this.
#
# SAR is pegged at 3.75/USD (see core/pricing.py's SAR_PER_USD).
MODEL_PRICING = {
    # developers.openai.com/api/docs/pricing — standard tier
    "gpt-5.6-luna":    {"input": 0.20, "cached_input": 0.02, "output": 1.20},
    # Anthropic list price at the time of the model comparison.
    "claude-sonnet-5": {"input": 3.00, "cached_input": 0.30, "output": 15.00},
}


def usd_cost(model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
    """What those tokens cost, in USD. Cached input is billed separately and
    at roughly a tenth — on a pipeline whose prompts are 99% cacheable that is
    the difference between a real figure and a 50% overstatement."""
    rates = MODEL_PRICING.get(model)
    if not rates:
        return 0.0
    fresh = max(0, input_tokens - cached_tokens)
    return (
        fresh * rates["input"]
        + cached_tokens * rates["cached_input"]
        + output_tokens * rates["output"]
    ) / 1_000_000


def generate_writing_json(prompt: str, max_tokens: int = 3000, max_retries: int = 5, on_usage=None) -> str:
    """
    A writing call that is expected to return a JSON object.

    Neither writing provider is asked for a native JSON response mode here the
    way Gemini is — the instruction lives in the prompt, and the caller strips
    markdown fences if any slip through. Kept that way through the migration
    deliberately: the prompts already carry the instruction and already work,
    and switching to a structured-output mode is a behaviour change that
    belongs in its own commit, not inside a provider swap.
    """
    return generate_writing_text(prompt, max_tokens=max_tokens, max_retries=max_retries, on_usage=on_usage)


def generate_gemini_text(prompt: str, max_retries: int = 5) -> str:
    """Call Gemini and return plain text (no JSON mode)."""
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            response = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
            )
            return _gemini_text_or_raise(response, "text generation")
        except (genai_errors.ClientError, genai_errors.ServerError) as e:
            last_error = e
            if _is_retryable_gemini_error(e) and attempt < max_retries:
                delay = _retry_delay_seconds(e, attempt)
                print(f"[Gemini] Rate limited, retrying in {delay:.0f}s (attempt {attempt}/{max_retries})")
                time.sleep(delay)
                continue
            raise

    raise RuntimeError(f"Gemini failed after {max_retries} attempts: {last_error}")
