"""
Payment recording, verification and credit granting (§3, and the idempotency
half of §8).

PURE UNIT TESTS. No Supabase, no Moyasar, no network — the admin client and
the credit grant are both faked, so these run anywhere and prove the LOGIC
rather than the plumbing. The thing under test is record_and_grant(), which
is the single function the callback route and the webhook both go through.

WHAT MATTERS HERE. A payment can be reported to us twice, by two different
paths, in either order, from two processes at once. Every one of those must
end with the credits granted EXACTLY ONCE. Most of this file is that claim,
written out as the orderings it actually has to survive.
"""
import pytest

from core import payments, pricing


# ─── Fakes ──────────────────────────────────────────────────────────────────


class FakeTable:
    """Just enough of supabase-py's builder to exercise the two calls
    record_and_grant() makes: an upsert on the unique payment id, and the
    conditional 'claim' update on credits_granted."""

    def __init__(self, store: dict, fail_upsert: bool = False):
        self.store = store
        self.fail_upsert = fail_upsert
        self._op = None
        self._payload = None
        self._filters = {}

    def upsert(self, payload, on_conflict=None):
        self._op, self._payload = "upsert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def eq(self, column, value):
        self._filters[column] = value
        return self

    def is_(self, column, value):
        self._filters[f"{column}__is"] = value
        return self

    def execute(self):
        if self._op == "upsert":
            if self.fail_upsert:
                raise RuntimeError("simulated database failure")
            key = self._payload["moyasar_payment_id"]
            existing = self.store.get(key, {})
            # An upsert must never clobber a grant that already happened.
            merged = {**existing, **self._payload}
            if "credits_granted" in existing:
                merged["credits_granted"] = existing["credits_granted"]
            self.store[key] = merged
            return type("R", (), {"data": [merged]})()

        # The claim: only applies where credits_granted IS NULL.
        key = self._filters.get("moyasar_payment_id")
        row = self.store.get(key)
        if row is None:
            return type("R", (), {"data": []})()
        if self._filters.get("credits_granted__is") == "null" and row.get("credits_granted") is not None:
            return type("R", (), {"data": []})()          # already claimed
        row.update(self._payload)
        return type("R", (), {"data": [row]})()


class FakeAdmin:
    def __init__(self, store, fail_upsert=False):
        self.store, self.fail_upsert = store, fail_upsert

    def table(self, _name):
        return FakeTable(self.store, self.fail_upsert)


@pytest.fixture
def env(monkeypatch):
    """A fresh payments table and a recorder for every credit grant."""
    store: dict = {}
    grants: list = []

    def fake_grant(user_id, amount, *, reason=""):
        grants.append({"user_id": user_id, "amount": amount, "reason": reason})

    monkeypatch.setattr(payments, "get_admin_client", lambda: FakeAdmin(store))
    monkeypatch.setattr(payments, "grant_credits", fake_grant)
    return {"store": store, "grants": grants}


def moyasar_payment(**overrides):
    """A paid Moyasar payment object for the Starter pack, as their API
    returns it. Overridable per test."""
    payment = {
        "id": "pay_test_123",
        "status": "paid",
        "amount": 900,                 # halalas — Starter pack
        "currency": "SAR",
        "metadata": {"user_id": "user-abc", "reference": "starter_pack"},
    }
    payment.update(overrides)
    return payment


# ─── The happy path ─────────────────────────────────────────────────────────


def test_paid_pack_grants_its_credits(env):
    result = payments.record_and_grant(moyasar_payment(), source="callback")

    assert result["ok"] and result["paid"]
    assert result["credits_granted"] == 5
    assert env["grants"] == [
        {"user_id": "user-abc", "amount": 5, "reason": "starter_pack (pay_test_123)"}
    ]
    row = env["store"]["pay_test_123"]
    assert row["status"] == "paid"
    assert row["amount"] == 900
    assert row["type"] == pricing.TYPE_CREDIT_PACK
    assert row["credits_granted"] == 5


# ─── §8: every ordering lands on one grant ──────────────────────────────────


