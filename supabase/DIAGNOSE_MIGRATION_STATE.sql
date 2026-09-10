-- Paste this whole file into the Supabase SQL editor. It answers, in order:
--   1. which migrations the database thinks it has applied
--   2. whether the profiles columns that are "missing" actually exist
--   3. what the admin functions are really reading
--
-- Your earlier query failed on `inserted_at` because that column does not
-- exist. supabase_migrations.schema_migrations has `version`, `name` and
-- `statements` — no timestamp at all, which is why the ordering below is by
-- version (the filename prefix, so it sorts chronologically anyway).

-- ── 1. WHAT THE DATABASE THINKS IS APPLIED ─────────────────────────────────
-- Expect 12 rows if everything landed. The repo currently holds:
--   20260830073317  remote_baseline
--   20260901113509  moyasar_billing
--   20260901120344  default_privileges_deny_by_default
--   20260901230500  purchased_credits_survive_reset
--   20260902180000  fix_tier_trigger_and_clawback
--   20260902200000  retire_payment_events
--   20260903090000  subscription_credits_are_monthly
--   20260903140000  account_deletion_and_identity_ledger
--   20260903160000  profiles_credit_defaults_match_free_tier
--   20260909190000  reset_credits_requires_paid_billing
--   20260909200000  job_search_metering
--   20260910050000  admin_stats_read_payments_not_payment_events
select version, name
from supabase_migrations.schema_migrations
order by version;


-- ── 2. DO THE "MISSING" COLUMNS ACTUALLY EXIST? ────────────────────────────
-- The backend logs "found no is_owner or owner column" whenever its query
-- FAILS FOR ANY REASON — a network blip and a genuinely absent column produce
-- the identical message, because the read catches every exception and moves
-- on. So the log is a hypothesis. This is the fact.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name in ('is_owner','is_alpha_tester','is_admin','admin',
                      'purchased_credits','job_search_used')
order by column_name;

-- Anything absent from the list above is genuinely not there. In particular:
--   purchased_credits  -> 20260901230500 applied
--   job_search_used    -> 20260909200000 applied
--   is_owner           -> the BASELINE applied (it is in CREATE TABLE profiles)


-- ── 3. WHAT THE ADMIN FUNCTIONS ARE READING ────────────────────────────────
-- If admin_paid_by_users still mentions payment_events, 20260910050000 has
-- not applied. Its return column should be total_paid_sar, not total_paid_usd.
select p.proname,
       pg_get_function_result(p.oid)                       as returns,
       position('payment_events' in pg_get_functiondef(p.oid)) > 0 as reads_dropped_table
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_paid_by_users','admin_payment_stats',
                    'admin_payment_by_product','consume_addon_quota',
                    'reset_credits_if_due','apply_monthly_allowance')
order by p.proname;


-- ── 4. DOES THE DROPPED TABLE STILL EXIST? ─────────────────────────────────
-- Expect zero rows. A row here means 20260902200000 did NOT apply, which
-- would change the whole diagnosis.
select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'payment_events';
