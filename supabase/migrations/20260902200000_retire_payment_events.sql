-- Retire public.payment_events. public.payments becomes the one ledger.
--
-- ─── WHY THERE WERE TWO ─────────────────────────────────────────────────────
--
-- payment_events was built speculatively, before any payment flow existed, as
-- an append-only revenue rollup for the admin Analytics page. payments was
-- built in the billing work as the operational record. They overlap, and only
-- one should be the source of revenue.
--
-- payments wins on every axis that matters here:
--
--   money        integer halalas in SAR, the charged currency, versus
--                numeric amount_usd — a unit this product never charges in.
--                admin_stats.py still carries a _money_from_usd() helper
--                apologising for "rows written before SAR became the unit".
--   rows         payment_events has NEVER been written to. Nothing in the
--                codebase inserts one; admin_stats only reads it, which is
--                why the revenue panel has always reported zero.
--   grain        payments records every ATTEMPT, so "why did this customer's
--                payment fail" is answerable. payment_events only ever
--                intended to hold successes.
--   audit        payments keeps the provider's full response in raw_response.
--   idempotency  payments.moyasar_payment_id is UNIQUE. payment_events'
--                provider_ref is nullable with no unique index.
--
-- ─── WHAT CHANGES FOR CALLERS ───────────────────────────────────────────────
--
-- Both admin functions now return HALALAS and are renamed accordingly
-- (revenue_all_time_halalas, not revenue_all_time_usd). Renaming rather than
-- quietly changing what a column called "_usd" contains: a caller that still
-- reads the old name now fails loudly instead of reporting figures 3.75x
-- wrong. core/admin_stats.py is updated in the same commit.
--
-- A refund is a STATUS CHANGE on the payments row, not a negative row. Net
-- revenue is therefore a filter (status IN paid/captured) rather than a SUM
-- over signed amounts. That is a different mental model from the old ledger
-- and is why the filters below are written out rather than inherited.


-- ─── 1. Rewrite the two functions to read payments ──────────────────────────

DROP FUNCTION IF EXISTS public.admin_payment_stats();

CREATE FUNCTION public.admin_payment_stats()
RETURNS TABLE(
  total_payments bigint,
  revenue_all_time_halalas bigint,
  revenue_this_month_halalas bigint,
  subs_ever bigint,
  subs_this_month bigint,
  packs_ever bigint,
  packs_this_month bigint,
  refunded_ever bigint,
  failed_ever bigint
)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH month_start AS (SELECT date_trunc('month', now()) AS d)
  SELECT
    count(*),
    -- Only money that actually moved and stayed. A refunded payment keeps
    -- its amount for the audit trail but must not count as revenue.
    COALESCE(SUM(amount) FILTER (WHERE status IN ('paid','captured')), 0),
    COALESCE(SUM(amount) FILTER (WHERE status IN ('paid','captured')
             AND created_at >= (SELECT d FROM month_start)), 0),
    count(*) FILTER (WHERE type IN ('subscription_initial','subscription_renewal')
             AND status IN ('paid','captured')),
    count(*) FILTER (WHERE type IN ('subscription_initial','subscription_renewal')
             AND status IN ('paid','captured')
             AND created_at >= (SELECT d FROM month_start)),
    count(*) FILTER (WHERE type = 'credit_pack' AND status IN ('paid','captured')),
    count(*) FILTER (WHERE type = 'credit_pack' AND status IN ('paid','captured')
             AND created_at >= (SELECT d FROM month_start)),
    -- New, and worth having: the old ledger could not express either, because
    -- it only ever held successes.
    count(*) FILTER (WHERE status = 'refunded'),
    count(*) FILTER (WHERE status IN ('failed','voided'))
  FROM public.payments;
$$;


DROP FUNCTION IF EXISTS public.admin_payment_by_product();

CREATE FUNCTION public.admin_payment_by_product()
RETURNS TABLE(
  kind text,
  product_slug text,
  count_ever bigint,
  count_month bigint,
  revenue_halalas bigint
)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.type,
    COALESCE(p.reference, 'unknown'),
    count(*),
    count(*) FILTER (WHERE p.created_at >= date_trunc('month', now())),
    COALESCE(SUM(p.amount), 0)
  FROM public.payments p
  WHERE p.status IN ('paid','captured')
  GROUP BY p.type, COALESCE(p.reference, 'unknown')
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.admin_payment_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_payment_by_product() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_payment_by_product() TO service_role;


-- ─── 2. Drop the old table, but ONLY if it is empty ─────────────────────────
--
-- It is expected to hold zero rows — nothing has ever inserted one. But this
-- migration reaches production with no approval gate and no point-in-time
-- restore on this plan, and "expected to be empty" is not the same as
-- verified. If anything is in there it is financial history, so the drop is
-- skipped and the run says so rather than destroying it.

DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.payment_events') IS NULL THEN
    RAISE NOTICE 'payment_events is already gone; nothing to drop.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.payment_events' INTO v_rows;

  IF v_rows = 0 THEN
    DROP TABLE public.payment_events;
    RAISE NOTICE 'payment_events was empty and has been dropped.';
  ELSE
    RAISE WARNING
      E'\n'
      '=====================================================================\n'
      'payment_events STILL HAS % ROW(S) and was NOT dropped.\n'
      'That is financial history and this migration will not destroy it.\n'
      'The admin functions now read public.payments, so the panel is already\n'
      'correct; this table is simply orphaned. Export it, confirm nothing is\n'
      'needed, then drop it by hand.\n'
      '=====================================================================',
      v_rows;
  END IF;
END;
$$;
