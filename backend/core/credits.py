# core/credits.py
#
# Server-side credit enforcement. This is the ONLY place credits get
# checked or changed — the frontend only ever *reads* a user's balance
# (via Supabase RLS, see lib/supabase/credits.ts). Writes happen exclusively
# through this module, using the Supabase service_role key, which bypasses
# Row Level Security. That key must NEVER be sent to the browser — it only
# lives in this backend's environment.
import os
from functools import lru_cache

from fastapi import HTTPException, status
from loguru import logger
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Credit cost per generation, by output CV language. Must stay in sync with
# the copy shown in CreditsButton.tsx and the helper text under the EN/AR
# toggle on the generate page.
CREDIT_COST = {"en": 1, "ar": 2}

# THERE ARE TWO KINDS OF CREDIT, and the difference is what someone paid.
#
#   MONTHLY    granted by the tier. Replaced — not topped up — every cycle by
#              reset_credits_if_due(). Does not roll over.
#   PURCHASED  bought with money (a credit pack). Never expires, never reset.
#
# `profiles.credits_remaining` is the SPENDABLE TOTAL of both, so every reader
# in the app and the frontend keeps working without knowing any of this.
# `profiles.purchased_credits` records how much of that total is the
# non-expiring kind. Spending takes from the monthly portion first, because it
# is the one with an expiry date.

# Monthly credit allotment per tier. Must stay in sync with THREE places:
#   1. reset_credits_if_due() in the SQL migration (001_profiles_credits.sql),
#      which is what actually grants them each cycle.
#   2. The `features` copy on each plan in frontend/src/lib/language.tsx,
#      which is what the customer was sold.
#   3. TIER_PRICING in core/admin_stats.py, which prices the worst case.
#
# ⚠️ CHANGING A NUMBER HERE IS NOT ENOUGH. This dict is what the application
# reasons about, but reset_credits_if_due() in Postgres is what tops accounts
# up, so a change here without the matching migration means the page promises
# one figure and the database grants another.
TIER_CREDITS = {"free": 3, "pro": 24, "elite": 80}