def test_webhook_then_callback_grants_once(env):
    payments.record_and_grant(moyasar_payment(), source="webhook")
    second = payments.record_and_grant(moyasar_payment(), source="callback")

    assert len(env["grants"]) == 1
    assert second["already_processed"] is True
    assert env["store"]["pay_test_123"]["credits_granted"] == 5


def test_callback_then_webhook_grants_once(env):
    payments.record_and_grant(moyasar_payment(), source="callback")
    second = payments.record_and_grant(moyasar_payment(), source="webhook")

    assert len(env["grants"]) == 1
    assert second["already_processed"] is True


def test_same_webhook_delivered_twice_grants_once(env):
    payments.record_and_grant(moyasar_payment(), source="webhook")
    payments.record_and_grant(moyasar_payment(), source="webhook")
    payments.record_and_grant(moyasar_payment(), source="webhook")

    assert len(env["grants"]) == 1
    assert len(env["store"]) == 1


def test_pending_then_paid_grants_once_when_it_settles(env):
    """3DS: the first report is 'initiated', the real outcome arrives after."""
    first = payments.record_and_grant(moyasar_payment(status="initiated"), source="callback")
    assert first["paid"] is False
    assert env["grants"] == []
    assert env["store"]["pay_test_123"]["status"] == "initiated"

    second = payments.record_and_grant(moyasar_payment(status="paid"), source="webhook")
    assert second["paid"] is True
    assert len(env["grants"]) == 1
    assert env["store"]["pay_test_123"]["status"] == "paid"


# ─── Refusals: nothing is granted, and the attempt is still recorded ────────


@pytest.mark.parametrize("status", ["failed", "voided", "initiated", "authorized"])
def test_unpaid_statuses_grant_nothing(env, status):
    result = payments.record_and_grant(moyasar_payment(status=status), source="webhook")

    assert result["paid"] is False
    assert env["grants"] == []
    # Recorded anyway: "why did my payment not work" is unanswerable otherwise.
    assert env["store"]["pay_test_123"]["status"] == status


def test_underpayment_is_refused(env):
    """The §8 case: what Moyasar confirms must equal what the reference costs."""
    result = payments.record_and_grant(moyasar_payment(amount=1), source="webhook")

    assert result["ok"] is False
    assert result["code"] == "amount_mismatch"
    assert env["grants"] == []
    # The row stores what was ACTUALLY paid, so a refund can be worked out.
    assert env["store"]["pay_test_123"]["amount"] == 1


def test_overpayment_is_also_refused(env):
    result = payments.record_and_grant(moyasar_payment(amount=90000), source="webhook")
    assert result["code"] == "amount_mismatch"
    assert env["grants"] == []


def test_wrong_currency_is_refused(env):
    result = payments.record_and_grant(
        moyasar_payment(amount=900, currency="USD"), source="webhook")
    assert result["code"] == "amount_mismatch"
    assert env["grants"] == []


def test_unknown_reference_grants_nothing(env):
    result = payments.record_and_grant(
        moyasar_payment(metadata={"user_id": "user-abc", "reference": "free_everything"}),
        source="webhook")

    assert result["ok"] is False
    assert result["code"] == "unknown_reference"
    assert env["grants"] == []
    assert env["store"]["pay_test_123"]["reference"] == "free_everything"


def test_missing_user_id_grants_nothing(env):
    """Paid, for credits, with nobody to give them to. Must not guess."""
    result = payments.record_and_grant(
        moyasar_payment(metadata={"reference": "starter_pack"}), source="webhook")

    assert result["ok"] is False
    assert result["code"] == "no_user_id"
    assert env["grants"] == []


def test_payment_with_no_id_is_refused(env):
    result = payments.record_and_grant(moyasar_payment(id=""), source="webhook")
    assert result["code"] == "no_payment_id"
    assert env["store"] == {}


# ─── Products that grant no credits ─────────────────────────────────────────


