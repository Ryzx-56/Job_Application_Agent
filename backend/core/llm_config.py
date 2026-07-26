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

# Ceiling for the auto-escalation in generate_claude_text below. Sonnet 5
# supports up to 128k output tokens on the synchronous Messages API, so this
# is nowhere near the model's real limit — it's just a sane cap so a broken
# prompt can't spin the retry loop into something huge/expensive.
_CLAUDE_MAX_TOKENS_CEILING = 8000

# Shared config for Gemini JSON responses
gemini_json_config = types.GenerateContentConfig(
    response_mime_type="application/json"
)


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
            return response.text
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


def generate_claude_text(prompt: str, max_tokens: int = 3000, max_retries: int = 5, on_usage=None, system: str | None = None) -> str:
    """
    Call Claude and return plain text. Retries on rate limits / transient
    server errors with backoff.

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

            if (truncated or empty) and attempt < max_retries and current_max_tokens < _CLAUDE_MAX_TOKENS_CEILING:
                reason = "truncated by max_tokens" if truncated else "empty (thinking used the whole budget)"
                current_max_tokens = min(current_max_tokens * 2, _CLAUDE_MAX_TOKENS_CEILING)
                print(
                    f"[Claude] Response {reason} at max_tokens={current_max_tokens // 2}. "
                    f"Retrying with max_tokens={current_max_tokens} (attempt {attempt}/{max_retries})..."
                )
                continue

            return text
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
            return response.text
        except (genai_errors.ClientError, genai_errors.ServerError) as e:
            last_error = e
            if _is_retryable_gemini_error(e) and attempt < max_retries:
                delay = _retry_delay_seconds(e, attempt)
                print(f"[Gemini] Rate limited, retrying in {delay:.0f}s (attempt {attempt}/{max_retries})")
                time.sleep(delay)
                continue
            raise

    raise RuntimeError(f"Gemini failed after {max_retries} attempts: {last_error}")
