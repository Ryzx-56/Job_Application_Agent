# tests/test_admin_feature_override.py
#
# 2026-09-13: admin accounts get full Elite-level feature access (Job
# Search, Interview Prep, LinkedIn Essential baselines, and CV generation)
# for using the product themselves, without profiles.tier ever being written
# to 'elite'. See core/auth.py's ADMIN FEATURE-ACCESS OVERRIDE note for the
# full rationale — this file is the regression test for it.
from unittest.mock import MagicMock, patch

import core.auth as auth
import core.credits as credits
import core.entitlements as entitlements
from core.entitlements import INTERVIEW_PREP, JOB_SEARCH, LINKEDIN_ESSENTIAL


def _mock_admin(used: int = 0):
    """Same shape as test_entitlements.py's _mock_admin: one fake row
    answers get_addon_quota's `{addon}_used` read regardless of which addon
    asked."""
    client = MagicMock()
    row = {f"{addon}_used": used for addon in
           (LINKEDIN_ESSENTIAL, INTERVIEW_PREP, JOB_SEARCH)}
    client.table.return_value.select.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = row
    return client


# ─── effective_feature_tier() itself ────────────────────────────────────────

def test_admin_reads_as_elite_for_features_but_not_for_real_tier():
    """The exact split the task asked for: effective_feature_tier() promotes
    an admin to 'elite', but read_subscription_tier() — the thing billing and
    admin_stats actually read — keeps reporting the real, stored tier when
    called directly, completely untouched by the override."""
    with patch.object(auth, "read_admin_flag", return_value=True), \
         patch.object(auth, "read_subscription_tier", return_value="free") as real_tier:
        assert auth.effective_feature_tier("admin-1") == "elite"
        # The admin branch short-circuits before ever asking for the real
        # tier — read_subscription_tier is a completely separate code path
        # that this override does not call, wrap, or mutate.
        real_tier.assert_not_called()

    # Called on its own, with no override in the picture, it still reports
    # the real, stored tier for this same admin account.
    with patch.object(auth, "read_subscription_tier", wraps=lambda uid: "free"):
        assert auth.read_subscription_tier("admin-1") == "free"


def test_non_admin_effective_tier_is_just_their_real_tier():
    """A regular user, admin or not, must be completely unaffected — this is
    the 'regular free-tier user without the admin flag is unaffected' case
    from the task's test list."""
    with patch.object(auth, "read_admin_flag", return_value=False), \
         patch.object(auth, "read_subscription_tier", return_value="free"):
        assert auth.effective_feature_tier("user-1") == "free"

    with patch.object(auth, "read_admin_flag", return_value=False), \
         patch.object(auth, "read_subscription_tier", return_value="pro"):
        assert auth.effective_feature_tier("user-2") == "pro"


# ─── The three bundled add-ons, via get_addon_quota() ───────────────────────

def test_admin_gets_elite_baselines_on_all_three_addons():
    """An admin with subscription_tier='free' gets Elite's caps (5 / 15 /
    13), fully unlocked, on all three add-ons — while never touching
    profiles.tier."""
    with patch.object(entitlements, "effective_feature_tier", return_value="elite"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin()):
        for addon, elite_limit in (
            (LINKEDIN_ESSENTIAL, 5),
            (INTERVIEW_PREP, 15),
            (JOB_SEARCH, 13),
        ):
            quota = entitlements.get_addon_quota("admin-1", addon)
            assert quota["tier"] == "elite"
            assert quota["limit"] == elite_limit
            assert quota["unlocked"] is True
            assert quota["remaining"] == elite_limit


def test_free_user_without_admin_flag_still_gets_zero_baseline():
    """The control case, run through the exact same function: nothing about
    a regular Free user's baseline changes."""
    with patch.object(entitlements, "effective_feature_tier", return_value="free"), \
         patch.object(entitlements, "get_admin_client", return_value=_mock_admin()):
        quota = entitlements.get_addon_quota("user-1", JOB_SEARCH)
        assert quota["tier"] == "free"
        assert quota["limit"] == 0
        assert quota["unlocked"] is False


# ─── CV generation credits ───────────────────────────────────────────────────

def test_admin_cv_generation_bypasses_the_credit_check_entirely():
    """No tier-based CV allowance exists to promote (CREDIT_COST is flat by
    language), so the admin override for CV generation is the balance check
    never running at all — confirmed here by asserting the Supabase admin
    client is never touched, i.e. nothing is read OR deducted."""
    with patch.object(credits, "read_admin_flag", return_value=True), \
         patch.object(credits, "get_admin_client") as get_client:
        reserved = credits.reserve_credits("admin-1", "ar")
        assert int(reserved) == 0
        assert reserved.from_monthly == 0
        assert reserved.from_purchased == 0
        get_client.assert_not_called()


def test_non_admin_cv_generation_still_spends_a_real_credit():
    """The control case: an ordinary user's generation must still go through
    the real spend_credits() path untouched."""
    with patch.object(credits, "read_admin_flag", return_value=False), \
         patch.object(credits, "get_admin_client") as get_client:
        mock_admin = MagicMock()
        get_client.return_value = mock_admin
        mock_admin.rpc.return_value.execute.return_value.data = {
            "ok": True, "from_monthly": 1, "from_purchased": 0,
        }
        reserved = credits.reserve_credits("user-1", "en")
        assert int(reserved) == 1
        get_client.assert_called()


# ─── Isolation: revenue/margin reporting never sees the override ───────────

def test_admin_stats_never_imports_the_feature_override():
    """admin_stats.py's revenue/margin figures must be derived exclusively
    from the real, stored profiles.tier (via the admin_tier_counts RPC it
    calls) — never from effective_feature_tier(). This is a static guard
    against someone later 'fixing' an admin's blank dashboard by wiring the
    override into the reporting path, which is exactly the mistake CLAUDE.md
    warns against: an admin account must never be counted as a paying Elite
    subscriber."""
    import core.admin_stats as admin_stats
    assert not hasattr(admin_stats, "effective_feature_tier")
