-- reset_credits_if_due() must not grant a paid tier's credits on a timestamp
-- alone.
--
-- ─── THE DEFECT ─────────────────────────────────────────────────────────────
--
-- reset_credits_if_due() decides entirely from profiles.credits_reset_at:
--
--     if v_reset_at is null or now() < v_reset_at then return; end if;
--     ... credits_remaining = <the tier's allowance> + purchased
--     ... credits_reset_at  = now() + interval '30 days'
--
-- Nothing in it looks at whether the month was PAID FOR. It reads a clock and
-- grants a month of Pro or Elite credits.
--
-- That was harmless while nothing could be bought. It is not harmless now:
--
--   · core/billing.py's dunning window runs D+0 to D+10 and deliberately
--     lets access continue while a card is retried. `_handle_failure` never
--     advances the billing period — "an unpaid month must stay due, or a card
--     that never works still buys a year."
--   · But reset_credits_if_due() advances ITS OWN clock, unconditionally,
--     every time it fires. So a Pro subscriber whose card has died gets a
--     full 24 credits the moment credits_reset_at passes, and the next reset
--     is pushed out another 30 days. Repeat, forever, for a subscription that
--     is not being paid.
--
-- There were two independent granting paths for the same allowance and only
-- one of them knew about money.
--
-- ─── THE FIX ────────────────────────────────────────────────────────────────
--
-- A PAID TIER'S CREDITS ARE THE SUBSCRIPTION'S TO APPLY, NOT THE CLOCK'S.
-- That is already the design everywhere else — core/payments.py's
-- record_and_grant() returns early for plans with exactly this comment, and
-- core/billing.py calls apply_monthly_allowance() on a SUCCESSFUL renewal and
-- nowhere else. This function was the one place that had not been told.
--
-- So: reset_credits_if_due() now grants only for the FREE tier, which has no
-- billing to verify and must keep refilling. For pro and elite it advances
-- nothing and grants nothing — apply_monthly_allowance() does that, when the
-- money arrives.
--
-- WHAT THIS DOES NOT CHANGE. Access during dunning is untouched: this is
-- about credits, not entitlement, and the grace window is enforced in
-- core/billing.py. A subscriber whose renewal succeeds is unaffected —
-- apply_monthly_allowance() has always been the path that fires for them, and
-- it moves credits_reset_at onto the new period end in the same statement.
--
-- The pending_tier branch is left alone: a scheduled plan change is applied
-- by the subscription flow when the new period is paid for, and that branch
-- adds to the balance rather than overwriting it.

CREATE OR REPLACE FUNCTION public.reset_credits_if_due(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_tier subscription_tier;
  v_pending_tier subscription_tier;
  v_reset_at timestamptz;
  v_remaining integer;
  v_purchased integer;
  v_new_total integer;
begin
  select tier, pending_tier, credits_reset_at, credits_remaining, purchased_credits
    into v_tier, v_pending_tier, v_reset_at, v_remaining, v_purchased
  from public.profiles where id = p_user_id;

  if v_reset_at is null or now() < v_reset_at then
    return;
  end if;

  if v_pending_tier is not null then
    v_new_total := case v_pending_tier
      when 'free' then 3
      when 'pro' then 24
      when 'elite' then 80
    end;

    update public.profiles
    set tier = v_pending_tier,
        pending_tier = null,
        credits_remaining = v_remaining + v_new_total,
        credits_total = v_new_total,
        subscription_status = case when v_pending_tier = 'free' then 'inactive' else subscription_status end,
        credits_reset_at = now() + interval '30 days',
        linkedin_essential_used = 0,
        interview_prep_used = 0,
        updated_at = now()
    where id = p_user_id;
    return;
  end if;

  -- ⚠️ THE GUARD. A paid tier's monthly credits are granted by
  -- apply_monthly_allowance() when a renewal is actually charged. Granting
  -- them here as well would be a second, money-blind path to the same
  -- allowance — which is precisely the defect. Return without touching
  -- credits_reset_at, so the renewal job's own clock stays authoritative.
  if v_tier <> 'free' then
    return;
  end if;

  -- Free only. There is no billing to verify, and the monthly refill is the
  -- whole free tier.
  v_new_total := 3;

  update public.profiles
  set credits_remaining = v_new_total + coalesce(v_purchased, 0),
      credits_total = v_new_total,
      credits_reset_at = now() + interval '30 days',
      linkedin_essential_used = 0,
      interview_prep_used = 0,
      updated_at = now()
  where id = p_user_id;
end;
$$;

COMMENT ON FUNCTION public.reset_credits_if_due(uuid) IS
  'Refills the FREE tier''s monthly credits. Paid tiers are granted by apply_monthly_allowance() on a charged renewal — see this migration''s header for why a timestamp alone must not grant a paid allowance.';
