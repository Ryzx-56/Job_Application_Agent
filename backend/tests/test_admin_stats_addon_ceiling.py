# tests/test_admin_stats_addon_ceiling.py
#
# Credit-addons prompt item 7, patched: recompute admin_stats.py's
# worst-case panel from the ACTUAL current figures (current Job Search
# allowance, current per-search cost post-Jadarat-override, current
# Interview Prep / LinkedIn Essential bundled costs) rather than the
# prompt's stale target numbers, and confirm the result clears the 65%
# margin floor from the last check.
import core.admin_stats as admin_stats


def test_cost_per_credit_reflects_arabic_now_being_the_worse_case():
    """Arabic dropped 2->1 credit (item 3), which FLIPS which language is
    more expensive per credit: 0.02345 SAR / 1 credit (0.02345) is now
    higher than English's 0.01332. + 0.02 headroom, rounded up to the next
    cent = 0.05, not the old 0.04."""
    assert admin_stats.COST_PER_CREDIT_SAR == 0.05


def test_job_search_purchases_are_credit_constrained_not_just_policy_capped():
    """Pro's policy purchase cap is 5, but 5 x 5 credits = 25 exceeds Pro's
    entire 24-credit monthly grant — so the worst case assumes only 4 are
    actually fundable from the subscription alone, not the full 5. Elite's
    100 credits comfortably fund its full 13-purchase cap."""
    pro = admin_stats._addon_worst_case_ceiling("pro")
    elite = admin_stats._addon_worst_case_ceiling("elite")

    assert pro["job_search_purchases_assumed"] == 4
    assert pro["cv_credits_remaining"] == 4  # 24 - 4*5

    assert elite["job_search_purchases_assumed"] == 13
    assert elite["cv_credits_remaining"] == 35  # 100 - 13*5


def test_free_has_no_addon_ceiling_beyond_its_own_cv_credits():
    free = admin_stats._addon_worst_case_ceiling("free")
    assert free["job_search_purchases_assumed"] == 0
    assert free["job_search_term_sar"] == 0.0
    assert free["interview_prep_term_sar"] == 0.0
    assert free["linkedin_essential_term_sar"] == 0.0
    assert free["cv_credits_remaining"] == 3


def test_pro_and_elite_margins_clear_the_65_percent_floor():
    """The last margin check's floor: 'if so, the allowance comes back down,
    not the floor.' Both clear it comfortably — this test is what would need
    to fail (and trigger that rollback conversation) if either constant that
    feeds the ceiling gets more expensive later."""
    pro = admin_stats._addon_worst_case_ceiling("pro")
    elite = admin_stats._addon_worst_case_ceiling("elite")

    pro_margin = admin_stats._margin_pct(29, pro["total_sar"])
    elite_margin = admin_stats._margin_pct(99, elite["total_sar"])

    assert pro["total_sar"] == 8.79
    assert elite["total_sar"] == 26.57
    assert pro_margin == 69.7
    assert elite_margin == 73.2
    assert pro_margin >= 65.0, f"Pro's worst-case margin ({pro_margin}%) fell below the 65% floor"
    assert elite_margin >= 65.0, f"Elite's worst-case margin ({elite_margin}%) fell below the 65% floor"


def test_bundled_addon_costs_are_folded_into_the_ceiling():
    """Item 7's other half: BUNDLED_ADDON_COSTS_SAR['interview_prep'] used
    to be defined but never summed anywhere, and Job Search didn't appear in
    admin_stats.py's worst-case accumulation at all. Both now feed
    _addon_worst_case_ceiling directly."""
    pro = admin_stats._addon_worst_case_ceiling("pro")
    # 5 (Pro's Interview Prep baseline) * 0.0355
    assert pro["interview_prep_term_sar"] == round(5 * 0.0355, 2)
    # 2 (Pro's LinkedIn Essential baseline) * 0.019
    assert pro["linkedin_essential_term_sar"] == round(2 * 0.019, 2)
    assert pro["job_search_term_sar"] > 0
