"""
Recurring billing: the renewal job and the dunning schedule (§5).

The expensive failures here are double-charging someone and cutting off a
customer who is still paying, so most of this file is those two.
"""
from datetime import datetime, timedelta, timezone

import pytest

from core import billing, pricing


class FakeTable:
    def __init__(self, store, name):
        self.store, self.name = store, name
        self._op = self._payload = None
        self._filters, self._neq, self._lte, self._limit = {}, {}, {}, None
        self._in = {}

    def select(self, *_a, **_k): self._op = "select"; return self
    def insert(self, p): self._op, self._payload = "insert", p; return self
    def update(self, p): self._op, self._payload = "update", p; return self
    def upsert(self, p, on_conflict=None): self._op, self._payload = "upsert", p; return self
    def eq(self, c, v): self._filters[c] = v; return self
    def neq(self, c, v): self._neq[c] = v; return self
    def lte(self, c, v): self._lte[c] = v; return self
    def in_(self, c, vals): self._in[c] = list(vals); return self
    def limit(self, n): self._limit = n; return self
    def maybe_single(self): return self

    def _rows(self):
        out = []
        for r in self.store.setdefault(self.name, {}).values():
            if any(r.get(k) != v for k, v in self._filters.items()): continue
            if any(r.get(k) == v for k, v in self._neq.items()): continue
            if any(str(r.get(k) or "") > v for k, v in self._lte.items()): continue
            if any(r.get(k) not in vals for k, vals in self._in.items()): continue
            out.append(r)
        return out

    def execute(self):
        rows = self.store.setdefault(self.name, {})
        if self._op == "select":
            found = self._rows()
            single = bool(self._filters) and not self._lte and not self._in
            return type("R", (), {"data": (found[0] if found else None) if single else found})()
        if self._op in ("insert", "upsert"):
            key = self._payload.get("id") or self._payload.get("moyasar_token_id") \
                  or self._payload.get("moyasar_payment_id") or f"row{len(rows)+1}"
            rows[key] = {**rows.get(key, {}), **self._payload, "id": key}
            return type("R", (), {"data": [rows[key]]})()
        if self._op == "update":
            hit = self._rows()
            for r in hit: r.update(self._payload)
            return type("R", (), {"data": hit})()
        return type("R", (), {"data": None})()


class FakeAdmin:
    def __init__(self): self.store = {}
    def table(self, name): return FakeTable(self.store, name)
    def rpc(self, *_a, **_k): return type("R", (), {"execute": lambda s=None: type("X", (), {"data": None})()})()


NOW = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)


def make_sub(admin, **over):
    period_end = NOW - timedelta(days=1)
    sub = {
        "id": "sub-1", "user_id": "user-1", "plan": "pro", "status": "active",
        "payment_token_id": "tok-row-1",
        "current_period_start": billing._iso(period_end - timedelta(days=30)),
        "current_period_end": billing._iso(period_end),
        "next_billing_date": billing._iso(period_end),
        "failed_charge_count": 0, "canceled_at": None,
    }
    sub.update(over)
    admin.store.setdefault("subscriptions", {})["sub-1"] = sub
    admin.store.setdefault("payment_tokens", {})["tok-row-1"] = {
        "id": "tok-row-1", "user_id": "user-1", "moyasar_token_id": "token_abc",
        "status": "active", "card_brand": "visa", "card_last_four": "4242",
    }
    admin.store.setdefault("profiles", {})["user-1"] = {"id": "user-1", "tier": "pro"}
    return sub


@pytest.fixture
def env(monkeypatch):
    admin = FakeAdmin()
    charges, granted, emails = [], [], []

    def fake_charge(token_id, amount, currency="SAR", description="", **kw):
        charges.append({"token": token_id, "amount": amount, "given_id": kw.get("given_id")})
        return {"id": f"pay_{len(charges)}", "status": "paid", "amount": amount,
                "currency": currency, "metadata": kw.get("metadata") or {}}

    monkeypatch.setattr(billing, "get_admin_client", lambda: admin)
    monkeypatch.setattr(billing, "_now", lambda: NOW)
    monkeypatch.setattr(billing.moyasar_client, "charge_token", fake_charge)
    monkeypatch.setattr(billing, "record_and_grant",
                        lambda payment, source: granted.append((payment["id"], source)) or {"ok": True})
    monkeypatch.setattr(billing, "_notify",
                        lambda sub, stage, attempts, next_try: emails.append((stage, attempts)))
    return {"admin": admin, "charges": charges, "granted": granted, "emails": emails}


