"""
A subscription must never be created without a card to renew it.

THE BUG THIS PINS. `_upsert_token` caught every exception, logged, and
returned None. `start_subscription` never checked the return value, so the
subscription row was written with `payment_token_id` NULL. The customer's
money had been taken, the plan looked active, and a month later the renewal
job found no card and it lapsed with nothing to explain it.

The module's docstring already stated the rule — "NO TOKEN MEANS NO
SUBSCRIPTION ... pretending otherwise creates a subscription that silently
lapses in a month" — but it was only enforced for a token that never arrived,
never for one that arrived and could not be stored.
"""

from unittest.mock import MagicMock, patch

import pytest

import core.billing as billing


PAYMENT = {"id": "pay_1", "source": {"token": "tok_live_1", "company": "visa",
                                     "last_four": "4242", "month": "12", "year": "2030"}}


@pytest.fixture(autouse=True)
def _no_sleep():
    """The retry sleeps a second. Tests should not."""
    with patch.object(billing.time, "sleep"):
        yield


def _admin_with_working_token_store():
    admin = MagicMock()
    admin.table.return_value.upsert.return_value.execute.return_value.data = [
        {"id": "tok-row-1", "card_brand": "visa", "card_last_four": "4242"}
    ]
    admin.table.return_value.insert.return_value.execute.return_value.data = [{"id": "sub-1"}]
    admin.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
    return admin


def test_a_failed_card_store_refuses_the_subscription(caplog):
    """The whole point: no row, rather than a row that cannot renew."""
    admin = MagicMock()
    admin.table.return_value.upsert.side_effect = Exception("connection reset")

    with patch.object(billing, "get_admin_client", return_value=admin), \
         patch.object(billing, "_live_subscription", return_value=None), \
         patch.object(billing, "_align_credit_clock"):
        result = billing.start_subscription("user-1", "pro_plan", PAYMENT)

    assert result is None, "a subscription was created with no card to charge"
    admin.table.return_value.insert.assert_not_called()


def test_it_retries_once_before_giving_up():
    """A transient database error must not cost a paying customer their plan."""
    admin = _admin_with_working_token_store()
    calls = {"n": 0}

    def flaky(*_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise Exception("connection reset")
        return MagicMock(execute=MagicMock(
            return_value=MagicMock(data=[{"id": "tok-row-1", "card_brand": "visa",
                                          "card_last_four": "4242"}])))

    admin.table.return_value.upsert.side_effect = flaky

    with patch.object(billing, "get_admin_client", return_value=admin), \
         patch.object(billing, "_live_subscription", return_value=None), \
         patch.object(billing, "_align_credit_clock"), \
         patch("core.subscription.activate_paid_subscription"):
        result = billing.start_subscription("user-1", "pro_plan", PAYMENT)

    assert calls["n"] == 2, "it did not retry"
    assert result is not None, "a recoverable error was treated as fatal"


def test_an_upsert_that_returns_no_row_is_also_a_failure():
    """It raised nothing and stored nothing — which produced the identical
    NULL payment_token_id as an exception did."""
    admin = MagicMock()
    admin.table.return_value.upsert.return_value.execute.return_value.data = []

    with patch.object(billing, "get_admin_client", return_value=admin), \
         patch.object(billing, "_live_subscription", return_value=None), \
         patch.object(billing, "_align_credit_clock"):
        assert billing.start_subscription("user-1", "pro_plan", PAYMENT) is None


def test_a_missing_token_still_refuses(caplog):
    """The half that was always handled. Kept so it cannot regress."""
    with patch.object(billing, "get_admin_client"):
        assert billing.start_subscription(
            "user-1", "pro_plan", {"id": "pay_1", "source": {}}) is None


def test_the_success_log_cannot_describe_a_missing_card(caplog):
    """`card ? ••••????` was a failure notice printed inside a success
    message. Anything that renders as success while describing a broken state
    will eventually be read as success."""
    import inspect
    source = inspect.getsource(billing.start_subscription)
    assert "'????'" not in source and '"????"' not in source, \
        "the placeholder tell is back — a success line must not be printable without a card"


def test_store_failure_raises_rather_than_returning_none():
    """None already meant 'nothing to store'. Overloading it is what let the
    caller ignore a failure."""
    admin = MagicMock()
    admin.table.return_value.upsert.side_effect = Exception("boom")
    with pytest.raises(billing.CardTokenStoreFailed):
        billing._upsert_token(admin, "user-1", "tok_1", {})
