# core/pricing.py
#
# THE PRICE LIST. One table, in halalas, that both the checkout and the
# server-side amount check read from.
#
# WHY THIS FILE EXISTS. Before it, the same figures were typed out in
# frontend/src/lib/pricing.ts (what the customer is shown), TIER_PRICING and
# PACK_PRICING in core/admin_stats.py (what revenue is projected from), and
# PRICING in core/linkedin.py (the add-on). Nothing charged money, so nothing
# had to agree. Once money moves, a price that appears in two places is a
# price that will eventually disagree with itself — and the disagreement shows
# up as a customer charged one number while the page promised another.
#
# HALALAS ARE THE UNIT, and they are the stored value rather than something
# derived at call time. Moyasar quotes and charges in halalas; SAR is derived
# for display. Storing 29.00 and multiplying by 100 at the point of charge is
# how a float rounding error becomes a wrong charge, so the integer is the
# source and the decimal is computed from it, never the reverse.
#
# ⚠️ THE AMOUNT A CUSTOMER PAYS IS NEVER TAKEN FROM THE CLIENT. The browser
# sends a `reference` slug; the server looks the amount up here and compares
# it to what Moyasar says was actually paid. A client that sends an amount is
# a client that can send `1`.
#
# CONSOLIDATION IS NOT FINISHED — §6 of the billing brief completes it.
# admin_stats.py and linkedin.py still hold their own copies. They agree with
# this table today (verified figure by figure when this file was written), and
# §6 is where they start importing from it instead.
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

# What `payments.type` a reference produces. Mirrors the CHECK constraint in
# supabase/migrations/20260901113509_moyasar_billing.sql — a value that isn't
# in that constraint will be rejected by the database, which is the intended
# safety net rather than a nuisance.
TYPE_CREDIT_PACK = "credit_pack"
TYPE_SUBSCRIPTION_INITIAL = "subscription_initial"
TYPE_SUBSCRIPTION_RENEWAL = "subscription_renewal"
TYPE_ADDON = "addon"

CURRENCY = "SAR"


@dataclass(frozen=True)
class Product:
    """One purchasable thing. Frozen: a price is not something a request
    handler should be able to edit on its way past."""

    reference: str
    kind: str                      # "plan" | "pack" | "addon"
    amount_halalas: int
    label_en: str
    label_ar: str
    # Credits this grants. None means credits are not what is being bought —
    # the LinkedIn add-on — which is different from 0.
    credits: Optional[int] = None
    # Set for plans only: the profiles.tier this subscribes the buyer to.
    tier: Optional[str] = None
    # Set for packs only: the key used by frontend PACKS and by
    # admin_stats.PACK_PRICING, so the three can be cross-checked in §6.
    pack_slug: Optional[str] = None

    @property
    def amount_sar(self) -> Decimal:
        """For display and for comparing against the legacy numeric(10,2)
        columns on linkedin_purchases. Decimal, never float."""
        return (Decimal(self.amount_halalas) / Decimal(100)).quantize(Decimal("0.01"))

    @property
    def payment_type(self) -> str:
        if self.kind == "pack":
            return TYPE_CREDIT_PACK
        if self.kind == "addon":
            return TYPE_ADDON
        return TYPE_SUBSCRIPTION_INITIAL


# ─── THE TABLE ──────────────────────────────────────────────────────────────
#
# Confirmed with the site owner 2026-09-01. Do not round, do not "tidy", do
# not retype from memory — every one of these has changed at least once.
#
#   Free              0 SAR        0 halalas    3 credits   (never billed)
#   Pro (monthly)    29 SAR     2900 halalas   24 credits
#   Elite (monthly)  99 SAR     9900 halalas   80 credits
#   Starter pack      9 SAR      900 halalas    5 credits
#   Best Value pack  22 SAR     2200 halalas   15 credits
#   Power pack       38 SAR     3800 halalas   30 credits
#   LinkedIn premium 200 SAR   20000 halalas    no credits
#
# LinkedIn "Essential" is deliberately absent. It is bundled into Pro and
# Elite and metered monthly (core/entitlements.py), so it has no price and no
# checkout. Only premium is sold.
#
# Free is absent too: it involves no payment and must never reach Moyasar.
# get_product("free_plan") returning None is the correct answer, not an
# oversight — see FREE_TIER_CREDITS below for the allowance itself.

