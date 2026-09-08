"""
The frontend and backend price lists must agree.

There is no JavaScript test runner in this repo and adding one is not worth a
dependency, so the check lives here: this reads frontend/src/lib/pricing.ts as
TEXT and compares the numbers a customer is SHOWN against the numbers
backend/core/pricing.py will CHARGE and verify.

WHY THIS MATTERS MORE THAN IT LOOKS. The header of pricing.ts records what
already went wrong once: the site told visitors Pro included 40 credits when
it includes 24, and advertised LinkedIn Essential at 49 SAR a year after it
stopped being sold. Those were display-only bugs. Now that money moves, the
same drift means the page promises one price and the card is charged another.

A charge can never be wrong on its own: the checkout page renders and posts
the amount it fetched from /api/v1/payments/catalog, so the figure on the
payment form is the integer the server verifies. What this test protects is
everything ELSE — the pricing page, the upgrade page, the plan comparison —
which read pricing.ts directly.

WHY A TEST AND NOT DERIVATION. Every backend copy of these figures was
removed: core/admin_stats.py and core/linkedin.py build their tables from
core/pricing.py at import, so they cannot drift. pricing.ts is the one mirror
that has to stay — the pricing page is statically rendered, and fetching the
catalogue at runtime would put a spinner where the price goes whenever
Render's free tier has spun down. So it is checked instead, and every number
the file quotes is covered here: prices, credits, references, the USD peg,
per-language credit cost, and the add-on caps.
"""
import re
from decimal import Decimal
from pathlib import Path

import pytest

from core import pricing

PRICING_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "pricing.ts"


@pytest.fixture(scope="module")
def ts_source() -> str:
    if not PRICING_TS.exists():                     # pragma: no cover
        pytest.skip(f"{PRICING_TS} not found")
    return PRICING_TS.read_text(encoding="utf-8")


def _block(source: str, name: str) -> str:
    """The text between `export const NAME ... = {` and its closing brace.

    Anchored on the `=`, not on the declaration: these constants carry
    TypeScript type annotations that contain braces of their own
    (`Record<"pro" | "elite", { sar: number }> = {`), and starting from the
    first brace after the name parses the TYPE instead of the value.
    """
    start = source.index(f"export const {name}")
    assign = source.index("=", start)
    open_brace = source.index("{", assign)
    depth, i = 0, open_brace
    while i < len(source):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[open_brace : i + 1]
        i += 1
    raise AssertionError(f"unterminated block for {name}")   # pragma: no cover


def _flat_fields(block: str) -> dict[str, Decimal]:
    """`{ en: 1, ar: 2 }` -> {"en": 1, "ar": 2}

    DECIMAL, NOT INT. Every price is a whole number of riyals today, but the
    site is one pricing pass away from 29.99 — and an int parser reads that as
    29, then reports a mismatch against a backend charging 2999 halalas as if
    the backend were wrong. Decimal also compares equal to the ints these are
    checked against (`Decimal(2) == 2`), so credits and caps are unaffected.
    Never float: 29.99 * 100 is 2998.9999999999995 in IEEE 754.
    """
    return {k: Decimal(v) for k, v in re.findall(r"(\w+)\s*:\s*([\d.]+)", block)}


def _nested_entries(block: str) -> dict[str, dict[str, Decimal]]:
    """`pro: { linkedinEssential: 2 }` -> {"pro": {"linkedinEssential": 2}}"""
    return {
        key: _flat_fields(body)
        for key, body in re.findall(r'"?([\w-]+)"?\s*:\s*\{([^}]*)\}', block)
    }


def _entries(block: str) -> dict[str, dict[str, Decimal]]:
    """`starter: { sar: 9, credits: 5 }` -> {"starter": {"sar": 9, "credits": 5}}

    Priced entries only. The `sar` filter is what stops a type annotation's
    own braces being parsed as if they were a product."""
    return {k: v for k, v in _nested_entries(block).items() if "sar" in v}


def _string_map(block: str) -> dict[str, str]:
    """`pro: "pro_plan"` -> {"pro": "pro_plan"}"""
    return dict(re.findall(r'"?([\w-]+)"?\s*:\s*"([^"]+)"', block))


def test_tier_prices_and_credits_match(ts_source):
    tiers = _entries(_block(ts_source, "TIERS"))
    assert tiers, "couldn't parse TIERS out of pricing.ts"

    # Free is shown on the site but is not purchasable, so it has no CATALOG
    # entry — only its credit allowance is cross-checked.
    assert tiers["free"]["sar"] == 0
    assert tiers["free"]["credits"] == pricing.FREE_TIER_CREDITS

    for tier in ("pro", "elite"):
        reference = pricing.plan_reference_for_tier(tier)
        product = pricing.CATALOG[reference]
        assert tiers[tier]["sar"] * 100 == product.amount_halalas, (
            f"{tier}: site shows {tiers[tier]['sar']} SAR, backend charges "
            f"{product.amount_sar} SAR"
        )
        assert tiers[tier]["credits"] == product.credits, (
            f"{tier}: site promises {tiers[tier]['credits']} credits, backend grants "
            f"{product.credits}"
        )


