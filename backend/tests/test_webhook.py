"""
The Moyasar webhook receiver (§4).

WHAT MATTERS HERE, in order:
  1. An unverified caller cannot make anything happen.
  2. A delivery that crashed midway is retried, not acknowledged as done.
  3. An authentic event we don't act on still gets a 200, or Moyasar retries
     it forever.
  4. The body is never believed about money — the payment is re-read from the
     API, so a replayed or edited body grants nothing.
"""
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from core import payments, pricing


# ─── Fakes ──────────────────────────────────────────────────────────────────


class FakeQuery:
    def __init__(self, store, table):
        self.store, self.table = store, table
        self._payload = None
        self._filters = {}
        self._neq = {}
        self._op = None

    def select(self, *_a, **_k):
        self._op = "select"; return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload; return self

    def update(self, payload):
        self._op, self._payload = "update", payload; return self

    def upsert(self, payload, on_conflict=None):
        self._op, self._payload = "upsert", payload; return self

    def eq(self, col, val):
        self._filters[col] = val; return self

    def neq(self, col, val):
        self._neq[col] = val; return self

    def is_(self, col, val):
        self._filters[f"{col}__is"] = val; return self

    def maybe_single(self):
        return self

    def execute(self):
        rows = self.store.setdefault(self.table, {})
        key = self._filters.get("moyasar_event_id") or self._filters.get("moyasar_payment_id")

        if self._op == "select":
            if key is not None:
                return type("R", (), {"data": rows.get(key)})()
            found = [r for r in rows.values()
                     if all(r.get(k) == v for k, v in self._filters.items())
                     and all(r.get(k) != v for k, v in self._neq.items())]
            return type("R", (), {"data": found[0] if found else None})()

        if self._op == "insert":
            k = self._payload.get("moyasar_event_id")
            if k in rows:
                raise RuntimeError("duplicate key value violates unique constraint")
            rows[k] = dict(self._payload)
            return type("R", (), {"data": [rows[k]]})()

        if self._op == "upsert":
            k = self._payload.get("moyasar_payment_id")
            rows[k] = {**rows.get(k, {}), **self._payload}
            return type("R", (), {"data": [rows[k]]})()

        if self._op == "update":
            row = rows.get(key)
            if row is None:
                return type("R", (), {"data": []})()
            if self._filters.get("credits_granted__is") == "null" and row.get("credits_granted") is not None:
                return type("R", (), {"data": []})()
            row.update(self._payload)
            return type("R", (), {"data": [row]})()

        return type("R", (), {"data": None})()


class FakeAdmin:
    def __init__(self):
        self.store = {}

    def table(self, name):
        return FakeQuery(self.store, name)


SECRET = "test-webhook-secret-value"

PAYMENT = {
    "id": "pay_wh_1",
    "status": "paid",
    "amount": 900,
    "currency": "SAR",
    "metadata": {"user_id": "user-abc", "reference": "starter_pack"},
}


def envelope(**over):
    e = {
        "id": "evt_1",
        "type": "payment_paid",
        "created_at": "2026-09-02T10:00:00Z",
        "secret_token": SECRET,
        "data": {"id": "pay_wh_1", "status": "paid"},
    }
    e.update(over)
    return e


@pytest.fixture
def env(monkeypatch):
    admin = FakeAdmin()
    grants = []
    fetched = {"count": 0}

    def fake_get_payment(pid):
        fetched["count"] += 1
        return dict(PAYMENT)

    monkeypatch.setattr(payments, "get_admin_client", lambda: admin)
    monkeypatch.setattr(payments, "grant_credits",
                        lambda uid, amt, **kw: grants.append((uid, amt)))
    monkeypatch.setattr(payments.moyasar_client, "webhook_secret", lambda: SECRET)
    monkeypatch.setattr(payments.moyasar_client, "get_payment", fake_get_payment)

    app = FastAPI(); app.include_router(payments.router)
    return {"client": TestClient(app), "admin": admin, "grants": grants, "fetched": fetched}


def events(env):
    return env["admin"].store.get("webhook_events", {})


# ─── 1. Authenticity ────────────────────────────────────────────────────────


def test_wrong_secret_is_refused_and_changes_nothing(env):
    r = env["client"].post("/api/v1/webhooks/moyasar", json=envelope(secret_token="wrong"))
    assert r.status_code == 403
    assert env["grants"] == []
    assert events(env) == {}


