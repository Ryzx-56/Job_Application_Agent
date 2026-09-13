-- Credit-purchasable add-ons, the unified Job Search pool, and Elite's
-- credit bump — prompts/claude-code-prompt-credit-addons.md, run 2026-09-12
-- with two patches (Job Search's baseline is 5/13, not the file's stale
-- 4/12, and Elite goes to 100 credits).
--
-- ─── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- 1. THREE NEW COUNTER COLUMNS — one per add-on, tracking PURCHASES MADE
--    WITH CREDITS this billing cycle, separate from `{addon}_used`
--    (baseline consumed, already exists since 20260909200000). Item 6's
--    "track baseline consumed, purchases made, and credits spent —
--    separately, per add-on": credits spent is `purchased * the addon's
--    ADDON_CREDIT_COSTS entry` (core/pricing.py) at read time, not stored —
--    the cost is a single constant for the whole cycle in practice, so a
--    second stored number would only be a second place for it to drift from
--    the first.
--
-- 2. consume_addon_purchase / release_addon_purchase — the same atomic
--    check-and-increment shape as consume_addon_quota / release_addon_quota
--    (20260909200000), but for the purchases counter. p_limit is NULLABLE:
--    NULL means uncapped (LinkedIn Essential, Interview Prep — buy as many
--    as credits allow) and an integer means capped (Job Search only, at the
--    SAME number as its baseline — core/entitlements.py's
--    PURCHASE_CAPPED_ADDONS).
--
-- 3. Elite 80 -> 100 credits, baked into reset_credits_if_due() and
--    apply_monthly_allowance() the same way 20260909200000 folded in
--    job_search_used — both functions are rewritten rather than patched in
--    place, so there is exactly one version of "what a reset grants" to
--    read.
--
-- ─── WHAT THIS DOES NOT NEED TO ADD ─────────────────────────────────────────
--
-- The unified Job Search pool (item 4) needs NO schema change: the
-- standalone page and the per-CV find-jobs button already share
-- `job_search_used` and `ADDON_CAPS[...]['job_search']` — the standalone
-- page just never called consume_addon_quota before today. Unifying them is
-- an application-code change (core/job_search.py now calls
-- entitlements.begin_addon_use(JOB_SEARCH) exactly like core/documents.py's
-- find_jobs_for_resume does), not a new column or a new cap.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS linkedin_essential_purchased integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interview_prep_purchased integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS job_search_purchased integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_linkedin_essential_purchased_nonneg CHECK (linkedin_essential_purchased >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_interview_prep_purchased_nonneg CHECK (interview_prep_purchased >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_job_search_purchased_nonneg CHECK (job_search_purchased >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.profiles.job_search_used IS
  'Job Search uses drawn from the monthly BASELINE this billing period — shared by BOTH entry points (the standalone page and the per-CV find-jobs button) as of 2026-09-12. Reset alongside the other add-ons. Capped per tier by ADDON_CAPS in core/entitlements.py.';
COMMENT ON COLUMN public.profiles.linkedin_essential_purchased IS
  'LinkedIn Essential generations bought with credits this billing period, once the monthly baseline ran out. Uncapped beyond the credits themselves. Reset alongside the baseline counters.';
COMMENT ON COLUMN public.profiles.interview_prep_purchased IS
  'Interview Preps bought with credits this billing period, once the monthly baseline ran out. Uncapped beyond the credits themselves. Reset alongside the baseline counters.';
COMMENT ON COLUMN public.profiles.job_search_purchased IS
  'Job Searches bought with credits this billing period, once the monthly baseline ran out. CAPPED at the same number as the baseline (core/entitlements.py PURCHASE_CAPPED_ADDONS) — at most double your monthly searches by paying for the second half. Reset alongside the baseline counters.';


-- ─── Atomic purchase counter, mirroring consume_addon_quota exactly ────────

CREATE OR REPLACE FUNCTION public.consume_addon_purchase(p_user_id uuid, p_addon text, p_limit integer)
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

  -- p_limit IS NULL means uncapped: always succeeds, just increments, same
  -- as consume_addon_quota's p_limit <= 0 short-circuit but the other way
  -- around (there, no limit means "never allowed"; here, no limit means
  -- "always allowed" — a purchase with credits already paid for itself,
  -- there is nothing to refuse it FOR beyond an explicit cap like Job
  -- Search's).
  IF p_addon = 'linkedin_essential' THEN
    UPDATE public.profiles SET linkedin_essential_purchased = linkedin_essential_purchased + 1
    WHERE id = p_user_id AND (p_limit IS NULL OR linkedin_essential_purchased < p_limit);
  ELSIF p_addon = 'interview_prep' THEN
    UPDATE public.profiles SET interview_prep_purchased = interview_prep_purchased + 1
    WHERE id = p_user_id AND (p_limit IS NULL OR interview_prep_purchased < p_limit);
  ELSE
    UPDATE public.profiles SET job_search_purchased = job_search_purchased + 1
    WHERE id = p_user_id AND (p_limit IS NULL OR job_search_purchased < p_limit);
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;


CREATE OR REPLACE FUNCTION public.release_addon_purchase(p_user_id uuid, p_addon text)
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
    SET linkedin_essential_purchased = GREATEST(linkedin_essential_purchased - 1, 0)
    WHERE id = p_user_id;
  ELSIF p_addon = 'interview_prep' THEN
    UPDATE public.profiles
    SET interview_prep_purchased = GREATEST(interview_prep_purchased - 1, 0)
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET job_search_purchased = GREATEST(job_search_purchased - 1, 0)
    WHERE id = p_user_id;
  END IF;
END;
$$;


-- ─── Elite 80 -> 100 credits, and the new counters zeroed on reset ─────────
--
-- Rewritten in full (same approach 20260909200000 took adding job_search_used)
-- rather than patched in place, so there is exactly one version of "what a
-- reset grants" to read rather than a diff to mentally apply on top of an
-- earlier migration.

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
      when 'elite' then 100  -- 2026-09-12: was 80. See core/credits.py TIER_CREDITS.
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
        linkedin_essential_purchased = 0,
        interview_prep_purchased = 0,
        job_search_purchased = 0,
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
      linkedin_essential_purchased = 0,
      interview_prep_purchased = 0,
      job_search_purchased = 0,
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
    when 'elite' then 100  -- 2026-09-12: was 80. 99/80 (1.238 SAR/credit) was
                           -- worse than Pro's 29/24 (1.208) — the larger tier
                           -- must have the better rate. 99/100 = 0.99 SAR/credit.
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
      job_search_used         = 0,
      -- Purchases-made counters reset with everything else — item 6:
      -- "reset on the same boundary ADDON_CAPS already uses". Pack CREDITS
      -- themselves (purchased_credits, added back above) never expire or
      -- reset; only these usage counters do.
      linkedin_essential_purchased = 0,
      interview_prep_purchased     = 0,
      job_search_purchased         = 0,
      updated_at = now()
  where id = p_user_id;

  return v_total;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_monthly_allowance(uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_monthly_allowance(uuid, timestamptz) TO service_role;


-- ─── THE THIRD COPY OF THE ALLOWANCE TABLE ──────────────────────────────────
--
-- sync_credits_on_tier_change() (20260902180000) is its own trigger with its
-- own copy of "free/pro/elite -> how many credits" — its header comment says
-- so explicitly ("this is the third copy... a trigger cannot read
-- application config"). Missing this one would leave a tier change
-- (subscribing, or being moved off Elite) granting the OLD 80 instead of
-- 100 — caught by tests/test_sql_allowance_parity.py, which reads every
-- migration's copy of this table and fails if any of them disagree with
-- core.credits.TIER_CREDITS.
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
    -- and test_sql_allowance_parity.py both assert every copy agrees.
    v_total := case new.tier
      when 'free'  then 3
      when 'pro'   then 24
      when 'elite' then 100  -- 2026-09-12: was 80.
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

REVOKE EXECUTE ON FUNCTION public.consume_addon_purchase(uuid, text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_addon_purchase(uuid, text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.release_addon_purchase(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.release_addon_purchase(uuid, text) TO service_role;
