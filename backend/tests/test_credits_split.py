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


# ─── Deploy skew: new code, old database ────────────────────────────────────
#
# The backend and the migrations deploy independently and can fail
# independently. On 2026-09-01 the migration run failed while the backend
# shipped, which is exactly this case. Credit spending is the product's hot
# path and must not depend on two deployments landing in the right order.


class MissingFunctionAdmin(FakeAdmin):
    """A database where the new functions were never created. PostgREST
    answers PGRST202 for an RPC it cannot find."""

    def __init__(self, missing):
        super().__init__()
        self.missing = missing

    def rpc(self, name, params):
        self.calls.append((name, params))
        if name in self.missing:
            raise RuntimeError(
                f"{{'code': 'PGRST202', 'message': 'Could not find the function "
                f"public.{name} in the schema cache'}}"
            )
        if name == "reserve_credits":
            return FakeRPC(self, True)
        return FakeRPC(self, None)


def test_spend_falls_back_when_the_migration_has_not_landed(monkeypatch):
    fake = MissingFunctionAdmin({"spend_credits"})
    monkeypatch.setattr(credits, "get_admin_client", lambda: fake)

    reserved = credits.reserve_credits("user-1", "ar")

    assert reserved == 2
    # Tried the new one, fell back to the old one — generation still works.
    assert [n for n, _ in fake.calls] == [
        "reset_credits_if_due", "spend_credits", "reserve_credits"
    ]
    # Nothing is claimed as purchased on a schema with no such column.
    assert (reserved.from_monthly, reserved.from_purchased) == (2, 0)


def test_refund_falls_back_when_the_migration_has_not_landed(monkeypatch):
    fake = MissingFunctionAdmin({"restore_credits"})
    monkeypatch.setattr(credits, "get_admin_client", lambda: fake)

    credits.refund_credits("user-1", credits.ReservedCredits(2, 1, 1))

    assert params_for(fake, "refund_credits") == {"p_user_id": "user-1", "p_amount": 2}


def test_grant_falls_back_but_still_delivers_the_credits(monkeypatch):
    """The customer has paid. They get their credits either way — the log is
    what says the migration is overdue."""
    fake = MissingFunctionAdmin({"grant_purchased_credits"})
    monkeypatch.setattr(credits, "get_admin_client", lambda: fake)

    credits.grant_credits("user-1", 30, reason="power_pack")

    assert params_for(fake, "refund_credits") == {"p_user_id": "user-1", "p_amount": 30}


def test_a_real_error_is_not_swallowed_as_a_missing_function(monkeypatch):
    """Falling back on a genuine failure would hide a bug and mis-report the
    monthly/purchased split."""
    class Broken(FakeAdmin):
        def rpc(self, name, params):
            self.calls.append((name, params))
            if name == "spend_credits":
                raise RuntimeError("deadlock detected")
            return FakeRPC(self, None)

    monkeypatch.setattr(credits, "get_admin_client", lambda: Broken())
    with pytest.raises(RuntimeError, match="deadlock"):
        credits.reserve_credits("user-1", "en")
