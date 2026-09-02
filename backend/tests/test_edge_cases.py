"""
§8 — the edge cases, gathered in one place.

Most are already covered where the behaviour lives (test_payments,
test_webhook, test_billing). This file covers the one case nothing else did —
a payment that stops moving — and asserts the cross-cutting orderings in a
single place so the guarantee is readable as a whole rather than inferred
from four files.
"""
from datetime import datetime, timedelta, timezone

import pytest

from core import billing, payments


class Q:
    def __init__(self, store, name):
        self.store, self.name, self.op, self.f = store, name, None, {}
        self.inv, self._lte, self._gte = {}, {}, {}
    def select(self, *a, **k): self.op = "select"; return self
    def update(self, p): self.op, self.p = "update", p; return self
    def upsert(self, p, on_conflict=None): self.op, self.p = "upsert", p; return self
    def eq(self, c, v): self.f[c] = v; return self
    def is_(self, c, v): self.f[f"{c}__is"] = v; return self
    def in_(self, c, v): self.inv[c] = list(v); return self
    def lte(self, c, v): self._lte[c] = v; return self
    def gte(self, c, v): self._gte[c] = v; return self
    def limit(self, n): return self
    def maybe_single(self): return self
    def _rows(self):
        out = []
        for r in self.store.setdefault(self.name, {}).values():
            if any(r.get(k) != v for k, v in self.f.items() if not k.endswith("__is")): continue
            if self.f.get("credits_granted__is") == "null" and r.get("credits_granted") is not None: continue
            if any(r.get(k) not in v for k, v in self.inv.items()): continue
            if any(str(r.get(k) or "") > v for k, v in self._lte.items()): continue
            if any(str(r.get(k) or "") < v for k, v in self._gte.items()): continue
            out.append(r)
        return out
    def execute(self):
        rows = self.store.setdefault(self.name, {})
        if self.op == "select":
            found = self._rows()
            return type("R", (), {"data": found})()
        if self.op == "upsert":
            k = self.p["moyasar_payment_id"]
            rows[k] = {**rows.get(k, {}), **self.p}
            return type("R", (), {"data": [rows[k]]})()
        hit = self._rows()
        for r in hit: r.update(self.p)
        return type("R", (), {"data": hit})()


class Admin:
    def __init__(self, store): self.store = store
    def table(self, n): return Q(self.store, n)


NOW = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)


def stale_row(created, status="initiated"):
    return {"moyasar_payment_id": "pay_s", "user_id": "u1", "type": "credit_pack",
            "reference": "starter_pack", "amount": 900, "currency": "SAR",
            "status": status, "credits_granted": None,
            "created_at": billing._iso(created)}


@pytest.fixture
def env(monkeypatch):
    store = {"payments": {}}
    grants = []
    monkeypatch.setattr(billing, "get_admin_client", lambda: Admin(store))
    monkeypatch.setattr(payments, "get_admin_client", lambda: Admin(store))
    monkeypatch.setattr(payments, "grant_credits", lambda u, a, **k: grants.append((u, a)))
    monkeypatch.setattr(billing, "_now", lambda: NOW)
    return {"store": store, "grants": grants}


# ─── A payment that stopped moving ──────────────────────────────────────────


def test_a_payment_stuck_at_initiated_but_actually_paid_is_settled(env, monkeypatch):
    """The 3-D Secure hole: the buyer never came back AND the webhook never
    arrived, so the row sat at 'initiated' while the card had been charged."""
    env["store"]["payments"]["pay_s"] = stale_row(NOW - timedelta(hours=2))
    monkeypatch.setattr(billing.moyasar_client, "get_payment", lambda pid: {
        "id": "pay_s", "status": "paid", "amount": 900, "currency": "SAR",
        "metadata": {"user_id": "u1", "reference": "starter_pack"},
    })

    summary = billing.reconcile_stale_payments()
    assert summary["settled_paid"] == 1
    assert env["grants"] == [("u1", 5)], "the customer finally gets what they paid for"
    assert env["store"]["payments"]["pay_s"]["status"] == "paid"


def test_a_stale_payment_that_really_failed_is_closed_without_granting(env, monkeypatch):
    env["store"]["payments"]["pay_s"] = stale_row(NOW - timedelta(hours=2))
    monkeypatch.setattr(billing.moyasar_client, "get_payment", lambda pid: {
        "id": "pay_s", "status": "failed", "amount": 900, "currency": "SAR",
        "metadata": {"user_id": "u1", "reference": "starter_pack"},
    })
    summary = billing.reconcile_stale_payments()
    assert summary["settled_failed"] == 1
    assert env["grants"] == []
    assert env["store"]["payments"]["pay_s"]["status"] == "failed"


def test_a_payment_still_in_flight_is_left_alone(env, monkeypatch):
    """Too young to touch — the buyer may be on the 3-D Secure screen right
    now, and asking mid-flow just sees 'initiated' again."""
    env["store"]["payments"]["pay_s"] = stale_row(NOW - timedelta(minutes=2))
    called = []
    monkeypatch.setattr(billing.moyasar_client, "get_payment",
                        lambda pid: called.append(pid) or {})
    assert billing.reconcile_stale_payments()["checked"] == 0
    assert called == []


def test_an_abandoned_payment_is_not_swept_forever(env, monkeypatch):
    """Past the cutoff it is Moyasar's record to consult, not a daily job's."""
    env["store"]["payments"]["pay_s"] = stale_row(NOW - timedelta(days=30))
    assert billing.reconcile_stale_payments()["checked"] == 0


def test_reconciliation_is_safe_to_run_twice(env, monkeypatch):
    env["store"]["payments"]["pay_s"] = stale_row(NOW - timedelta(hours=2))
    monkeypatch.setattr(billing.moyasar_client, "get_payment", lambda pid: {
        "id": "pay_s", "status": "paid", "amount": 900, "currency": "SAR",
        "metadata": {"user_id": "u1", "reference": "starter_pack"},
    })
    billing.reconcile_stale_payments()
    billing.reconcile_stale_payments()
    assert env["grants"] == [("u1", 5)], "granted once, not twice"


def test_an_unreachable_moyasar_leaves_the_row_for_next_time(env, monkeypatch):
    env["store"]["payments"]["pay_s"] = stale_row(NOW - timedelta(hours=2))
    def boom(pid):
        raise billing.moyasar_client.MoyasarUnreachable("timeout")
    monkeypatch.setattr(billing.moyasar_client, "get_payment", boom)

    summary = billing.reconcile_stale_payments()
    assert summary["unreachable"] == 1
    assert env["store"]["payments"]["pay_s"]["status"] == "initiated"
    assert env["grants"] == []


# ─── The orderings, asserted together ───────────────────────────────────────


PAID = {"id": "pay_o", "status": "paid", "amount": 900, "currency": "SAR",
        "metadata": {"user_id": "u1", "reference": "starter_pack"}}


@pytest.mark.parametrize("sequence", [
    ["callback"],
    ["webhook"],
    ["callback", "webhook"],
    ["webhook", "callback"],
    ["webhook", "webhook"],
    ["callback", "callback"],
    ["webhook", "callback", "webhook", "reconcile"],
])
def test_every_ordering_grants_exactly_once(env, sequence):
    """The reason §3 and §4 share one grant function, stated as a property:
    any order, any repetition, one grant."""
    for source in sequence:
        payments.record_and_grant(dict(PAID), source=source)
    assert env["grants"] == [("u1", 5)], f"{sequence} granted {len(env['grants'])} times"
