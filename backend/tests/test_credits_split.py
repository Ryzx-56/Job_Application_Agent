"""
The two kinds of credit: monthly (expires at the reset) and purchased (does
not). Covers the Python half — that reserve/refund/grant call the right SQL
functions and that a refund puts each kind back where it came from.

The SQL half (spend order, the reset itself, the downgrade branch) is verified
directly against PostgreSQL; see the migration
20260901230500_purchased_credits_survive_reset.sql.
"""
import pytest

from core import credits


class FakeRPC:
    def __init__(self, store, result):
        self.store, self.result = store, result

    def execute(self):
        return type("R", (), {"data": self.result})()


class FakeAdmin:
    """Records every rpc() call so the test can assert which SQL function was
    invoked with what."""

    def __init__(self, spend_result=None):
        self.calls = []
        self.spend_result = spend_result if spend_result is not None else {
            "ok": True, "from_monthly": 1, "from_purchased": 0
        }

    def rpc(self, name, params):
        self.calls.append((name, params))
        if name == "spend_credits":
            return FakeRPC(self, self.spend_result)
        return FakeRPC(self, None)

    def table(self, _name):
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return type("R", (), {"data": {"credits_remaining": 0, "tier": "free"}})()


@pytest.fixture
def admin(monkeypatch):
    fake = FakeAdmin()
    monkeypatch.setattr(credits, "get_admin_client", lambda: fake)
    return fake


def names(admin):
    return [name for name, _ in admin.calls]


def params_for(admin, fn):
    return next(p for n, p in admin.calls if n == fn)


# ─── Reserving ──────────────────────────────────────────────────────────────


def test_reserve_uses_spend_credits_and_still_behaves_as_an_int(admin):
    admin.spend_result = {"ok": True, "from_monthly": 2, "from_purchased": 0}
    reserved = credits.reserve_credits("user-1", "ar")

    assert "spend_credits" in names(admin)
    # Every existing call site treats this as a number; it still is one.
    assert reserved == 2
    assert isinstance(reserved, int)
    assert reserved + 1 == 3
    assert params_for(admin, "spend_credits")["p_amount"] == 2   # Arabic costs 2


def test_reserve_carries_the_split(admin):
    admin.spend_result = {"ok": True, "from_monthly": 1, "from_purchased": 1}
    reserved = credits.reserve_credits("user-1", "ar")

    assert (reserved.from_monthly, reserved.from_purchased) == (1, 1)


def test_reserve_still_resets_before_checking(admin):
    """The lazy monthly reset has to run first or a due user is told they're
    out of credits they should already have."""
    credits.reserve_credits("user-1", "en")
    assert names(admin).index("reset_credits_if_due") < names(admin).index("spend_credits")


def test_insufficient_balance_raises_402(admin):
    admin.spend_result = {"ok": False, "from_monthly": 0, "from_purchased": 0}
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        credits.reserve_credits("user-1", "en")
    assert excinfo.value.status_code == 402
    assert excinfo.value.detail["code"] == "insufficient_credits"


# ─── Refunding ──────────────────────────────────────────────────────────────


def test_refund_returns_each_kind_to_its_own_balance(admin):
    reserved = credits.ReservedCredits(2, from_monthly=1, from_purchased=1)
    credits.refund_credits("user-1", reserved)

    assert params_for(admin, "restore_credits") == {
        "p_user_id": "user-1", "p_from_monthly": 1, "p_from_purchased": 1
    }


def test_refund_of_a_bare_int_is_treated_as_monthly(admin):
    """The safe direction: it can under-restore the non-expiring balance,
    never invent one."""
    credits.refund_credits("user-1", 2)
    assert params_for(admin, "restore_credits") == {
        "p_user_id": "user-1", "p_from_monthly": 2, "p_from_purchased": 0
    }


def test_refund_failure_is_swallowed_so_it_cannot_mask_the_real_error(monkeypatch):
    class Boom(FakeAdmin):
        def rpc(self, name, params):
            raise RuntimeError("supabase down")

    monkeypatch.setattr(credits, "get_admin_client", lambda: Boom())
    credits.refund_credits("user-1", 2)          # must not raise


# ─── Granting a bought pack ─────────────────────────────────────────────────


def test_grant_marks_credits_as_purchased(admin):
    """The whole fix: granted credits must go through the function that also
    records them as non-expiring, or the next reset erases them."""
    credits.grant_credits("user-1", 30, reason="power_pack")

    assert params_for(admin, "grant_purchased_credits") == {
        "p_user_id": "user-1", "p_amount": 30
    }
    # The old path added to the spendable balance without labelling it.
    assert "refund_credits" not in names(admin)


def test_grant_refuses_a_non_positive_amount(admin):
    with pytest.raises(ValueError):
        credits.grant_credits("user-1", 0)
    assert admin.calls == []


def test_grant_raises_rather_than_swallowing(monkeypatch):
    """Unlike refund: the customer has already paid, so a silent failure is
    someone who paid and got nothing."""
    class Boom(FakeAdmin):
        def rpc(self, name, params):
            raise RuntimeError("supabase down")

    monkeypatch.setattr(credits, "get_admin_client", lambda: Boom())
    with pytest.raises(RuntimeError):
        credits.grant_credits("user-1", 5)