def test_missing_secret_is_refused(env):
    body = envelope(); body.pop("secret_token")
    assert env["client"].post("/api/v1/webhooks/moyasar", json=body).status_code == 403


def test_unset_server_secret_refuses_everything(env, monkeypatch):
    """Fail closed: an unverifiable webhook is an unauthenticated request to
    hand out credits."""
    monkeypatch.setattr(payments.moyasar_client, "webhook_secret", lambda: "")
    assert env["client"].post("/api/v1/webhooks/moyasar", json=envelope()).status_code == 403


def test_non_json_body_is_rejected(env):
    r = env["client"].post("/api/v1/webhooks/moyasar", content=b"not json",
                           headers={"Content-Type": "application/json"})
    assert r.status_code == 400


# ─── 2. Idempotency ─────────────────────────────────────────────────────────


def test_paid_event_grants_once(env):
    r = env["client"].post("/api/v1/webhooks/moyasar", json=envelope())
    assert r.status_code == 200 and r.json()["ok"]
    assert env["grants"] == [("user-abc", 5)]
    assert events(env)["evt_1"]["processed_at"] is not None


def test_redelivery_of_a_processed_event_does_nothing(env):
    env["client"].post("/api/v1/webhooks/moyasar", json=envelope())
    before = env["fetched"]["count"]

    r = env["client"].post("/api/v1/webhooks/moyasar", json=envelope())
    assert r.status_code == 200 and r.json()["idempotent"] is True
    assert env["grants"] == [("user-abc", 5)]
    # It did not even re-read the payment: the event was already finished.
    assert env["fetched"]["count"] == before


def test_a_delivery_that_crashed_is_retried_not_acknowledged(env, monkeypatch):
    """The distinction that makes recording-before-processing safe. A first
    attempt that fails must leave the event unprocessed, so Moyasar's retry
    does real work instead of being waved through as a duplicate."""
    def boom(pid):
        raise payments.moyasar_client.MoyasarUnreachable("timeout")

    monkeypatch.setattr(payments.moyasar_client, "get_payment", boom)
    r = env["client"].post("/api/v1/webhooks/moyasar", json=envelope())
    # 503 so Moyasar retries — the outcome is unknown, not failed.
    assert r.status_code == 503
    assert events(env)["evt_1"].get("processed_at") is None
    assert env["grants"] == []

    # The retry succeeds and grants.
    monkeypatch.setattr(payments.moyasar_client, "get_payment", lambda pid: dict(PAYMENT))
    r = env["client"].post("/api/v1/webhooks/moyasar", json=envelope())
    assert r.status_code == 200
    assert env["grants"] == [("user-abc", 5)]
    assert events(env)["evt_1"]["processed_at"] is not None


def test_callback_first_then_webhook_grants_once(env):
    """§8's ordering requirement, across both entry points."""
    payments.record_and_grant(dict(PAYMENT), source="callback")
    assert env["grants"] == [("user-abc", 5)]

    r = env["client"].post("/api/v1/webhooks/moyasar", json=envelope())
    assert r.status_code == 200
    assert env["grants"] == [("user-abc", 5)]


# ─── 3. Events we don't act on still get a 200 ──────────────────────────────


@pytest.mark.parametrize("etype", ["payment_authorized", "payment_captured",
                                   "payment_voided", "balance_updated", "unknown"])
def test_unhandled_event_types_are_acknowledged(env, etype):
    """A 4xx/5xx here would make Moyasar retry forever."""
    r = env["client"].post("/api/v1/webhooks/moyasar",
                           json=envelope(id=f"evt_{etype}", type=etype))
    assert r.status_code == 200
    assert r.json()["ignored"] is True
    assert env["grants"] == []


def test_failed_payment_is_recorded_and_grants_nothing(env, monkeypatch):
    monkeypatch.setattr(payments.moyasar_client, "get_payment",
                        lambda pid: {**PAYMENT, "status": "failed"})
    r = env["client"].post("/api/v1/webhooks/moyasar",
                           json=envelope(id="evt_f", type="payment_failed"))
    assert r.status_code == 200
    assert env["grants"] == []
    assert env["admin"].store["payments"]["pay_wh_1"]["status"] == "failed"


def test_event_with_no_payment_id_is_acknowledged(env):
    r = env["client"].post("/api/v1/webhooks/moyasar",
                           json=envelope(id="evt_nodata", data={}))
    assert r.status_code == 200
    assert r.json()["reason"] == "no_payment_id"


