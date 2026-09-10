-- Three admin functions still read a table that was dropped a week ago.
--
-- ─── THE BUG, FROM A REAL PRODUCTION LOG ────────────────────────────────────
--
--   admin stats RPC 'admin_paid_by_users' failed:
--   {'message': 'relation "public.payment_events" does not exist', 'code': '42P01'}
--
-- 20260902200000_retire_payment_events.sql did `DROP TABLE public.payment_events`
-- and did not repoint the three SQL functions that query it:
--
--   admin_paid_by_users(uuid[])   the "paid" column on the admin users table
--   admin_payment_by_product()    revenue split by product
--   admin_payment_stats()         the revenue headline numbers
--
-- Nothing caught it because core/admin_stats.py's _rpc() swallows a failed RPC
-- and returns a default, so /api/v1/admin/users still answered 200 — with
-- every revenue figure silently zero. An admin dashboard that reports zero
-- revenue because a table is missing looks exactly like an admin dashboard
-- reporting that nobody has paid.
--
-- ─── THE TRANSLATION ────────────────────────────────────────────────────────
--
-- payment_events         ->  payments
--   .amount_usd          ->  .amount is HALALAS (integer, SAR). USD is derived
--                            at the 3.75 peg, which is fixed (core/pricing.py
--                            SAR_PER_USD) — so amount / 100.0 / 3.75.
--   .status = 'paid'     ->  .status = 'paid'  (unchanged)
--   .kind                ->  .type, with different values:
--                              'subscription' -> 'subscription_initial'
--                                                'subscription_renewal'
--                              'pack'         -> 'credit_pack'
--                              'refund'       -> there is no refund TYPE; a
--                                                refund is a status. Excluded
--                                                by the status filter instead.
--   .product_slug        ->  .reference
--
-- The USD column names are kept exactly as they were. Every caller in
-- core/admin_stats.py reads them by name, and renaming them here to say SAR
-- would be a second, unrelated change riding along inside a bug fix — the
-- dashboard converts with the same peg and would then double-convert.

CREATE OR REPLACE FUNCTION public.admin_paid_by_users(ids uuid[])
RETURNS TABLE(user_id uuid, total_paid_usd numeric, payment_count bigint)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.user_id,
         COALESCE(SUM(p.amount / 100.0 / 3.75) FILTER (WHERE p.status = 'paid'), 0),
         count(*) FILTER (WHERE p.status = 'paid')
  FROM public.payments p
  WHERE p.user_id = ANY(ids)
  GROUP BY p.user_id;
$$;


CREATE OR REPLACE FUNCTION public.admin_payment_by_product()
RETURNS TABLE(kind text, product_slug text, count_ever bigint, count_month bigint, revenue_usd numeric)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    -- Collapsed back to the two buckets the dashboard has always grouped by,
    -- so the UI does not have to learn that a renewal and a first month are
    -- both subscription revenue.
    CASE
      WHEN p.type IN ('subscription_initial', 'subscription_renewal') THEN 'subscription'
      WHEN p.type = 'credit_pack' THEN 'pack'
      ELSE p.type
    END,
    COALESCE(p.reference, 'unknown'),
    count(*),
    count(*) FILTER (WHERE p.created_at >= date_trunc('month', now())),
    COALESCE(SUM(p.amount / 100.0 / 3.75), 0)
  FROM public.payments p
  WHERE p.status = 'paid'
  GROUP BY 1, COALESCE(p.reference, 'unknown');
$$;


CREATE OR REPLACE FUNCTION public.admin_payment_stats()
RETURNS TABLE(total_events bigint, revenue_all_time_usd numeric, revenue_this_month_usd numeric,
              subs_ever bigint, subs_this_month bigint, packs_ever bigint, packs_this_month bigint)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH month_start AS (SELECT date_trunc('month', now()) AS d)
  SELECT
    count(*),
    COALESCE(SUM(amount / 100.0 / 3.75) FILTER (WHERE status = 'paid'), 0),
    COALESCE(SUM(amount / 100.0 / 3.75) FILTER (WHERE status = 'paid'
             AND created_at >= (SELECT d FROM month_start)), 0),
    count(*) FILTER (WHERE type IN ('subscription_initial', 'subscription_renewal')
             AND status = 'paid'),
    count(*) FILTER (WHERE type IN ('subscription_initial', 'subscription_renewal')
             AND status = 'paid' AND created_at >= (SELECT d FROM month_start)),
    count(*) FILTER (WHERE type = 'credit_pack' AND status = 'paid'),
    count(*) FILTER (WHERE type = 'credit_pack' AND status = 'paid'
             AND created_at >= (SELECT d FROM month_start))
  FROM public.payments;
$$;