def test_pack_prices_and_credits_match(ts_source):
    packs = _entries(_block(ts_source, "PACKS"))
    references = _string_map(_block(ts_source, "PACK_REFERENCE"))
    assert packs and references, "couldn't parse PACKS/PACK_REFERENCE out of pricing.ts"

    backend_packs = {p.pack_slug: p for p in pricing.CATALOG.values() if p.kind == "pack"}
    assert set(packs) == set(backend_packs), (
        f"site sells packs {sorted(packs)}, backend sells {sorted(backend_packs)}"
    )

    for slug, shown in packs.items():
        product = backend_packs[slug]
        # The slug the site uses must resolve to the reference the backend
        # prices by, or checkout would send an unknown reference.
        assert references[slug] == product.reference
        assert shown["sar"] * 100 == product.amount_halalas, (
            f"{slug}: site shows {shown['sar']} SAR, backend charges {product.amount_sar} SAR"
        )
        assert shown["credits"] == product.credits, (
            f"{slug}: site promises {shown['credits']} credits, backend grants {product.credits}"
        )


def test_plan_references_match(ts_source):
    references = _string_map(_block(ts_source, "PLAN_REFERENCE"))
    for tier, reference in references.items():
        assert reference in pricing.CATALOG, (
            f"pricing.ts points {tier} at {reference!r}, which the backend does not sell"
        )
        assert pricing.CATALOG[reference].tier == tier


def test_linkedin_premium_price_matches(ts_source):
    match = re.search(r"export const LINKEDIN_PREMIUM_SAR\s*=\s*(\d+)", ts_source)
    assert match, "couldn't find LINKEDIN_PREMIUM_SAR in pricing.ts"

    reference = re.search(r'export const LINKEDIN_PREMIUM_REFERENCE\s*=\s*"([^"]+)"', ts_source)
    assert reference, "couldn't find LINKEDIN_PREMIUM_REFERENCE in pricing.ts"

    product = pricing.CATALOG[reference.group(1)]
    assert int(match.group(1)) * 100 == product.amount_halalas
    # It buys a service, not credits. Promising credits for it would be wrong
    # in the opposite direction from a price mismatch, and just as bad.
    assert product.credits is None


def test_backend_credit_allowances_match_credits_module():
    """core/credits.py TIER_CREDITS is what the app enforces; the catalog is
    what the buyer is sold. They have to be the same numbers."""
    from core.credits import TIER_CREDITS

    assert TIER_CREDITS["free"] == pricing.FREE_TIER_CREDITS
    for tier in ("pro", "elite"):
        product = pricing.CATALOG[pricing.plan_reference_for_tier(tier)]
        assert TIER_CREDITS[tier] == product.credits, (
            f"{tier}: credits.py grants {TIER_CREDITS[tier]}, catalog sells {product.credits}"
        )


def test_the_parser_survives_a_fractional_price():
    """A guard against this test file's own blind spot.

    Every price is a whole number of riyals today, so an int parser passes
    every assertion above — and would keep passing right up until a price
    becomes 29.99, at which point it reads 29 and reports the BACKEND as
    wrong. The pricing pass that first puts halalas in a price should not
    have to debug its own safety net to find out it was fine."""
    parsed = _entries("{ pro: { sar: 29.99, credits: 24 } }")
    assert parsed["pro"]["sar"] == Decimal("29.99")
    assert parsed["pro"]["sar"] * 100 == 2999, "a fractional price must survive as halalas"
    assert parsed["pro"]["credits"] == 24


def test_usd_peg_matches(ts_source):
    """The dollar reference line under each price.

    Not money that changes hands, but the two surfaces divide by it
    independently, so a peg that differs makes the pricing page and the admin
    dashboard quote different dollar figures for the same riyal price."""
    match = re.search(r"export const SAR_PER_USD\s*=\s*([\d.]+)", ts_source)
    assert match, "couldn't find SAR_PER_USD in pricing.ts"
    assert float(match.group(1)) == pricing.SAR_PER_USD, (
        f"site converts at {match.group(1)}, backend at {pricing.SAR_PER_USD}"
    )


def test_credit_cost_per_language_matches(ts_source):
    """What one generation SPENDS, as opposed to what a credit costs to buy.

    An Arabic CV costs more credits than an English one, and every piece of
    copy about the free allowance depends on that number being right — quote
    it wrong and the site promises more free Arabic CVs than the app allows."""
    from core.credits import CREDIT_COST

    shown = _flat_fields(_block(ts_source, "CREDIT_COST"))
    assert shown, "couldn't parse CREDIT_COST out of pricing.ts"
    assert shown == CREDIT_COST, (
        f"site says a generation costs {shown}, credits.py charges {CREDIT_COST}"
    )


def test_addon_caps_match(ts_source):
    """The monthly LinkedIn Essential / Interview Prep allowances.

    These are quoted on the pricing page as part of what a plan includes, and
    enforced per generation by core/entitlements.py."""
    from core.entitlements import ADDON_CAPS, INTERVIEW_PREP, LINKEDIN_ESSENTIAL

    # camelCase on the site, snake_case in the SQL column the backend
    # increments. Same allowance, two naming conventions.
    field_for = {"linkedinEssential": LINKEDIN_ESSENTIAL, "interviewPrep": INTERVIEW_PREP}

    shown = _nested_entries(_block(ts_source, "ADDON_CAPS"))
    assert shown, "couldn't parse ADDON_CAPS out of pricing.ts"

    for tier, caps in shown.items():
        for ts_field, backend_field in field_for.items():
            assert caps[ts_field] == ADDON_CAPS[tier][backend_field], (
                f"{tier}.{ts_field}: site promises {caps[ts_field]} per month, "
                f"entitlements.py allows {ADDON_CAPS[tier][backend_field]}"
            )

    # Free is deliberately absent from the site's table because it gets none of
    # either. That is only correct while the backend agrees.
    assert set(shown) == {"pro", "elite"}, f"site lists caps for {sorted(shown)}"
    assert all(v == 0 for v in ADDON_CAPS["free"].values()), (
        "Free now has a non-zero add-on cap, so pricing.ts can no longer omit it"
    )
