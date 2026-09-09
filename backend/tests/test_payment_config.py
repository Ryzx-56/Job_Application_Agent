"""
The go-live configuration, asserted at boot.

Every way of getting the live switch wrong is silent — nothing fails at
startup, and the failure arrives later as a customer who has been charged and
credited nothing. These pin the checks that make it loud instead.
"""

import pytest

from core import moyasar_client as m


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for key in ("MOYASAR_SECRET_KEY", "MOYASAR_PUBLISHABLE_KEY",
                "MOYASAR_WEBHOOK_SECRET", "PUBLIC_APP_URL", "MOYASAR_MODE"):
        monkeypatch.delenv(key, raising=False)


def _env(monkeypatch, **values):
    for key, value in values.items():
        monkeypatch.setenv(key, value)


LIVE_OK = dict(
    MOYASAR_SECRET_KEY="sk_live_x",
    MOYASAR_PUBLISHABLE_KEY="pk_live_x",
    MOYASAR_WEBHOOK_SECRET="whsec",
    PUBLIC_APP_URL="https://tarshih.com",
    MOYASAR_MODE="live",
)


def test_no_keys_is_not_an_error():
    """Payments simply not being configured is a valid state, not a
    misconfiguration — it is how the product ran before go-live."""
    assert m.config_problems() == []
    assert m.mode() == "unknown"
    assert m.is_live() is False


def test_a_correct_live_setup_reports_nothing(monkeypatch):
    _env(monkeypatch, **LIVE_OK)
    assert m.config_problems() == []
    assert m.is_live() is True


def test_test_keys_are_clean_too(monkeypatch):
    _env(monkeypatch, MOYASAR_SECRET_KEY="sk_test_x", MOYASAR_PUBLISHABLE_KEY="pk_test_x")
    assert m.config_problems() == []
    assert m.is_live() is False


def test_mismatched_key_environments_are_caught(monkeypatch):
    """A live secret with a test publishable key: the browser tokenizes
    against test while the server charges live. Every payment fails, and the
    decline is not reproducible from either side alone."""
    _env(monkeypatch, **{**LIVE_OK, "MOYASAR_PUBLISHABLE_KEY": "pk_test_x"})
    problems = m.config_problems()
    assert len(problems) == 1
    assert "publishable" in problems[0].lower()


def test_live_without_a_webhook_secret_is_caught(monkeypatch):
    """The worst outcome this system can produce: the charge succeeds, the
    webhook 401s, and the buyer is never credited."""
    env = {k: v for k, v in LIVE_OK.items() if k != "MOYASAR_WEBHOOK_SECRET"}
    _env(monkeypatch, **env)
    problems = m.config_problems()
    assert any("WEBHOOK_SECRET" in p for p in problems)


def test_test_mode_without_a_webhook_secret_is_not_flagged(monkeypatch):
    """Only live keys make this urgent. Flagging it in test would train
    everyone to ignore the line."""
    _env(monkeypatch, MOYASAR_SECRET_KEY="sk_test_x")
    assert not any("WEBHOOK_SECRET" in p for p in m.config_problems())


def test_an_asserted_mode_that_contradicts_the_key_is_caught(monkeypatch):
    _env(monkeypatch, MOYASAR_SECRET_KEY="sk_test_x", MOYASAR_MODE="live")
    assert any("wrong key set is deployed" in p for p in m.config_problems())


def test_live_needs_an_https_return_url(monkeypatch):
    _env(monkeypatch, **{**LIVE_OK, "PUBLIC_APP_URL": "http://localhost:3000"})
    assert any("PUBLIC_APP_URL" in p for p in m.config_problems())


def test_an_unrecognised_key_prefix_is_reported_not_assumed_safe(monkeypatch):
    _env(monkeypatch, MOYASAR_SECRET_KEY="whatever")
    assert m.mode() == "unknown"
    assert m.is_live() is False, "an unknown key must never unlock live-only behaviour"
    assert m.config_problems()


def test_the_startup_report_never_logs_a_key(monkeypatch, capsys):
    _env(monkeypatch, **LIVE_OK)
    report = m.startup_report()
    assert "sk_live_x" not in str(report)
    assert "whsec" not in str(report)
    assert report["mode"] == "live"
    assert report["problems"] == []


def test_the_startup_report_can_be_made_fatal(monkeypatch):
    """Off by default — a payment misconfiguration must not stop the product
    serving CVs to people who are not buying anything."""
    _env(monkeypatch, **{**LIVE_OK, "MOYASAR_PUBLISHABLE_KEY": "pk_test_x"})
    with pytest.raises(m.MoyasarConfigError):
        m.startup_report(raise_on_problem=True)
