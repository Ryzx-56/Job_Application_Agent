-- ============================================================================
-- Tarshih -- Section 1: RLS & Database Function Security
-- Prepared 2026-08-30. Review, then run as a single script in the SQL Editor.
--
-- Everything here is DDL/DCL only. It does not touch row data, with one
-- exception clearly marked in step 2 (dropping the dead `applications` table).
--
-- WHAT IS DELIBERATELY *NOT* HERE:
--   * No auth.uid() = p_user_id check on reserve_credits / refund_credits /
--     reset_credits_if_due. Those are only ever called with the service_role
--     key, where auth.uid() is NULL, so such a check would fail 100% of the
--     time and break every CV generation on the site.
--   * No SECURITY INVOKER conversions. Once EXECUTE is revoked, only
--     service_role reaches these, and it bypasses RLS either way.
--   * No changes to the `resumes` or `profiles` policies. They were audited
--     and are correct (auth.uid() = user_id on every operation).
-- ============================================================================

begin;

-- --- 1. interview_preps: restore service_role DML ---------------------------
-- Was: service_role held only REFERENCES/TRIGGER/TRUNCATE, so all three call
-- sites in core/interview.py failed and were swallowed by their try/except.
-- Live effect: interview prep was never persisted and was re-generated (a paid
-- Gemini/Claude call) on every visit, and the "already prepared" marker in the
-- picker never appeared. No DELETE granted -- nothing in the code deletes preps.
grant select, insert, update on public.interview_preps to service_role;


-- --- 2. Drop the dead `applications` table ----------------------------------
-- Zero references in current code AND across the entire git history (all
-- branches: table("applications"), from("applications"), and the bare string).
-- No role held any DML grant on it, so nothing could have been using it.
-- Its 4 RLS policies drop with it.
drop table if exists public.applications;


-- --- 3. Lock down SECURITY DEFINER functions --------------------------------
-- IMPORTANT: each function below had proacl = NULL, meaning EXECUTE is held by
-- PUBLIC -- not by explicit anon/authenticated grants. "REVOKE ... FROM anon,
-- authenticated" would therefore have been a silent NO-OP. It must be revoked
-- from PUBLIC, then re-granted to service_role only where the backend calls it.
--
-- The 10 admin_* functions, consume_addon_quota, release_addon_quota and
-- claim_founding_member_slot(uuid) are absent from this list on purpose: they
-- were already locked to {postgres, service_role}. Nothing to change.

-- 3a. Credit RPCs -- called by the backend via the service_role key.
revoke execute on function public.reserve_credits(uuid, integer)     from public;
revoke execute on function public.refund_credits(uuid, integer)      from public;
revoke execute on function public.reset_credits_if_due(uuid)         from public;
grant  execute on function public.reserve_credits(uuid, integer)     to service_role;
grant  execute on function public.refund_credits(uuid, integer)      to service_role;
grant  execute on function public.reset_credits_if_due(uuid)         to service_role;

-- 3b. NOT IN THE ORIGINAL BRIEF -- stale 3-arg founding-member overload.
-- There are two claim_founding_member_slot functions. The 1-arg version is
-- already locked to {postgres, service_role}. This 3-arg version was
-- SECURITY DEFINER with EXECUTE held by PUBLIC and no search_path, and it is
-- the overload PostgREST exposes -- so any holder of the public anon key could
-- call it with their own p_user_id, p_max_slots AND p_price. Nothing in the
-- codebase calls either overload, so it gets no re-grant.
revoke execute on function public.claim_founding_member_slot(uuid, integer, numeric) from public;

-- 3c. Trigger functions. A trigger fires as the table owner and Postgres does
-- NOT re-check EXECUTE at fire time (it is checked once, at CREATE TRIGGER),
-- so revoking here cannot break the triggers that depend on them.
revoke execute on function public.cascade_profile_info_to_resumes()  from public;
revoke execute on function public.enforce_resume_retention()         from public;
revoke execute on function public.handle_new_user()                  from public;
revoke execute on function public.set_resume_owner_info()            from public;
revoke execute on function public.sync_credits_on_tier_change()      from public;
revoke execute on function public.sync_profile_from_auth_user()      from public;

-- 3d. Event trigger function -- postgres only.
-- (Postgres already refuses a direct call to an event_trigger-returning
-- function, so this is belt-and-braces rather than closing a live hole.)
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from service_role;


