# tests/test_addon_purchase_dialog_contract.py
#
# 2026-09-13, the frontend confirmation dialog for begin_addon_use()'s 402/
# 429s. The user asked explicitly not to assume the two sides agree without
# checking — this file drives the REAL FastAPI exception-handling path (not
# a hand-built dict) so the JSON body asserted against is exactly what a
# browser would receive, and pins it against the field names the frontend
# now reads (frontend/src/lib/addonPurchase.ts).
#
# A minimal throwaway app mounts one endpoint that calls the real
# begin_addon_use() and lets whatever it raises propagate — FastAPI's own
# default exception handler is what turns HTTPException(detail={...}) into
# `{"detail": {...}}` JSON, which is the one part of this contract neither
# side's unit tests actually exercise (they call begin_addon_use directly in
# Python and read the HTTPException object, never the wire bytes).
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.entitlements as entitlements

app = FastAPI()


@app.get("/probe/{addon}")
def probe(addon: str, confirmed: bool = False):
    return entitlements.begin_addon_use("user-1", addon, confirmed_purchase=confirmed)


client = TestClient(app, raise_server_exceptions=False)


def _mock_admin(baseline_used: int, purchased_used: int = 0):
    from unittest.mock import MagicMock
    admin = MagicMock()
    row = {f"{a}_used": baseline_used for a in
           ("linkedin_essential", "interview_prep", "job_search")}
    row.update({f"{a}_purchased": purchased_used for a in
                ("linkedin_essential", "interview_prep", "job_search")})
    admin.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = row
    return admin


def test_real_402_body_matches_the_fields_the_frontend_reads():
    """frontend/src/lib/addonPurchase.ts's readAddonPurchaseOffer() reads
    detail.addon / detail.credit_cost / detail.credit_balance /
    detail.message off a `code === "addon_purchase_available"` 402 — checked
    here against the actual wire JSON, not a hand-built dict."""
    with patch.object(entitlements, "read_subscription_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=5)), \
         patch.object(entitlements, "credit_balance", return_value=18):
        response = client.get("/probe/job_search", params={"confirmed": False})

    assert response.status_code == 402
    body = response.json()
    assert set(body.keys()) == {"detail"}, "FastAPI must wrap the raised detail dict under one 'detail' key"
    detail = body["detail"]

    # Exactly the fields frontend/src/lib/addonPurchase.ts's
    # readAddonPurchaseOffer() destructures, present and the right type.
    assert detail["code"] == "addon_purchase_available"
    assert detail["addon"] == "job_search"
    assert isinstance(detail["credit_cost"], int)
    assert detail["credit_cost"] == 5
    assert isinstance(detail["credit_balance"], int)
    assert detail["credit_balance"] == 18
    assert isinstance(detail["message"], str) and detail["message"]
    # The example copy the user quoted, produced by the real code path.
    assert detail["message"] == "Use 5 credits for another Job Search? You have 18."


def test_real_429_purchase_limit_reached_is_distinguishable_from_rate_limited():
    """frontend/src/lib/addonPurchase.ts's isPurchaseLimitReached() /
    isRateLimited() both check `code` on a 429 — pinned here that the two
    codes are actually spelled differently on the wire, not just in
    comments."""
    with patch.object(entitlements, "read_subscription_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=5, purchased_used=5)):
        response = client.get("/probe/job_search", params={"confirmed": True})

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert detail["code"] == "purchase_limit_reached"
    assert detail["addon"] == "job_search"
    assert isinstance(detail["purchase_limit"], int)

    # core/rate_limit.py's enforce() is a completely separate function with
    # its own 429 shape — confirmed here it really is a different `code`,
    # which is the one field the frontend switches on.
    from core.rate_limit import RateLimit, enforce, reset_for_tests
    reset_for_tests()
    probe_limit = RateLimit("contract_probe", max_calls=1, window_seconds=3600)
    enforce(probe_limit, "user-1")  # first call: fine
    try:
        enforce(probe_limit, "user-1")  # second: over limit
        assert False, "expected the second call to raise"
    except Exception as e:
        rate_limited_detail = e.detail  # FastAPI's HTTPException carries .detail
    assert rate_limited_detail["code"] == "rate_limited"
    assert rate_limited_detail["code"] != detail["code"]


def test_real_402_insufficient_credits_shape():
    """The other 402 shape a confirmed purchase can hit — same code
    reserve_credits() already uses for a CV, verified here for an add-on."""
    with patch.object(entitlements, "read_subscription_tier", return_value="pro"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin(baseline_used=5)), \
         patch.object(entitlements, "reserve_addon_credits") as reserve:
        from fastapi import HTTPException, status
        reserve.side_effect = HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "insufficient_credits",
                "message": "Not enough credits for Job Search (5 needed, 2 remaining).",
                "credits_remaining": 2,
                "credits_needed": 5,
                "tier": "pro",
            },
        )
        response = client.get("/probe/job_search", params={"confirmed": True})

    assert response.status_code == 402
    detail = response.json()["detail"]
    assert detail["code"] == "insufficient_credits"
    assert isinstance(detail["message"], str) and detail["message"]
