"""
Admin refunds and the unspent-only clawback (§7).

There is no customer-facing refund flow by policy — credits and documents are
delivered the moment a payment clears — so everything here is the internal
path for billing errors and disputes.

The clawback ARITHMETIC is verified against a real PostgreSQL alongside the
migration that defines it; this file covers the route's behaviour: what it
refuses, what order it does things in, and what it records.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import payments


class Q:
    def __init__(self, store, name):
        self.store, self.name, self.op, self.f = store, name, None, {}
    def select(self, *a, **k): self.op = "select"; return self
    def update(self, p): self.op, self.p = "update", p; return self
    def eq(self, c, v): self.f[c] = v; return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    def maybe_single(self): return self
    def execute(self):
        rows = [r for r in self.store[self.name].values()
                if all(r.get(k) == v for k, v in self.f.items())]
        if self.op == "select":
            return type("R", (), {"data": rows[0] if rows else None})()
        for r in rows:
            r.update(self.p)
        return type("R", (), {"data": rows})()


class Admin:
    def __init__(self, store, clawback=0, rpc_raises=False):
        self.store, self.clawback, self.rpc_raises = store, clawback, rpc_raises
        self.rpc_calls = []
    def table(self, n): return Q(self.store, n)
    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if self.rpc_raises:
            raise RuntimeError("db down")
        return type("R", (), {"execute": lambda s=None, v=self.clawback: type("X", (), {"data": v})()})()


def make(status="paid", granted=30):
    return {"payments": {"pay_1": {
        "id": "row-1", "user_id": "u1", "moyasar_payment_id": "pay_1",
        "type": "credit_pack", "reference": "power_pack", "amount": 3800,
        "currency": "SAR", "status": status, "credits_granted": granted,
    }}}


@pytest.fixture
def env(monkeypatch):
    refunds = []
    monkeypatch.setattr(payments.moyasar_client, "refund_payment",
                        lambda pid, amount=None: refunds.append(pid) or {"id": pid, "status": "refunded"})
    app = FastAPI(); app.include_router(payments.router)
    app.dependency_overrides[payments.get_current_admin_user_id] = lambda: "admin-1"
    return {"client": TestClient(app), "refunds": refunds}


def run(env, monkeypatch, store, **kw):
    admin = Admin(store, **kw)
    monkeypatch.setattr(payments, "get_admin_client", lambda: admin)
    r = env["client"].post("/api/v1/admin/payments/pay_1/refund")
    return r, admin


def test_refund_claws_back_only_unspent_credits(env, monkeypatch):
    store = make(granted=30)
    r, admin = run(env, monkeypatch, store, clawback=12)   # 18 already spent

    assert r.status_code == 200
    body = r.json()
    assert body["credits_granted"] == 30
    assert body["credits_clawed_back"] == 12
    assert body["credits_already_spent"] == 18
    assert admin.rpc_calls == [("clawback_purchased_credits", {"p_user_id": "u1", "p_amount": 30})]
    # The row records what was RECOVERED, not what was granted, so the
    # difference stays legible months later.
    assert store["payments"]["pay_1"]["credits_granted"] == 18
    assert store["payments"]["pay_1"]["status"] == "refunded"


def test_a_fully_unspent_refund_takes_everything_back(env, monkeypatch):
    store = make(granted=30)
    r, _ = run(env, monkeypatch, store, clawback=30)
    assert r.json()["credits_clawed_back"] == 30
    assert store["payments"]["pay_1"]["credits_granted"] == 0


def test_the_refund_is_issued_before_anything_is_clawed_back(env, monkeypatch):
    """If Moyasar refuses, nothing may be taken from the customer's balance."""
    def refuse(pid, amount=None):
        raise payments.moyasar_client.MoyasarError("already refunded", status_code=400)
    monkeypatch.setattr(payments.moyasar_client, "refund_payment", refuse)

    store = make()
    r, admin = run(env, monkeypatch, store)
    assert r.status_code == 502
    assert admin.rpc_calls == [], "no clawback may run when the refund failed"
    assert store["payments"]["pay_1"]["status"] == "paid"


def test_an_unreachable_moyasar_changes_nothing(env, monkeypatch):
    def boom(pid, amount=None):
        raise payments.moyasar_client.MoyasarUnreachable("timeout")
    monkeypatch.setattr(payments.moyasar_client, "refund_payment", boom)

    store = make()
    r, admin = run(env, monkeypatch, store)
    assert r.status_code == 503
    assert admin.rpc_calls == []
    assert store["payments"]["pay_1"]["status"] == "paid"


def test_refunding_twice_is_a_no_op(env, monkeypatch):
    store = make(status="refunded")
    r, admin = run(env, monkeypatch, store)
    assert r.status_code == 200 and r.json()["already_refunded"] is True
    assert env["refunds"] == [], "must not ask Moyasar to refund it again"


def test_an_unpaid_payment_cannot_be_refunded(env, monkeypatch):
    store = make(status="failed")
    r, _ = run(env, monkeypatch, store)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_refundable"


def test_an_unknown_payment_is_404(env, monkeypatch):
    r, _ = run(env, monkeypatch, {"payments": {}})
    assert r.status_code == 404


def test_a_failed_clawback_still_reports_the_refund(env, monkeypatch):
    """The money is back even if the balance could not be adjusted. Reporting
    the refund as failed would be worse — it already happened."""
    store = make(granted=30)
    r, _ = run(env, monkeypatch, store, rpc_raises=True)
    assert r.status_code == 200
    assert r.json()["credits_clawed_back"] == 0
    assert store["payments"]["pay_1"]["status"] == "refunded"


def test_an_addon_refund_has_no_credits_to_claw_back(env, monkeypatch):
    store = make(granted=None)
    store["payments"]["pay_1"]["reference"] = "linkedin_premium"
    r, admin = run(env, monkeypatch, store)
    assert r.status_code == 200
    assert r.json()["credits_clawed_back"] == 0
    assert admin.rpc_calls == []


def test_the_route_requires_an_admin():
    """No override: the real dependency must reject an anonymous caller."""
    app = FastAPI(); app.include_router(payments.router)
    assert TestClient(app).post("/api/v1/admin/payments/pay_1/refund").status_code in (401, 403)