CATALOG: dict[str, Product] = {
    "pro_plan": Product(
        reference="pro_plan",
        kind="plan",
        amount_halalas=2900,
        label_en="Pro plan — monthly",
        label_ar="اشتراك برو — شهري",
        credits=24,
        tier="pro",
    ),
    "elite_plan": Product(
        reference="elite_plan",
        kind="plan",
        amount_halalas=9900,
        label_en="Elite plan — monthly",
        label_ar="اشتراك إيليت — شهري",
        credits=80,
        tier="elite",
    ),
    "starter_pack": Product(
        reference="starter_pack",
        kind="pack",
        amount_halalas=900,
        label_en="Starter pack — 5 credits",
        label_ar="باقة البداية — 5 نقاط",
        credits=5,
        pack_slug="starter",
    ),
    "best_value_pack": Product(
        reference="best_value_pack",
        kind="pack",
        amount_halalas=2200,
        label_en="Best Value pack — 15 credits",
        label_ar="الباقة الأفضل قيمة — 15 نقطة",
        credits=15,
        pack_slug="best-value",
    ),
    "power_pack": Product(
        reference="power_pack",
        kind="pack",
        amount_halalas=3800,
        label_en="Power pack — 30 credits",
        label_ar="الباقة الاحترافية — 30 نقطة",
        credits=30,
        pack_slug="power",
    ),
    "linkedin_premium": Product(
        reference="linkedin_premium",
        kind="addon",
        amount_halalas=20000,
        label_en="LinkedIn profile — Premium",
        label_ar="ملف لينكدإن — بريميوم",
        credits=None,
        pack_slug=None,
    ),
}

# The free allowance. Here so the number has one home, but it is NOT in
# CATALOG: nothing about Free is purchasable and it must never produce a
# Moyasar payment. Mirrors TIER_CREDITS["free"] in core/credits.py.
FREE_TIER_CREDITS = 3


def get_product(reference: str) -> Optional[Product]:
    """The product for a reference slug, or None if it isn't one we sell.

    None is the security-relevant answer: a `reference` arrives from the
    browser (via Moyasar's payment metadata, which the buyer's own form
    populated), so an unrecognised one must refuse the payment rather than
    fall back to a default price.
    """
    if not reference:
        return None
    return CATALOG.get(str(reference).strip())


def expected_amount(reference: str) -> Optional[int]:
    """What this reference SHOULD have cost, in halalas. The number the
    verify step compares Moyasar's reported amount against."""
    product = get_product(reference)
    return product.amount_halalas if product else None


def plan_reference_for_tier(tier: str) -> Optional[str]:
    """'pro' -> 'pro_plan'. Used by the subscribe flow, which knows a tier."""
    for product in CATALOG.values():
        if product.kind == "plan" and product.tier == tier:
            return product.reference
    return None


def label_for(reference: str, lang: str = "en") -> str:
    """The payment description shown on the Moyasar form and on the buyer's
    card statement. Falls back to the reference itself so a description is
    never empty, which Moyasar rejects."""
    product = get_product(reference)
    if not product:
        return reference or "Tarshih"
    return product.label_ar if str(lang).lower().startswith("ar") else product.label_en


def public_catalog() -> list[dict]:
    """The price list, safe to serve to the browser so the checkout form and
    the pricing page read the same figures this module enforces."""
    return [
        {
            "reference": p.reference,
            "kind": p.kind,
            "amount_halalas": p.amount_halalas,
            "amount_sar": float(p.amount_sar),
            "currency": CURRENCY,
            "credits": p.credits,
            "tier": p.tier,
            "pack_slug": p.pack_slug,
            "label_en": p.label_en,
            "label_ar": p.label_ar,
        }
        for p in CATALOG.values()
    ]
