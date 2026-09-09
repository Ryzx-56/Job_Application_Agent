"""
Parity between the two writing paths.

The blind model comparison ran Luna through an eval shim, so it measured
Luna's WRITING and exercised none of the production plumbing — retries,
truncation escalation, caching, usage reporting. Promoting that shim to a real
call path is the actual work of the migration, and these are the differences
that would otherwise have shipped silently:

  · Anthropic signals a cut-off response with `stop_reason == "max_tokens"`.
    OpenAI uses `finish_reason == "length"`. Reading the Anthropic field off an
    OpenAI response yields None, which reads as "finished normally" — a
    truncated CV returned as a complete one, with no error anywhere.
  · Anthropic reports `input_tokens`/`output_tokens`; OpenAI reports
    `prompt_tokens`/`completion_tokens`. Read the wrong pair and every cost
    figure silently becomes zero.
  · `max_tokens` is rejected outright by this OpenAI model generation; the
    parameter is `max_completion_tokens`.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

import core.llm_config as cfg


def _openai_response(text, finish_reason="stop", prompt=100, completion=50, cached=0):
    return SimpleNamespace(
        choices=[SimpleNamespace(
            message=SimpleNamespace(content=text), finish_reason=finish_reason)],
        usage=SimpleNamespace(
            prompt_tokens=prompt, completion_tokens=completion,
            prompt_tokens_details=SimpleNamespace(cached_tokens=cached)),
    )


def test_the_switch_routes_to_the_right_provider():
    assert cfg._is_anthropic("claude-sonnet-5")
    assert not cfg._is_anthropic("gpt-5.6-luna")


def test_reverting_is_one_line():
    """WRITING_MODEL is the whole migration. Both paths must stay callable."""
    assert callable(cfg._generate_anthropic_text)
    assert callable(cfg._generate_openai_text)


def test_openai_truncation_is_detected_and_the_budget_escalates():
    calls = []

    def create(**kwargs):
        calls.append(kwargs["max_completion_tokens"])
        # Truncated twice, then fits.
        if len(calls) <= 2:
            return _openai_response("half a CV", finish_reason="length")
        return _openai_response("a whole CV")

    with patch.object(cfg.openai_client.chat.completions, "create", side_effect=create):
        out = cfg._generate_openai_text("gpt-5.6-luna", "p", max_tokens=1000,
                                        max_tokens_ceiling=8000)
    assert out == "a whole CV"
    assert calls == [1000, 2000, 4000], calls


def test_openai_truncation_raises_rather_than_returning_half_a_cv():
    """The failure this prevents: a cut-off CV handed back as a finished one."""
    with patch.object(cfg.openai_client.chat.completions, "create",
                      return_value=_openai_response("half", finish_reason="length")):
        with pytest.raises(cfg.TruncationError):
            cfg._generate_openai_text("gpt-5.6-luna", "p", max_tokens=1000,
                                      max_tokens_ceiling=1000)


def test_an_empty_response_escalates_the_same_way_as_a_truncated_one():
    """Reasoning can consume the entire budget and leave no visible text —
    the same failure Anthropic's adaptive thinking produces."""
    calls = []

    def create(**kwargs):
        calls.append(kwargs["max_completion_tokens"])
        return _openai_response("" if len(calls) == 1 else "text")

    with patch.object(cfg.openai_client.chat.completions, "create", side_effect=create):
        assert cfg._generate_openai_text("gpt-5.6-luna", "p", max_tokens=500) == "text"
    assert calls == [500, 1000]


def test_usage_is_reported_as_input_output_not_prompt_completion():
    """Cost instrumentation reads one shape. If this mapping breaks, every
    figure in the pricing doc silently becomes zero."""
    seen = []
    with patch.object(cfg.openai_client.chat.completions, "create",
                      return_value=_openai_response("ok", prompt=1234, completion=567)):
        cfg._generate_openai_text("gpt-5.6-luna", "p", on_usage=lambda i, o: seen.append((i, o)))
    assert seen == [(1234, 567)]


def test_a_discarded_truncated_response_is_still_billed_to_the_caller():
    seen = []
    calls = []

    def create(**kwargs):
        calls.append(1)
        return _openai_response("x", finish_reason="length" if len(calls) == 1 else "stop",
                                prompt=10, completion=20)

    with patch.object(cfg.openai_client.chat.completions, "create", side_effect=create):
        cfg._generate_openai_text("gpt-5.6-luna", "p", max_tokens=100,
                                  on_usage=lambda i, o: seen.append((i, o)))
    assert seen == [(10, 20), (10, 20)], "a retried response still cost tokens"


def test_the_static_system_block_is_sent_first_so_the_prefix_cache_can_fire():
    captured = {}

    def create(**kwargs):
        captured.update(kwargs)
        return _openai_response("ok", cached=900)

    with patch.object(cfg.openai_client.chat.completions, "create", side_effect=create):
        cfg._generate_openai_text("gpt-5.6-luna", "the variable part",
                                  system="the static part")
    roles = [m["role"] for m in captured["messages"]]
    assert roles == ["system", "user"], "static content must lead the request"
    assert "max_tokens" not in captured, \
        "this model generation rejects max_tokens; the parameter is max_completion_tokens"
    assert cfg.LAST_CACHE_STATS["cached_tokens"] == 900


def test_retryable_errors_match_the_anthropic_paths_rules():
    import openai as oa
    req = SimpleNamespace()
    assert cfg._is_retryable_openai_error(oa.APIConnectionError(request=req))
    assert not cfg._is_retryable_openai_error(ValueError("nope"))
