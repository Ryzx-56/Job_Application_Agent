# core/llm_config.py
import os
import re
import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
import anthropic

# Gemini client — used for cheap tasks (extraction, fact checking)
gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = "gemini-3.1-flash-lite"

# Claude client — used for writing tasks only (tailoring, cover letter, scoring)
claude_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
CLAUDE_MODEL = "claude-sonnet-5"

# Default ceiling for the auto-escalation in generate_claude_text below.
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
_CLAUDE_MAX_TOKENS_CEILING = 8000

# Hard cap on how many times ONE generate_claude_text call is allowed to
# double its budget and try again after a truncated/empty response. Separate
# from max_retries (which also covers transient 429/5xx errors) so a prompt
# that keeps overflowing can't quietly consume the entire retry allowance in
# ever-larger — and ever more expensive — calls. Two escalations means a
# worst case of 3 billed responses instead of 5.
_CLAUDE_MAX_TRUNCATION_RETRIES = 2

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


class ClaudeTruncationError(RuntimeError):
    """
    Raised when a response is still cut off after the truncation escalation
    above has run out of headroom. Distinct from a transient API error and
    from malformed model output: retrying the identical prompt cannot fix
    it, so callers should give up rather than spend another full generation
    discovering the same thing. This is what stops an over-budget Arabic run
    from silently retrying itself into a large bill.
    """


# Output-budget presets, by CV language. Arabic needs far more room for the
# same content — see _CLAUDE_MAX_TOKENS_CEILING's note. Sized from the real
# failing run: an English CV JSON finishes comfortably inside ~4k output
# tokens, the same CV in Arabic did not fit in 8k.
CLAUDE_BUDGETS = {
    "en": {"tailoring": 6000,  "tailoring_ceiling": 12000,
           "purity": 6000,     "purity_ceiling": 12000},
    "ar": {"tailoring": 14000, "tailoring_ceiling": 32000,
           "purity": 14000,    "purity_ceiling": 32000},
}


def claude_budget(cv_language: str, key: str) -> int:
    """Look up an output-token budget for this CV language, defaulting to
    the English preset for any unrecognized language."""
    lang = "ar" if str(cv_language or "en").lower().startswith("ar") else "en"
    return CLAUDE_BUDGETS[lang][key]


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


def generate_claude_text(
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
    allowed to raise max_tokens. Defaults to _CLAUDE_MAX_TOKENS_CEILING.
    Arabic callers pass a higher value — see that constant's docstring for
    why a single global ceiling made Arabic generation impossible.

    Raises ClaudeTruncationError if the response is still truncated once the
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
    ceiling = max(max_tokens, max_tokens_ceiling or _CLAUDE_MAX_TOKENS_CEILING)
    truncation_retries = 0

    for attempt in range(1, max_retries + 1):
        try:
            call_kwargs = dict(
                model=CLAUDE_MODEL,
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

            with claude_client.messages.stream(**call_kwargs) as stream:
                # Draining the stream is what keeps the connection alive —
                # we don't need the chunks themselves, get_final_message()
                # below returns the same shape generate_claude_text always
                # returned (content blocks + stop_reason).
                for _ in stream.text_stream:
                    pass
                response = stream.get_final_message()

            text = "".join(
                block.text
                for block in response.content
                if getattr(block, "type", None) == "text"
            ).strip()

            if on_usage is not None:
                usage = getattr(response, "usage", None)
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
                    and truncation_retries < _CLAUDE_MAX_TRUNCATION_RETRIES
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
                        f"(truncation retry {truncation_retries}/{_CLAUDE_MAX_TRUNCATION_RETRIES})..."
                    )
                    continue

                # Out of headroom. Fail loudly instead of handing back a
                # half-finished string — see the docstring.
                raise ClaudeTruncationError(
                    f"Claude response {reason} and could not be completed within "
                    f"max_tokens={current_max_tokens} (ceiling={ceiling})."
                )

            return text
        except ClaudeTruncationError:
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


def generate_claude_json(prompt: str, max_tokens: int = 3000, max_retries: int = 5, on_usage=None) -> str:
    """
    Call Claude expecting a JSON object back. Claude doesn't have a native
    JSON response_mime_type like Gemini, so we instruct it in the prompt
    and the caller is responsible for stripping markdown fences if any slip through.
    """
    return generate_claude_text(prompt, max_tokens=max_tokens, max_retries=max_retries, on_usage=on_usage)


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