def sub_of(env): return env["admin"].store["subscriptions"]["sub-1"]


# ─── Period arithmetic ──────────────────────────────────────────────────────


def test_a_month_is_a_calendar_month_not_thirty_days():
    """30-day cycles fit 12.17 times in a year — someone paying monthly would
    be charged thirteen times in some years."""
    assert billing.add_month(datetime(2026, 1, 15, tzinfo=timezone.utc)).date().isoformat() == "2026-02-15"
    assert billing.add_month(datetime(2026, 3, 31, tzinfo=timezone.utc)).date().isoformat() == "2026-04-30"
    assert billing.add_month(datetime(2026, 1, 31, tzinfo=timezone.utc)).date().isoformat() == "2026-02-28"
    assert billing.add_month(datetime(2026, 12, 10, tzinfo=timezone.utc)).date().isoformat() == "2027-01-10"


def test_twelve_months_lands_on_the_same_day_next_year():
    d = datetime(2026, 5, 20, tzinfo=timezone.utc)
    for _ in range(12):
        d = billing.add_month(d)
    assert d.date().isoformat() == "2027-05-20"


# ─── The happy path ─────────────────────────────────────────────────────────


def test_due_subscription_is_charged_and_advanced(env):
    make_sub(env["admin"])
    summary = billing.run_due_renewals()

    assert summary["charged"] == 1
    assert env["charges"][0]["amount"] == pricing.CATALOG["pro_plan"].amount_halalas == 2900
    s = sub_of(env)
    assert s["status"] == "active" and s["failed_charge_count"] == 0
    assert s["next_billing_date"] == billing._iso(billing.add_month(NOW))
    # Credits go through the shared grant, so the webhook cannot grant again.
    assert env["granted"] == [("pay_1", "renewal")]


def test_a_second_run_the_same_day_charges_nothing(env):
    make_sub(env["admin"])
    billing.run_due_renewals()
    billing.run_due_renewals()
    assert len(env["charges"]) == 1


def test_not_yet_due_is_left_alone(env):
    make_sub(env["admin"], next_billing_date=billing._iso(NOW + timedelta(days=5)))
    assert billing.run_due_renewals()["due"] == 0
    assert env["charges"] == []


def test_the_given_id_is_a_uuid_derived_from_the_period(env):
    """Moyasar's own idempotency key, and it MUST be a valid UUID — their API
    rejects anything else with a 400, which the renewal job would have read as
    a declined charge and dunned the subscriber for.

    It still has to be DERIVED, not random: a retry of the same period must
    produce the same id so Moyasar returns the original payment rather than
    charging twice."""
    import uuid as _uuid

    make_sub(env["admin"])
    billing.run_due_renewals()
    given = env["charges"][0]["given_id"]

    _uuid.UUID(given)                      # raises if not a valid UUID
    assert given == str(_uuid.uuid5(
        _uuid.NAMESPACE_URL, "tarshih:renewal:sub-1:2026-09-01"))

    # Same period -> same key. Different period -> different key.
    other = str(_uuid.uuid5(_uuid.NAMESPACE_URL, "tarshih:renewal:sub-1:2026-10-01"))
    assert given != other


# ─── Dunning ────────────────────────────────────────────────────────────────


def decline(env, monkeypatch, status_value="failed"):
    monkeypatch.setattr(billing.moyasar_client, "charge_token",
                        lambda *a, **k: {"id": "pay_x", "status": status_value})


def test_first_decline_retries_in_one_day_and_keeps_access(env, monkeypatch):
    make_sub(env["admin"]); decline(env, monkeypatch)
    assert billing.run_due_renewals()["failed"] == 1

    s = sub_of(env)
    assert s["failed_charge_count"] == 1
    assert s["status"] == "active", "access must continue during retries"
    # Spaced from the ORIGINAL due date, not from now.
    assert s["next_billing_date"].startswith("2026-09-02")
    assert env["emails"] == [("retry", 1)]


