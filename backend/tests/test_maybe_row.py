"""
maybe_row() and the decorator that must not be attached to it.

This exists because the helper was first added directly beneath
get_admin_client's `@lru_cache(maxsize=1)` line, which silently moved the
decorator onto the helper. lru_cache hashes its arguments and a
SingleAPIResponse is unhashable, so every caller got

    TypeError: unhashable type

and every route that reads a single row — the three subscription endpoints
and /api/v1/credits — returned 500. Which, because an unhandled exception
carries no CORS headers, reached the browser as "Failed to fetch".
"""
import os
import pytest

os.environ.setdefault("GEMINI_API_KEY", "x")
from core import credits


class Unhashable:
    """Stands in for SingleAPIResponse, which defines no __hash__ we may rely on."""
    __hash__ = None
    data = {"id": "row"}


def test_maybe_row_returns_the_row():
    assert credits.maybe_row(Unhashable()) == {"id": "row"}


def test_maybe_row_returns_none_for_no_row():
    """postgrest returns None from execute() itself when nothing matched."""
    assert credits.maybe_row(None) is None


def test_maybe_row_is_not_cached():
    """A cache here raises TypeError for every caller — see the module docstring."""
    assert not hasattr(credits.maybe_row, "cache_info"), (
        "maybe_row must not be decorated with lru_cache: its argument is unhashable"
    )


def test_maybe_row_accepts_an_unhashable_argument():
    """The direct expression of the bug: this raised TypeError in production."""
    credits.maybe_row(Unhashable())


def test_get_admin_client_is_still_cached():
    """The decorator belongs here, and moving the helper must not steal it."""
    assert hasattr(credits.get_admin_client, "cache_info"), (
        "get_admin_client lost its @lru_cache — a new Supabase client per call"
    )