def test_linkedin_addon_is_paid_but_grants_no_credits(env):
    result = payments.record_and_grant(
        moyasar_payment(amount=20000,
                        metadata={"user_id": "user-abc", "reference": "linkedin_premium"}),
        source="webhook")

    assert result["ok"] and result["paid"]
    assert result["credits_granted"] is None
    assert env["grants"] == []
    assert env["store"]["pay_test_123"]["type"] == pricing.TYPE_ADDON


# ─── A failed grant must not silently look successful ───────────────────────


def test_grant_failure_is_reported_not_swallowed(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("supabase down")

    monkeypatch.setattr(payments, "grant_credits", boom)
    result = payments.record_and_grant(moyasar_payment(), source="webhook")

    assert result["ok"] is False
    assert result["code"] == "grant_failed"
    # The claim stands, so a retry cannot double-grant. Recovery is manual and
    # the log line says so.
    assert env["store"]["pay_test_123"]["credits_granted"] == 5


def test_row_write_failure_does_not_crash_the_caller(monkeypatch):
    """A paid customer must still be served if the audit row can't be written."""
    store: dict = {}
    monkeypatch.setattr(payments, "get_admin_client",
                        lambda: FakeAdmin(store, fail_upsert=True))
    monkeypatch.setattr(payments, "grant_credits", lambda *a, **k: None)

    result = payments.record_and_grant(moyasar_payment(), source="webhook")
    assert result["ok"] is True


# ─── The price list itself ──────────────────────────────────────────────────


def test_catalog_matches_the_confirmed_price_list():
    """Guards the numbers in core/pricing.py against a careless edit. These
    are the figures confirmed with the site owner on 2026-09-01."""
    expected = {
        "pro_plan":         (2900, 24),
        "elite_plan":       (9900, 80),
        "starter_pack":     (900, 5),
        "best_value_pack":  (2200, 15),
        "power_pack":       (3800, 30),
        "linkedin_premium": (20000, None),
    }
    assert set(pricing.CATALOG) == set(expected)
    for reference, (halalas, credits) in expected.items():
        product = pricing.CATALOG[reference]
        assert product.amount_halalas == halalas, reference
        assert product.credits == credits, reference


def test_amounts_are_whole_halalas_matching_their_sar_figure():
    for product in pricing.CATALOG.values():
        assert isinstance(product.amount_halalas, int)
        assert product.amount_halalas == int(product.amount_sar * 100)


def test_free_is_not_purchasable():
    """Free must never reach Moyasar."""
    assert pricing.get_product("free") is None
    assert pricing.get_product("free_plan") is None
    assert pricing.expected_amount("nonsense") is None


def test_a_renewal_is_recorded_as_a_renewal_not_an_initial_payment(env):
    """pricing.Product.payment_type always answers subscription_initial for a
    plan — it has no way to know. The renewal job stamps subscription_id into
    the charge metadata, and that is what tells them apart.

    Without it every renewal filed as a signup, so the ledger could not
    separate new subscriptions from recurring revenue."""
    first = moyasar_payment(id="pay_first", amount=2900,
                            metadata={"user_id": "user-abc", "reference": "pro_plan"})
    renewal = moyasar_payment(id="pay_renew", amount=2900,
                              metadata={"user_id": "user-abc", "reference": "pro_plan",
                                        "subscription_id": "sub-1"})

    payments.record_and_grant(first, source="webhook")
    payments.record_and_grant(renewal, source="renewal")

    assert env["store"]["pay_first"]["type"] == pricing.TYPE_SUBSCRIPTION_INITIAL
    assert env["store"]["pay_renew"]["type"] == pricing.TYPE_SUBSCRIPTION_RENEWAL


def test_a_plan_payment_never_grants_purchased_credits(env):
    """A subscriber's monthly allowance must not land in the never-expiring
    bucket — that accumulated 24 permanent credits a month."""
    payments.record_and_grant(
        moyasar_payment(id="pay_plan", amount=2900,
                        metadata={"user_id": "user-abc", "reference": "pro_plan"}),
        source="webhook")
    assert env["grants"] == []