# ─── 4. The body is never believed about money ──────────────────────────────


def test_amount_in_the_body_is_ignored(env):
    """Knowing the secret proves the delivery is Moyasar's. It does not make
    the numbers in it true — everything that decides a grant is re-read."""
    lying = envelope()
    lying["data"] = {"id": "pay_wh_1", "status": "paid", "amount": 999999}
    r = env["client"].post("/api/v1/webhooks/moyasar", json=lying)
    assert r.status_code == 200
    # Granted the pack's real credits, and stored the API's amount, not the body's.
    assert env["grants"] == [("user-abc", 5)]
    assert env["admin"].store["payments"]["pay_wh_1"]["amount"] == 900


def test_first_plan_payment_grants_and_starts_the_subscription(env, monkeypatch):
    """Changed by §5. Before recurring billing existed this recorded the
    payment and granted nothing, because a plan with no billing period
    attached is a month of Pro that never renews. Now the subscription is
    created in the same delivery, so granting is correct."""
    started = {}
    monkeypatch.setattr(payments.moyasar_client, "get_payment", lambda pid: {
        "id": "pay_plan", "status": "paid", "amount": 2900, "currency": "SAR",
        "metadata": {"user_id": "user-abc", "reference": "pro_plan"},
        "source": {"type": "creditcard", "token": "token_saved", "company": "visa",
                   "last_four": "4242", "month": "12", "year": "2030"},
    })
    from core import billing
    monkeypatch.setattr(billing, "start_subscription",
                        lambda uid, ref, pay: started.setdefault("args", (uid, ref)) or {"id": "sub-1"})

    r = env["client"].post("/api/v1/webhooks/moyasar",
                           json=envelope(id="evt_plan", data={"id": "pay_plan"}))
    assert r.status_code == 200
    assert r.json()["result"]["subscription"] == "started"
    assert started["args"] == ("user-abc", "pro_plan")
    assert env["grants"] == [("user-abc", 24)]
    assert env["admin"].store["payments"]["pay_plan"]["type"] == pricing.TYPE_SUBSCRIPTION_INITIAL


def test_a_plan_payment_with_no_saved_card_is_flagged_not_silently_accepted(env, monkeypatch):
    """The money is taken but nothing can ever renew it. That has to be
    visible rather than becoming a subscription that quietly lapses."""
    monkeypatch.setattr(payments.moyasar_client, "get_payment", lambda pid: {
        "id": "pay_plan2", "status": "paid", "amount": 2900, "currency": "SAR",
        "metadata": {"user_id": "user-abc", "reference": "pro_plan"},
        "source": {"type": "creditcard"},          # no token
    })
    r = env["client"].post("/api/v1/webhooks/moyasar",
                           json=envelope(id="evt_plan2", data={"id": "pay_plan2"}))
    assert r.status_code == 200
    assert r.json()["result"]["subscription"] == "start_failed"


def test_a_renewal_payment_reconciles_without_restarting_the_subscription(env, monkeypatch):
    """Moyasar sends the same payment_paid for a first payment and a renewal.
    Re-running activation on a renewal would reset the period and re-claim a
    founding-member slot."""
    env["admin"].store["subscriptions"] = {
        "sub-1": {"id": "sub-1", "user_id": "user-abc", "status": "active"}
    }
    monkeypatch.setattr(payments.moyasar_client, "get_payment", lambda pid: {
        "id": "pay_renew", "status": "paid", "amount": 2900, "currency": "SAR",
        "metadata": {"user_id": "user-abc", "reference": "pro_plan"},
        "source": {"token": "token_saved"},
    })
    r = env["client"].post("/api/v1/webhooks/moyasar",
                           json=envelope(id="evt_renew", data={"id": "pay_renew"}))
    assert r.status_code == 200
    assert r.json()["result"]["subscription"] == "renewed"


# ─── The idempotency key itself ─────────────────────────────────────────────


def test_top_level_id_is_the_key():
    assert payments._webhook_event_id(envelope()) == "evt_1"


def test_composite_key_when_the_envelope_has_no_id():
    """Never returns empty: two unrelated deliveries colliding on "" would
    make the second look like a duplicate and be silently dropped."""
    body = envelope(); body.pop("id")
    key = payments._webhook_event_id(body)
    assert key == "payment_paid:pay_wh_1:2026-09-02T10:00:00Z"
    assert key.strip()