-- --- 4. NOT IN THE ORIGINAL BRIEF: revoke TRUNCATE from anon/authenticated ---
-- Every public table granted TRUNCATE (and REFERENCES) to anon and
-- authenticated. RLS does NOT filter TRUNCATE: a single statement empties the
-- whole table regardless of policy. Not reachable through PostgREST today, so
-- this was a latent footgun rather than a live hole -- but it meant the RLS
-- protecting `resumes` and `profiles` was one SQL-executing RPC away from
-- being irrelevant.
--
-- NOTE: this covers tables that exist NOW. Supabase's platform-level ALTER
-- DEFAULT PRIVILEGES will re-grant these on tables created later.
revoke truncate, references on all tables in schema public from anon, authenticated;


-- --- 5. Pin search_path on the 8 functions that had none --------------------
-- Fixes the `function_search_path_mutable` advisory: without a pinned path, a
-- shadowed object earlier in the caller's search_path can hijack an
-- unqualified reference inside a SECURITY DEFINER body.
--
-- handle_new_user and enforce_resume_retention are absent: they ALREADY have
-- search_path=public. Not touching what works.
--
-- SCOPE CAVEAT -- READ THIS. These use the fallback value you pre-approved
-- (public, extensions, pg_temp) because I was not able to read the function
-- bodies: there is no psql / Supabase CLI / DB password available to me, so
-- bodies_readonly.sql could not be run. `extensions` is included because
-- Supabase installs pgcrypto/uuid-ossp there, and pinning to `public` alone
-- would break any body that calls one of those unqualified.
-- If you paste the output of bodies_readonly.sql, I will tighten each of these
-- to the minimum schema set its body actually touches.
alter function public.reserve_credits(uuid, integer)      set search_path = public, extensions, pg_temp;
alter function public.refund_credits(uuid, integer)       set search_path = public, extensions, pg_temp;
alter function public.reset_credits_if_due(uuid)          set search_path = public, extensions, pg_temp;
alter function public.sync_credits_on_tier_change()       set search_path = public, extensions, pg_temp;
alter function public.set_resume_owner_info()             set search_path = public, extensions, pg_temp;
alter function public.cascade_profile_info_to_resumes()   set search_path = public, extensions, pg_temp;
alter function public.claim_founding_member_slot(uuid, integer, numeric)
                                                          set search_path = public, extensions, pg_temp;

-- sync_profile_from_auth_user gets `auth` as well, and this one is a reasoned
-- exception rather than the blanket fallback. It is an AFTER UPDATE trigger on
-- auth.users, fired by GoTrue connecting as supabase_auth_admin, whose session
-- search_path can include `auth`. If its body references an auth object
-- unqualified, pinning to public alone would break signup and profile sync on
-- a live product. Including `auth` removes that risk at no security cost:
-- `auth` is not a schema ordinary users can create objects in, which is the
-- entire threat model this advisory is about.
alter function public.sync_profile_from_auth_user()       set search_path = public, extensions, auth, pg_temp;

commit;


-- ============================================================================
-- OPTIONAL TIDY-UP -- not run above, left commented on purpose.
-- The legacy `resumes` storage bucket was deleted on 2026-08-30 (26 objects
-- from 7 users, backed up first to
-- C:\Users\abdul\Documents\tarshih-storage-backup-2026-08-22).
-- These 8 storage.objects policies now reference a bucket that no longer
-- exists, so they are inert and harmless. Drop them only if you want the
-- policy list clean, and note you would need to recreate them if a `resumes`
-- bucket is ever reintroduced.
-- ============================================================================
-- drop policy if exists "Users can read their own resume files"   on storage.objects;
-- drop policy if exists "Users can upload their own resume files" on storage.objects;
-- drop policy if exists "Users can update their own resume files" on storage.objects;
-- drop policy if exists "Users can delete their own resume files" on storage.objects;
-- drop policy if exists resumes_bucket_select_own on storage.objects;
-- drop policy if exists resumes_bucket_insert_own on storage.objects;
-- drop policy if exists resumes_bucket_update_own on storage.objects;
-- drop policy if exists resumes_bucket_delete_own on storage.objects;


-- ============================================================================
-- POST-APPLY VERIFICATION -- run separately, AFTER the script above.
-- (The SQL Editor only shows the last statement's result set, so run this on
-- its own.) Expect: every row in the first block to show a pinned search_path
-- and an ACL with no anon/authenticated; no TRUNCATE for anon/authenticated.
-- ============================================================================
-- select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
--        coalesce(p.proconfig::text, '** STILL NO search_path **') as search_path,
--        coalesce(p.proacl::text, '** STILL PUBLIC EXECUTE **')    as execute_acl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
-- union all
-- select 'GRANT: ' || table_name, grantee,
--        string_agg(privilege_type, ',' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema = 'public' and grantee in ('anon','authenticated')
-- group by table_name, grantee
-- order by 1;
