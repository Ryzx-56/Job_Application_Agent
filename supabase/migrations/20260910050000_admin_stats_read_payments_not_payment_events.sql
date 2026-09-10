-- admin_paid_by_users() still reads a table that was dropped a week ago.
--
-- ─── THE BUG, FROM A REAL PRODUCTION LOG ────────────────────────────────────
--
--   admin stats RPC 'admin_paid_by_users' failed:
--   {'message': 'relation "public.payment_events" does not exist', 'code': '42P01'}
--
-- 20260902200000_retire_payment_events.sql dropped public.payment_events and
-- rebuilt admin_payment_stats() and admin_payment_by_product() on the new
-- `payments` ledger. It did NOT rebuild admin_paid_by_users(), which is the
-- "paid" column on the admin users table — so that one RPC has been failing
-- ever since.
--
-- Nothing surfaced it. core/admin_stats.py's _rpc() swallows a failed RPC and
-- returns a default, so /api/v1/admin/users still answered 200 with every
-- user's total showing zero — which looks exactly like an admin dashboard
-- correctly reporting that nobody has paid.
--
-- ⚠️ ONLY THIS FUNCTION. The first draft of this migration also rewrote
-- admin_payment_stats() and admin_payment_by_product(), on the assumption
-- that they were broken too. They were not — 20260902200000 had already
-- rebuilt them, in HALALAS with different column names (revenue_all_time_
-- halalas, revenue_halalas), which is what core/admin_stats.py reads. That
-- draft failed to apply, and the failure was the good outcome:
--
--   ERROR: cannot change return type of existing function
--
-- CREATE OR REPLACE cannot change a return type, so Postgres refused it. Had
-- it been written as DROP + CREATE it would have applied and silently broken
-- two working functions by renaming the columns out from under their caller.
--
-- ─── THE TRANSLATION ────────────────────────────────────────────────────────
--
--   payment_events        ->  payments
--   .amount_usd           ->  .amount, which is integer HALALAS (100 to the
--                             riyal, Moyasar's own unit)
--   .status = 'paid'      ->  unchanged
--
-- ─── AND THE UNIT WAS WRONG ─────────────────────────────────────────────────
--
-- The old column was named total_paid_usd, and core/admin_stats.py passes it
-- to _money(), whose docstring says plainly: "TAKES SAR NOW, not USD." So the
-- admin users table was rendering a dollar figure as though it were riyals,
-- understating every user's spend by the 3.75 peg.
--
-- Renamed to total_paid_sar and returned in SAR, which is what the caller
-- already assumed and what the customer is actually charged. The rename is
-- what makes the mismatch impossible to reintroduce quietly; core/admin_stats.py
-- reads the new name.
--
-- DROP + CREATE rather than CREATE OR REPLACE, precisely because the return
-- type is changing. That is the operation the first draft could not perform.

DROP FUNCTION IF EXISTS public.admin_paid_by_users(uuid[]);

CREATE FUNCTION public.admin_paid_by_users(ids uuid[])
RETURNS TABLE(user_id uuid, total_paid_sar numeric, payment_count bigint)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.user_id,
         -- Halalas to riyals. Never a currency conversion: SAR is what was
         -- charged, and the dollar figure the admin pages show is derived
         -- from this one at the fixed peg, not the other way round.
         COALESCE(SUM(p.amount / 100.0) FILTER (WHERE p.status = 'paid'), 0),
         count(*) FILTER (WHERE p.status = 'paid')
  FROM public.payments p
  WHERE p.user_id = ANY(ids)
  GROUP BY p.user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_paid_by_users(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_paid_by_users(uuid[]) TO service_role;
