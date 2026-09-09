-- Job Search becomes a metered add-on, like LinkedIn Essential and Interview
-- Prep.
--
-- ─── WHY ────────────────────────────────────────────────────────────────────
--
-- Job Search was the only paid feature with no cap of any kind, and it is by
-- some distance the most expensive thing the product does: one standalone
-- search cost 72 Tavily credits typical and 144 worst case against a
-- 1,000-credit monthly quota shared by the ENTIRE PLATFORM. Cuts A-E bring
-- that to 24 typical / 36 worst case, which makes a cap affordable to grant
-- rather than a cap that has to be stingy.
--
-- Without one, a single Elite subscriber who only uses Job Search could spend
-- more than they pay — measured in the pre-launch log's Section 15 worst-case
-- table. That is not a scale problem; it is one subscriber, one month.
--
-- The machinery already exists (consume_addon_quota / release_addon_quota /
-- the `{addon}_used` column convention), and core/entitlements.py's own
-- comment says adding a third add-on is "a migration plus an entry here,
-- nothing else". This is that migration.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_search_used integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_job_search_used_nonneg CHECK (job_search_used >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;

COMMENT ON COLUMN public.profiles.job_search_used IS
  'Standalone Job Searches used this billing period. Reset alongside the other add-ons by reset_credits_if_due() and apply_monthly_allowance(). Capped per tier by ADDON_CAPS in core/entitlements.py.';


-- ─── The three functions learn about the new add-on ─────────────────────────
--
-- Rewritten rather than extended with a third IF branch: the branch chain was
-- already the part most likely to be got wrong when adding one, and a CASE on
-- a validated name says the same thing once.

CREATE OR REPLACE FUNCTION public.consume_addon_quota(p_user_id uuid, p_addon text, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_addon NOT IN ('linkedin_essential', 'interview_prep', 'job_search') THEN
    RAISE EXCEPTION 'Unknown add-on: %', p_addon;
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    RETURN FALSE;
  END IF;

  -- The conditional UPDATE is what makes this safe under concurrency: two
  -- simultaneous requests at the cap both fail the WHERE, and exactly one
  -- below it succeeds. Do not replace it with a SELECT-then-UPDATE.
  IF p_addon = 'linkedin_essential' THEN
    UPDATE public.profiles SET linkedin_essential_used = linkedin_essential_used + 1
    WHERE id = p_user_id AND linkedin_essential_used < p_limit;
  ELSIF p_addon = 'interview_prep' THEN
    UPDATE public.profiles SET interview_prep_used = interview_prep_used + 1
    WHERE id = p_user_id AND interview_prep_used < p_limit;
  ELSE
    UPDATE public.profiles SET job_search_used = job_search_used + 1
    WHERE id = p_user_id AND job_search_used < p_limit;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;


CREATE OR REPLACE FUNCTION public.release_addon_quota(p_user_id uuid, p_addon text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_addon NOT IN ('linkedin_essential', 'interview_prep', 'job_search') THEN
    RAISE EXCEPTION 'Unknown add-on: %', p_addon;
  END IF;

  IF p_addon = 'linkedin_essential' THEN
    UPDATE public.profiles
    SET linkedin_essential_used = GREATEST(linkedin_essential_used - 1, 0)
    WHERE id = p_user_id;
  ELSIF p_addon = 'interview_prep' THEN
    UPDATE public.profiles
    SET interview_prep_used = GREATEST(interview_prep_used - 1, 0)
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET job_search_used = GREATEST(job_search_used - 1, 0)
    WHERE id = p_user_id;
  END IF;
END;
$$;


-- ─── The monthly reset has to clear it too ──────────────────────────────────
--
-- Missing this is how a cap becomes permanent: job_search_used would climb to
-- the cap in month one and stay there forever, and the user would simply
-- never get another search. Both reset paths are updated — reset_credits_if_due
-- (free tier only, since 20260909190000) and apply_monthly_allowance (paid
-- tiers, on a charged renewal).

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
        job_search_used = 0,
        updated_at = now()
    where id = p_user_id;
    return;
  end if;

  -- A paid tier's monthly credits are granted by apply_monthly_allowance()
  -- when a renewal is actually charged — see 20260909190000 for why a
  -- timestamp alone must not grant a paid allowance.
  if v_tier <> 'free' then
    return;
  end if;

  v_new_total := 3;

  update public.profiles
  set credits_remaining = v_new_total + coalesce(v_purchased, 0),
      credits_total = v_new_total,
      credits_reset_at = now() + interval '30 days',
      linkedin_essential_used = 0,
      interview_prep_used = 0,
      job_search_used = 0,
      updated_at = now()
  where id = p_user_id;
end;
$$;


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
      -- Added with the job_search add-on. Without this line the cap would be
      -- reached once and never reset, and the feature would go permanently
      -- dark for every paying subscriber.
      job_search_used         = 0,
      updated_at = now()
  where id = p_user_id;

  return v_total;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_monthly_allowance(uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_monthly_allowance(uuid, timestamptz) TO service_role;
