"""
The tier allowance lives in SIX places. Nothing was checking that the SQL
copies agree with the Python one.

test_pricing_parity.py guards backend Python against frontend TypeScript.
It does not read the database functions, and the database is where the
allowance is actually applied on signup, on tier change, and on renewal —
a trigger cannot import core.credits, so the numbers are retyped there.

THIS HAS ALREADY GONE WRONG. sync_credits_on_tier_change() sat at
5 / 40 / 120 while the product sold 3 / 24 / 80, which is how the site came
to advertise 40 credits for Pro. Migration 20260902180000 fixed the
function; this test is what stops the next copy from drifting.
"""
import re
from pathlib import Path

import pytest

from core.credits import TIER_CREDITS

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

# `case ... when 'free' then 3 when 'pro' then 24 when 'elite' then 80`
ALLOWANCE = re.compile(
    r"when\s+'free'\s+then\s+(\d+)\s*"
    r"when\s+'pro'\s+then\s+(\d+)\s*"
    r"when\s+'elite'\s+then\s+(\d+)",
    re.IGNORECASE,
)
FUNC = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)", re.IGNORECASE)


def _latest_definitions():
    """function name -> (migration filename, (free, pro, elite))

    Migrations are applied in filename order, so a later file redefining a
    function wins. Only the surviving definition has to be correct —
    historical migrations are history and must never be edited."""
    latest = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        # Split on function boundaries so a triple is attributed to the
        # function it sits inside.
        marks = [(m.start(), m.group(1)) for m in FUNC.finditer(sql)]
        for i, (start, name) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(sql)
            found = ALLOWANCE.search(sql[start:end])
            if found:
                latest[name] = (path.name, tuple(int(g) for g in found.groups()))
    return latest


def test_every_live_sql_function_uses_the_real_allowance():
    expected = (TIER_CREDITS["free"], TIER_CREDITS["pro"], TIER_CREDITS["elite"])
    definitions = _latest_definitions()
    assert definitions, "found no allowance tables in the migrations — has the pattern changed?"

    wrong = {
        name: (migration, nums)
        for name, (migration, nums) in definitions.items()
        if nums != expected
    }
    assert not wrong, (
        "SQL functions disagree with core.credits.TIER_CREDITS "
        f"{expected}: " + "; ".join(
            f"{name}() in {mig} says {nums}" for name, (mig, nums) in wrong.items()
        )
    )


def test_profiles_credit_defaults_match_the_free_tier():
    """The column default is a seventh copy, and it was the last piece of the
    old 5 / 40 / 120 set still in the schema."""
    free = TIER_CREDITS["free"]
    defaults = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        for col in ("credits_remaining", "credits_total"):
            for m in re.finditer(rf"{col}\s+integer\s+DEFAULT\s+(\d+)", sql, re.IGNORECASE):
                defaults.append((path.name, col, int(m.group(1))))
            for m in re.finditer(
                rf"alter\s+column\s+{col}\s+set\s+default\s+(\d+)", sql, re.IGNORECASE
            ):
                defaults.append((path.name, col, int(m.group(1))))

    assert defaults, "no credit column defaults found"
    # The last statement for each column is the one in force.
    for col in ("credits_remaining", "credits_total"):
        effective = [d for d in defaults if d[1] == col][-1]
        assert effective[2] == free, (
            f"{col} defaults to {effective[2]} (set in {effective[0]}) but the free "
            f"allowance is {free}"
        )
