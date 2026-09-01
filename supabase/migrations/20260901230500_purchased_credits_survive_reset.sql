-- Purchased credits must survive the monthly reset.
--
-- ─── THE BUG ────────────────────────────────────────────────────────────────
--
-- reset_credits_if_due() SETS the balance rather than adding to it:
--
--     update public.profiles
--     set credits_remaining = v_new_total,     -- overwrite, not +=
--
-- So a credit pack bought on day 29 of a cycle is erased on day 30. Buy the
-- Power pack (30 credits, 38 SAR) the day before a reset and you are back to
-- your tier's 24 the next morning, having paid for nothing. Harmless while
-- nothing could be bought; unshippable now that §3 can take the money.
--
-- ─── THE SHAPE OF THE FIX ───────────────────────────────────────────────────
--
-- A user now has two kinds of credit:
--
--   MONTHLY   granted by the tier, reset every cycle, does not roll over.
--   PURCHASED bought with money. Never expires, never reset, never overwritten.
--
-- The obvious modelling — one column per kind — would mean every reader
-- (dashboard, credit button, admin table, the backend's /credits endpoint)
-- has to learn to add them together, and PostgREST fails the ENTIRE query if
-- one named column is missing, so the frontend could not select the new
-- column until the migration had landed. Frontend and migration deploy
-- independently, so that ordering is a coin flip, and losing it takes the
-- dashboard's whole credits query down with it.
--
-- So instead:
--
--   credits_remaining   stays THE SPENDABLE TOTAL — monthly + purchased.
--                       Every existing reader keeps working, untouched.
--   purchased_credits   how much of that total is the non-expiring kind.
--
--   invariant:  0 <= purchased_credits <= credits_remaining
--   monthly portion = credits_remaining - purchased_credits
--
-- Reset then becomes `credits_remaining = tier_total + purchased_credits`,
-- which is the whole fix.
--
-- SPEND ORDER IS MONTHLY FIRST, deliberately. The monthly portion expires at
-- the reset and the purchased portion does not, so spending the perishable
-- one first is the only order that never destroys value the user paid for.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS purchased_credits integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_purchased_credits_nonneg CHECK (purchased_credits >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;

COMMENT ON COLUMN public.profiles.purchased_credits IS
  'How much of credits_remaining was BOUGHT rather than granted by the tier. Never reset. credits_remaining is still the spendable total (monthly + purchased); this is the part of it that must survive reset_credits_if_due(). Invariant: 0 <= purchased_credits <= credits_remaining.';


-- ─── Granting bought credits ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.grant_purchased_credits(p_user_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'grant_purchased_credits needs a positive amount, got %', p_amount;
  end if;

  -- Both columns move together: the credits become spendable AND are marked
  -- as the kind that survives a reset. Updating one without the other is the
  -- bug this migration exists to prevent.
  update public.profiles
  set credits_remaining = credits_remaining + p_amount,
      purchased_credits = purchased_credits + p_amount,
      updated_at        = now()
  where id = p_user_id;

  if not found then
    raise exception 'No profile for user %', p_user_id;
  end if;
end;
$$;


-- ─── Spending ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.spend_credits(p_user_id uuid, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_remaining integer;
  v_purchased integer;
  v_monthly   integer;
  v_from_monthly   integer;
  v_from_purchased integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'spend_credits needs a positive amount, got %', p_amount;
  end if;

  -- FOR UPDATE, so two concurrent generations cannot both read the same
  -- balance and both decide they can afford it. The old reserve_credits()
  -- achieved this with a conditional UPDATE; splitting across two columns
  -- needs the row held for the read as well.
  select credits_remaining, purchased_credits
    into v_remaining, v_purchased
  from public.profiles
  where id = p_user_id
  for update;

  if not found or v_remaining < p_amount then
    return jsonb_build_object('ok', false, 'from_monthly', 0, 'from_purchased', 0);
  end if;

  -- Monthly first: it is the portion that expires.
  v_monthly        := greatest(v_remaining - v_purchased, 0);
  v_from_monthly   := least(p_amount, v_monthly);
  v_from_purchased := p_amount - v_from_monthly;

  update public.profiles
  set credits_remaining = credits_remaining - p_amount,
      purchased_credits = greatest(purchased_credits - v_from_purchased, 0),
      updated_at        = now()
  where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'from_monthly', v_from_monthly,
    'from_purchased', v_from_purchased
  );
end;
$$;


-- ─── Returning credits after a failed generation ────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_credits(
  p_user_id uuid, p_from_monthly integer, p_from_purchased integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
begin
  -- Each kind goes back where it came from. Refunding a purchased credit into
  -- the monthly bucket would quietly convert something the user paid for into
  -- something that expires at the next reset — the same class of loss this
  -- migration is fixing, arriving by a different route.
  update public.profiles
  set credits_remaining = credits_remaining + coalesce(p_from_monthly, 0)
                                            + coalesce(p_from_purchased, 0),
      purchased_credits = purchased_credits + coalesce(p_from_purchased, 0),
      updated_at        = now()
  where id = p_user_id;
end;
$$;


-- ─── The reset itself: the actual bug ───────────────────────────────────────

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

    -- This branch already ADDED the old balance rather than overwriting it,
    -- so purchased credits were never at risk here. purchased_credits is
    -- carried forward unchanged, so the part of the new balance that is
    -- non-expiring stays correctly labelled.
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
  else
    v_new_total := case v_tier
      when 'free' then 3
      when 'pro' then 24
      when 'elite' then 80
    end;

    -- ⚠️ THE FIX. This line used to read `credits_remaining = v_new_total`,
    -- which threw away every credit the user had bought. The monthly portion
    -- is still replaced rather than accumulated — that is intended, monthly
    -- credits do not roll over — but the purchased portion is added back on
    -- top, because it was paid for and expires never.
    update public.profiles
    set credits_remaining = v_new_total + coalesce(v_purchased, 0),
        credits_total = v_new_total,
        credits_reset_at = now() + interval '30 days',
        linkedin_essential_used = 0,
        interview_prep_used = 0,
        updated_at = now()
    where id = p_user_id;
  end if;
end;
$$;


-- ─── Legacy entry points, kept correct ──────────────────────────────────────
--
-- reserve_credits/refund_credits are NOT dropped. The backend on Render and
-- this migration deploy independently, so during a rollout the previous
-- release is still calling these; dropping them would turn that window into
-- 500s on every generation. They are redefined to be purchased-aware so no
-- caller, old or new, can corrupt the split.

CREATE OR REPLACE FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_result jsonb;
begin
  -- Delegates, so there is exactly one implementation of the spend order.
  v_result := public.spend_credits(p_user_id, p_amount);
  return coalesce((v_result->>'ok')::boolean, false);
end;
$$;

CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
begin
  -- Adds to the spendable total WITHOUT marking it purchased.
  --
  -- Imprecise on purpose, and only reachable from the previous release: a
  -- refund that originally came out of the purchased bucket comes back as
  -- monthly, so it would expire at the next reset. The precise path is
  -- restore_credits(user, from_monthly, from_purchased), which is what the
  -- current backend calls. Erring toward "expires" rather than "never
  -- expires" keeps this from being a way to mint permanent credits.
  update public.profiles
  set credits_remaining = credits_remaining + p_amount,
      updated_at = now()
  where id = p_user_id;
end;
$$;


-- ─── Grants ─────────────────────────────────────────────────────────────────
-- Same posture as the existing credit functions (see
-- supabase/section1_security_fixes.sql): revoked from PUBLIC, granted to
-- service_role only. A browser role must never be able to move a balance.

REVOKE EXECUTE ON FUNCTION public.grant_purchased_credits(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spend_credits(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_credits(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_credits_if_due(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grant_purchased_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_credits(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_credits_if_due(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer) TO service_role;


-- ─── Backfill ───────────────────────────────────────────────────────────────
-- Nothing to backfill: no payment has ever been taken, so no existing balance
-- contains a purchased credit and the DEFAULT 0 is correct for every current
-- row. Stated explicitly so the absence of a data migration reads as a
-- decision rather than an omission.
