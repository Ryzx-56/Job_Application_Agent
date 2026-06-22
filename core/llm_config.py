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
GEMINI_MODEL = "gemini-2.5-flash"

# Claude client — used for writing tasks only (tailoring, cover letter, scoring)
claude_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
CLAUDE_MODEL = "claude-sonnet-4-20250514"

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