@lru_cache(maxsize=1)
def get_admin_client() -> Client:
    """
    Cached Supabase client authenticated with the service_role key.
    This bypasses RLS entirely — only ever call this from trusted backend
    code, never expose anything derived from it to a client response
    beyond the specific fields you mean to return.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. "
            "Get the service_role key from Supabase Dashboard → Settings → API "
            "— NOT the anon key, and NEVER put it in a NEXT_PUBLIC_ env var."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def normalize_cv_language(cv_language: str) -> str:
    return "ar" if str(cv_language).lower().startswith("ar") else "en"


class ReservedCredits(int):
    """
    How many credits were taken, AND which of the two balances they came out
    of. See core/credits.py's header note on the two kinds of credit.

    An int subclass rather than a tuple or dataclass so that every existing
    `reserved_amount = reserve_credits(...)` call site keeps working
    untouched — it still IS the number, it just carries the breakdown along
    with it so refund_credits() can put each kind back where it belongs.
    """

    from_monthly: int = 0
    from_purchased: int = 0

    def __new__(cls, total: int, from_monthly: int, from_purchased: int) -> "ReservedCredits":
        self = super().__new__(cls, total)
        self.from_monthly = from_monthly
        self.from_purchased = from_purchased
        return self


def reserve_credits(user_id: str, cv_language: str) -> ReservedCredits:
    """
    Call this BEFORE running the generation pipeline. Atomically checks AND
    deducts credits in one step (via the spend_credits() Postgres function),
    so two parallel requests can't both pass a check before either one
    deducts. Raises 402 if the balance is insufficient.

    Returns the credit amount reserved — pass this to refund_credits() if
    the pipeline fails afterward, since a failed generation should never
    cost the user. The returned value is an int, but it also remembers
    whether the credits came from the monthly allowance or from a bought
    pack, so a refund can restore the right one.

    MONTHLY CREDITS ARE SPENT FIRST, decided in spend_credits(): the monthly
    allowance expires at the next reset and purchased credits never do, so
    spending the perishable one first is the only order that can't destroy
    something the user paid for.
    """
    lang = normalize_cv_language(cv_language)
    cost = CREDIT_COST[lang]
    admin = get_admin_client()

    # Lazy monthly reset: cheap no-op if not due yet, refreshes the balance
    # if it is. Avoids needing a cron job for now.
    admin.rpc("reset_credits_if_due", {"p_user_id": user_id}).execute()

    outcome = _spend(admin, user_id, cost)
    reserved = bool(outcome.get("ok"))

    if not reserved:
        # BUG FIX: .single() raises an exception (instead of returning a
        # None/empty result) when the query matches zero rows — e.g. a user
        # whose signup partially failed and never got a profile row. That
        # made this code's intended "no profile" handling unreachable; a
        # missing profile crashed with an unhandled 500 instead of the
        # clear message below. .maybe_single() returns None for zero rows
        # like this code already assumed.
        profile = (
            admin.table("profiles")
            .select("credits_remaining, tier")
            .eq("id", user_id)
            .maybe_single()
            .execute()
            .data
        )
        remaining = profile["credits_remaining"] if profile else 0
        tier = profile["tier"] if profile else "free"
        logger.info(f"🚫 Credit check failed — user {user_id} ({tier}) has {remaining}, needs {cost}.")
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "insufficient_credits",
                "message": (
                    f"Not enough credits for a {'n Arabic' if lang == 'ar' else 'n English'} CV "
                    f"({cost} credit{'s' if cost > 1 else ''} needed, {remaining} remaining)."
                ),
                "credits_remaining": remaining,
                "credits_needed": cost,
                "tier": tier,
            },
        )

    from_monthly = int(outcome.get("from_monthly") or 0)
    from_purchased = int(outcome.get("from_purchased") or 0)
    logger.info(
        f"✅ Reserved {cost} credit(s) for user {user_id} ({lang} CV) — "
        f"{from_monthly} monthly, {from_purchased} purchased."
    )
    return ReservedCredits(cost, from_monthly, from_purchased)


def _spend(admin, user_id: str, cost: int) -> dict:
    """
    Deduct `cost`, returning {"ok", "from_monthly", "from_purchased"}.

    FALLS BACK TO THE OLD FUNCTION IF THE NEW ONE ISN'T DEPLOYED YET.
    The backend (Render) and the database migrations (GitHub Actions) deploy
    independently and can fail independently — a migration run that fails
    leaves new application code talking to an old schema, and spend_credits()
    not existing would 500 every single CV generation. Credit spending is the
    hot path of the entire product; it does not get to depend on two
    deployments having landed in the right order.

    reserve_credits() is the previous function, still present and still
    correct (see 20260901230500_purchased_credits_survive_reset.sql, which
    redefines rather than drops it). On the old schema it simply has no
    purchased-credit bucket to split across, so the whole cost is reported as
    monthly — which is exactly right when the column does not exist yet.

    Only a "function not found" is caught. A real failure inside
    spend_credits still raises, because silently falling back on a genuine
    error would hide a bug and mis-report the split.
    """
    try:
        result = admin.rpc("spend_credits", {"p_user_id": user_id, "p_amount": cost}).execute()
        data = result.data if isinstance(result.data, dict) else {}
        if data:
            return data
        # A dict is always returned by the real function; anything else means
        # something is wrong with the call rather than with the balance.
        raise RuntimeError(f"spend_credits returned {result.data!r}")
    except Exception as err:
        if not _is_missing_function(err, "spend_credits"):
            raise
        logger.warning(
            "⚠️ spend_credits() is not in the database — falling back to reserve_credits(). "
            "The purchased-credits migration has not been applied to this environment "
            "(supabase/migrations/20260901230500_purchased_credits_survive_reset.sql). "
            "Credits still work; the monthly/purchased split is not tracked until it lands."
        )
        ok = bool(admin.rpc("reserve_credits", {"p_user_id": user_id, "p_amount": cost}).execute().data)
        return {"ok": ok, "from_monthly": cost if ok else 0, "from_purchased": 0}


def _is_missing_function(err: Exception, name: str) -> bool:
    """PostgREST answers PGRST202 for an RPC it cannot find. Matched on the
    text too, since the exception type differs across supabase-py versions."""
    text = f"{getattr(err, 'code', '')} {err}".lower()
    return "pgrst202" in text or ("could not find" in text and name.lower() in text)


def refund_credits(user_id: str, amount: int) -> None:
    """
    Call this if the pipeline raises AFTER reserve_credits() succeeded.

    Pass the value reserve_credits() returned, not a bare number: it knows
    which balance each credit came out of, and each kind goes back where it
    came from. Returning a purchased credit into the monthly allowance would
    silently convert something the user paid for into something that expires
    at the next reset.

    A bare int still works — every credit is assumed monthly, which is the
    safe direction (it can under-restore the non-expiring balance, never
    invent one).
    """
    if isinstance(amount, ReservedCredits):
        from_monthly, from_purchased = amount.from_monthly, amount.from_purchased
    else:
        from_monthly, from_purchased = int(amount), 0

    try:
        try:
            get_admin_client().rpc(
                "restore_credits",
                {
                    "p_user_id": user_id,
                    "p_from_monthly": from_monthly,
                    "p_from_purchased": from_purchased,
                },
            ).execute()
        except Exception as err:
            if not _is_missing_function(err, "restore_credits"):
                raise
            # Same deploy-skew fallback as _spend(). The old function only
            # takes a total, which is correct on the old schema.
            get_admin_client().rpc(
                "refund_credits",
                {"p_user_id": user_id, "p_amount": from_monthly + from_purchased},
            ).execute()
        logger.info(
            f"↩️ Refunded {from_monthly + from_purchased} credit(s) to user {user_id} "
            f"after a failed generation ({from_monthly} monthly, {from_purchased} purchased)."
        )
    except Exception as err:
        # Don't let a refund failure mask the original pipeline error —
        # log loudly so you can manually fix the balance if this ever fires.
        logger.error(f"❌ Failed to refund {int(amount)} credit(s) to user {user_id}: {err}")


def grant_credits(user_id: str, amount: int, *, reason: str = "") -> None:
    """
    ADD credits to a user because they bought them. Called from
    core/payments.py once a Moyasar payment is confirmed paid.

    Goes through grant_purchased_credits(), which adds to the spendable
    balance AND records the credits as the non-expiring kind in one
    statement. That second half is the whole point: reset_credits_if_due()
    REPLACES the monthly allowance every cycle, so a credit that isn't
    marked as purchased is erased at the next reset. A pack bought on day 29
    used to vanish on day 30, with the money kept — see
    supabase/migrations/20260901230500_purchased_credits_survive_reset.sql.

    RAISES on failure, unlike refund_credits() which swallows. The caller has
    already taken the customer's money, so a silent failure here is a customer
    who paid and got nothing — core/payments.py catches it and logs everything
    needed to fix the balance by hand.
    """
    if amount <= 0:
        raise ValueError(f"grant_credits needs a positive amount, got {amount}.")

    try:
        get_admin_client().rpc(
            "grant_purchased_credits", {"p_user_id": user_id, "p_amount": amount}
        ).execute()
    except Exception as err:
        if not _is_missing_function(err, "grant_purchased_credits"):
            raise
        # DELIBERATELY NOT silent: on the old schema these credits will be
        # wiped by the next monthly reset, which is the exact bug the
        # migration fixes. The customer still gets what they paid for now,
        # and the log says loudly that the migration is overdue.
        logger.error(
            f"🚨 grant_purchased_credits() is not in the database — granting {amount} credit(s) "
            f"to {user_id} as ORDINARY credits instead. They will be erased at this user's next "
            "monthly reset. Apply 20260901230500_purchased_credits_survive_reset.sql."
        )
        get_admin_client().rpc(
            "refund_credits", {"p_user_id": user_id, "p_amount": amount}
        ).execute()
    logger.info(
        f"🎁 Granted {amount} credit(s) to user {user_id}"
        + (f" for {reason}." if reason else ".")
    )


def get_credits(user_id: str) -> dict:
    """Used by a small /api/v1/credits GET endpoint (see main.py) so the
    frontend has a live source of truth beyond direct Supabase reads."""
    admin = get_admin_client()
    admin.rpc("reset_credits_if_due", {"p_user_id": user_id}).execute()
    # BUG FIX: same .single() -> .maybe_single() issue as above — a missing
    # profile row previously crashed with an unhandled 500 instead of
    # reaching the "if not profile" 404 handling right below.
    profile = (
        admin.table("profiles")
        .select("tier, credits_remaining, credits_total, pending_tier, credits_reset_at")
        .eq("id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return profile
