-- Two things: a live bug in the tier-change trigger, and the clawback a
-- refund needs.
--
-- ─── BUG 1: sync_credits_on_tier_change() HAS THE WRONG NUMBERS ─────────────
--
-- It fires BEFORE UPDATE on profiles whenever tier changes, and sets:
--
--     free -> 5      pro -> 40      elite -> 120
--
-- The allowances this product actually sells and enforces are 3 / 24 / 80
-- (core/credits.py TIER_CREDITS, core/pricing.py, and the plan copy on the
-- pricing page). So the moment a subscription activates and sets tier='pro',
-- this hands out 40 credits instead of 24 — and Elite 120 instead of 80.
--
-- This is the same stale copy that already caused the site to advertise 40
-- credits for Pro once before. It has been harmless only because nothing
-- changed tier automatically; §5 made subscription activation and downgrade
-- routine, so it is now on the hot path.
--
-- ─── BUG 2: IT DESTROYS PURCHASED CREDITS ──────────────────────────────────
--
--     new.credits_remaining := v_total;      -- assignment, not addition
--
-- credits_remaining is the SPENDABLE TOTAL and includes anything bought as a
-- pack (see 20260901230500). Overwriting it on a tier change silently deletes
-- every purchased credit the user is holding — so subscribing, or being
-- downgraded for non-payment, would erase credits they paid real money for.
-- That is the exact bug the purchased-credits migration exists to prevent,
-- arriving through a different door.

CREATE OR REPLACE FUNCTION public.sync_credits_on_tier_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_total integer;
begin
  if new.tier is distinct from old.tier then
    -- Must match TIER_CREDITS in core/credits.py and the plan copy in
    -- frontend/src/lib/pricing.ts. backend/tests/test_pricing_parity.py
    -- asserts those two agree; this is the third copy and the reason the
    -- numbers are repeated here rather than derived is that a trigger cannot
    -- read application config.
    v_total := case new.tier
      when 'free'  then 3
      when 'pro'   then 24
      when 'elite' then 80
    end;

    new.credits_total := v_total;
    -- PLUS purchased, never instead of it. A tier change replaces the
    -- MONTHLY allowance; credits someone bought are not the tier's to take.
    new.credits_remaining := v_total + coalesce(new.purchased_credits, 0);
    new.credits_reset_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;


-- ─── CLAWBACK, for the admin refund path (§7) ───────────────────────────────
--
-- Takes back only what has NOT been spent. A refund is issued for a billing
-- error or a dispute, and the credits it paid for may already be gone — a
-- generated CV cannot be un-generated. Clamping to what remains is what makes
-- the balance non-negative without a second round trip to work out how much
-- is safe to remove.
--
-- Returns how many were ACTUALLY removed, which is what the payments row
-- records, so the difference between "refunded 30" and "clawed back 12" stays
-- visible instead of being inferred later.

CREATE OR REPLACE FUNCTION public.clawback_purchased_credits(
  p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_available integer;
  v_taken integer;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;

  select purchased_credits into v_available
  from public.profiles where id = p_user_id
  for update;

  if not found then
    return 0;
  end if;

  -- Only the unspent portion. If they have already used some of what the
  -- refunded payment bought, those are gone and are not taken from elsewhere.
  v_taken := least(p_amount, greatest(coalesce(v_available, 0), 0));
  if v_taken = 0 then
    return 0;
  end if;

  update public.profiles
  set purchased_credits = purchased_credits - v_taken,
      credits_remaining = greatest(credits_remaining - v_taken, 0),
      updated_at = now()
  where id = p_user_id;

  return v_taken;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.clawback_purchased_credits(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.clawback_purchased_credits(uuid, integer) TO service_role;
