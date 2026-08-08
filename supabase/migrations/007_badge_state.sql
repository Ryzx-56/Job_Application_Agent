-- 007_badge_state.sql
--
-- Records which badges a user has already been congratulated for, so the
-- "you earned a badge" popup fires exactly once per badge rather than on
-- every page load forever.
--
-- Stored on the profile as a plain text[] rather than its own table: it's a
-- tiny set (at most a handful of keys), it's always read together with the
-- profile, and it has no history worth keeping. A join table would be more
-- machinery for no benefit.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seen_badges text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.seen_badges IS
  'Badge keys the user has already seen the congratulations popup for. Compared against their currently-earned badges to decide what is new.';


-- ── BACKFILL ───────────────────────────────────────────────────────────────
-- Existing users should NOT be greeted with a popup for every badge they
-- already have — that would fire the moment this ships and look broken.
-- Mark everything they currently hold as already seen; only genuinely new
-- badges from here on will trigger it.
--
-- Mirrors the same derivation core/badges.py uses: tier badges come from
-- the live subscription state, the rest from their flags.
UPDATE public.profiles p
SET seen_badges = ARRAY(
  SELECT DISTINCT k FROM unnest(ARRAY[
    CASE WHEN p.is_owner THEN 'owner' END,
    CASE WHEN p.is_admin THEN 'admin' END,
    CASE WHEN p.is_alpha_tester THEN 'alpha_tester' END,
    CASE WHEN p.is_founding_member THEN 'founding_member' END,
    CASE
      WHEN p.tier = 'elite'
       AND COALESCE(p.subscription_status, '') IN ('active', 'trialing') THEN 'elite'
      WHEN p.tier = 'pro'
       AND COALESCE(p.subscription_status, '') IN ('active', 'trialing') THEN 'pro'
      ELSE 'free'
    END
  ]) AS k
  WHERE k IS NOT NULL
)
WHERE seen_badges = '{}';


-- ── FOUNDING MEMBER: first 50 who actually PAY ─────────────────────────────
-- Subscribing isn't the same as paying. This claims a slot only when called,
-- which the payment webhook should do on the first SUCCESSFUL charge — not
-- when someone merely selects a plan.
--
-- Advisory lock, so two payments landing in the same instant can't both be
-- handed slot #50. Returns the assigned number, or NULL if the user already
-- has one or all 50 are gone.
CREATE OR REPLACE FUNCTION public.claim_founding_member_slot(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing integer;
  taken    integer;
  slot     integer;
BEGIN
  SELECT founding_member_number INTO existing
  FROM public.profiles WHERE id = p_user_id;

  -- Idempotent: a retried webhook must not consume a second slot.
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  -- Serializes every concurrent claim on one arbitrary but constant key.
  PERFORM pg_advisory_xact_lock(hashtext('founding_member_slot'));

  SELECT count(*) INTO taken FROM public.profiles WHERE is_founding_member;
  IF taken >= 50 THEN
    RETURN NULL;
  END IF;

  slot := taken + 1;
  UPDATE public.profiles
  SET is_founding_member = true,
      founding_member_number = slot
  WHERE id = p_user_id;

  RETURN slot;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_founding_member_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_founding_member_slot(uuid) TO service_role;

-- Call this from the payment webhook, on a Pro/Elite charge that succeeded:
--   SELECT public.claim_founding_member_slot('<user-uuid>');