def test_the_full_schedule_is_1_3_5_then_past_due_then_canceled(env, monkeypatch):
    """The whole ladder, walked in order."""
    make_sub(env["admin"]); decline(env, monkeypatch)
    due = billing._parse(sub_of(env)["current_period_end"])
    seen = []

    for _ in range(6):
        s = sub_of(env)
        if s["status"] == "canceled":
            break
        # Jump the clock to whenever the next attempt is scheduled.
        monkeypatch.setattr(billing, "_now", lambda t=billing._parse(s["next_billing_date"]): t)
        billing.run_due_renewals()
        s = sub_of(env)
        seen.append((s["failed_charge_count"], s["status"],
                     (billing._parse(s["next_billing_date"]) - due).days
                     if s["next_billing_date"] else None))

    assert seen == [
        (1, "active",   1),    # retry 1 at D+1
        (2, "active",   3),    # retry 2 at D+3
        (3, "active",   5),    # retry 3 at D+5
        (4, "past_due", 10),   # out of attempts; grace to D+10
        (5, "canceled", None),  # grace over
    ]
    assert [e[0] for e in env["emails"]] == ["retry", "retry", "retry", "past_due", "canceled"]


def test_cancellation_schedules_the_downgrade_rather_than_forcing_it(env, monkeypatch):
    """pending_tier, not tier: reset_credits_if_due already knows how to move
    someone to Free and re-grant the right allowance."""
    make_sub(env["admin"], status="past_due", failed_charge_count=4)
    decline(env, monkeypatch)
    billing.run_due_renewals()

    assert sub_of(env)["status"] == "canceled"
    assert sub_of(env)["canceled_at"] is not None
    assert env["admin"].store["profiles"]["user-1"]["pending_tier"] == "free"


def test_a_declined_charge_never_advances_the_period(env, monkeypatch):
    """An unpaid month must stay due, or a card that never works still buys a
    year of access."""
    make_sub(env["admin"]); decline(env, monkeypatch)
    before = sub_of(env)["current_period_end"]
    billing.run_due_renewals()
    assert sub_of(env)["current_period_end"] == before


def test_an_unreachable_moyasar_is_not_counted_as_a_decline(env, monkeypatch):
    """The outcome is unknown, not failed — the card may have been billed.
    Leave it due and let the next run resolve it under the same given_id."""
    def boom(*a, **k):
        raise billing.moyasar_client.MoyasarUnreachable("timeout")
    monkeypatch.setattr(billing.moyasar_client, "charge_token", boom)
    make_sub(env["admin"])

    assert billing.run_due_renewals()["skipped"] == 1
    s = sub_of(env)
    assert s["failed_charge_count"] == 0, "a timeout must not consume a dunning attempt"
    assert s["status"] == "active"
    assert env["emails"] == []


def test_a_non_paid_status_is_a_decline(env, monkeypatch):
    decline(env, monkeypatch, status_value="initiated")
    make_sub(env["admin"])
    billing.run_due_renewals()
    assert sub_of(env)["failed_charge_count"] == 1


def test_a_missing_card_goes_through_dunning_not_an_exception(env):
    make_sub(env["admin"], payment_token_id=None)
    assert billing.run_due_renewals()["failed"] == 1
    assert sub_of(env)["failed_charge_count"] == 1


def test_an_inactive_token_is_not_charged(env):
    """A token stored months ago can have been deactivated."""
    make_sub(env["admin"])
    env["admin"].store["payment_tokens"]["tok-row-1"]["status"] = "inactive"
    billing.run_due_renewals()
    assert env["charges"] == []
    assert sub_of(env)["failed_charge_count"] == 1


def test_one_bad_subscription_does_not_stop_the_run(env, monkeypatch):
    make_sub(env["admin"])
    env["admin"].store["subscriptions"]["sub-2"] = {
        **sub_of(env), "id": "sub-2", "user_id": "user-2", "plan": "nonsense",
    }
    summary = billing.run_due_renewals()
    assert summary["due"] == 2 and summary["charged"] == 1 and summary["skipped"] == 1
