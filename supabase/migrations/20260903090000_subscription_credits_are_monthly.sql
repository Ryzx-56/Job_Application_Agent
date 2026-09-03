-- Subscription credits are MONTHLY, not purchased.
--
-- ─── THE BUG ────────────────────────────────────────────────────────────────
--
-- record_and_grant() granted a product's credits through
-- grant_purchased_credits() for anything with a credits value — which
-- included the Pro and Elite plans. So a subscriber's monthly allowance was
-- being written into purchased_credits, the bucket that by definition never
-- expires and survives every reset.
--
-- Two consequences, both found by running a real sandbox subscription against
-- a real database rather than a fake:
--
--   1. DOUBLE GRANT on the first payment. Activating the subscription changes
--      profiles.tier, and sync_credits_on_tier_change() already sets the
--      allowance (24 for Pro, plus any purchased). record_and_grant then
--      added 24 more.
--   2. UNBOUNDED ACCUMULATION on renewal. Every month added another 24
--      non-expiring credits, so a Pro subscriber would hold 288 permanent
--      credits after a year instead of 24 that refresh.
--
-- The fix is in the application (a plan's credits are no longer granted as
-- purchased) plus this function, which is what a RENEWAL uses to refresh the
-- allowance. A renewal cannot lean on the tier-change trigger, because the
-- tier does not change when a subscription renews.

CREATE OR REPLACE FUNCTION public.apply_monthly_allowance(
  p_user_id uuid, p_period_end timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_tier subscription_tier;
  v_purchased integer;
  v_total integer;
begin
  select tier, purchased_credits into v_tier, v_purchased
  from public.profiles where id = p_user_id for update;

  if not found then
    return 0;
  end if;

  -- Must match TIER_CREDITS in core/credits.py, the plan copy in
  -- frontend/src/lib/pricing.ts, and sync_credits_on_tier_change().
  v_total := case v_tier
    when 'free'  then 3
    when 'pro'   then 24
    when 'elite' then 80
  end;

  -- REPLACES the monthly portion, ADDS BACK the purchased one. Monthly
  -- credits do not roll over — that is what makes them monthly — but credits
  -- someone bought are not the renewal's to reset.
  update public.profiles
  set credits_remaining = v_total + coalesce(v_purchased, 0),
      credits_total     = v_total,
      -- Kept on the same date as the billing period, so the two clocks
      -- cannot drift apart. See core/billing.py's header.
      credits_reset_at  = p_period_end,
      linkedin_essential_used = 0,
      interview_prep_used     = 0,
      updated_at = now()
  where id = p_user_id;

  return v_total;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_monthly_allowance(uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_monthly_allowance(uuid, timestamptz) TO service_role;
