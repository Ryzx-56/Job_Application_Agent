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


def generate_claude_text(prompt: str, max_tokens: int = 3000, max_retries: int = 5) -> str:
    """
    Call Claude and return plain text. Retries on rate limits / transient
    server errors with backoff.

    IMPORTANT — Claude Sonnet 5 behavior change vs 4.6: adaptive thinking is
    ON BY DEFAULT (no `thinking` field needed to trigger it), and thinking
    tokens count against `max_tokens` — it's a hard cap on thinking + visible
    text combined, not just visible text. We deliberately do NOT disable
    thinking here (it improves output quality, and quality > speed for this
    pipeline). Instead, if a response comes back truncated (stop_reason ==
    "max_tokens") or thinking consumed the entire budget and left zero
    visible text, we automatically double the budget and retry rather than
    silently shipping a cut-off CV / cover letter / JSON blob.
    """
    last_error = None
    current_max_tokens = max_tokens

    for attempt in range(1, max_retries + 1):
        try:
            response = claude_client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=current_max_tokens,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )

            text = "".join(
                block.text
                for block in response.content
                if getattr(block, "type", None) == "text"
            ).strip()

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


def generate_claude_json(prompt: str, max_tokens: int = 3000, max_retries: int = 5) -> str:
    """
    Call Claude expecting a JSON object back. Claude doesn't have a native
    JSON response_mime_type like Gemini, so we instruct it in the prompt
    and the caller is responsible for stripping markdown fences if any slip through.
    """
    return generate_claude_text(prompt, max_tokens=max_tokens, max_retries=max_retries)


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
