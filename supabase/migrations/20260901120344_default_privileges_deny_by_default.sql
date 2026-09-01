-- Stop granting new tables/functions/sequences to anon and authenticated.
--
-- THE DEFECT. Supabase ships platform-level ALTER DEFAULT PRIVILEGES that
-- automatically grant rights on every newly created object in `public`:
--
--   FOR ROLE postgres       ... GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN
--                               ON TABLES TO anon, authenticated
--   FOR ROLE supabase_admin ... GRANT ALL ON TABLES    TO anon, authenticated
--   FOR ROLE supabase_admin ... GRANT ALL ON SEQUENCES TO anon, authenticated
--   FOR ROLE supabase_admin ... GRANT ALL ON FUNCTIONS TO anon, authenticated
--
-- So which privileges a new table lands with depends on which role happened to
-- create it. Created by `postgres` (how migrations run) it arrives with
-- TRUNCATE granted to both roles. **RLS DOES NOT FILTER TRUNCATE** — one
-- statement empties the whole table regardless of policy. Created by
-- `supabase_admin` (how the dashboard's table editor creates them) it arrives
-- with full SELECT/INSERT/UPDATE/DELETE to anon and authenticated, leaving RLS
-- as the only thing standing between the public internet and the row.
--
-- The same mechanism grants EXECUTE on every new function to both roles, which
-- is why the Section 1 security pass had to revoke EXECUTE on twelve functions
-- by hand. Left alone, function thirteen arrives wide open too.
--
-- WHY NOW. supabase/section1_security_fixes.sql swept the tables that existed
-- at the time and said so explicitly:
--
--   "NOTE: this covers tables that exist NOW. Supabase's platform-level ALTER
--    DEFAULT PRIVILEGES will re-grant these on tables created later."
--
-- That was the symptom. This is the cause. The billing tables added in
-- 20260901113509_moyasar_billing.sql each had to revoke their own grants
-- one by one; this migration means the next table does not have to remember.
--
-- ─── BLAST RADIUS ───────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES APPLIES ONLY TO OBJECTS CREATED AFTER IT RUNS. No
-- existing table, function or sequence changes in any way. Nothing that works
-- today can break as a result of this migration — the effect is entirely on
-- objects that do not exist yet.
--
-- WHAT CHANGES GOING FORWARD: a new table is deny-by-default and must grant
-- what it wants exposed, e.g.
--
--     GRANT SELECT ON TABLE public.thing TO authenticated;
--     GRANT ALL    ON TABLE public.thing TO service_role;
--
-- without which PostgREST answers 404/permission-denied for client queries.
-- That is the correct direction for this codebase — the backend holds the
-- service_role key and every privileged read already goes through it — but it
-- WILL surprise someone creating a table in the Supabase dashboard and
-- wondering why the client cannot see it. That is the trade, taken knowingly.
--
-- service_role keeps its default grants: it is the backend, and it bypasses
-- RLS by design.


DO $$
DECLARE
  target_role  text;
  unchanged    text[] := '{}';
BEGIN
  -- Both roles, because which one owns a new object depends on how it was
  -- created: `postgres` for CLI/CI migrations, `supabase_admin` for the
  -- dashboard's table editor.
  FOREACH target_role IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE ALL ON TABLES FROM anon, authenticated', target_role);

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE ALL ON SEQUENCES FROM anon, authenticated', target_role);

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE ALL ON FUNCTIONS FROM anon, authenticated', target_role);

      RAISE NOTICE 'default privileges tightened for role %', target_role;

    -- Caught rather than allowed to abort. ALTER DEFAULT PRIVILEGES FOR ROLE X
    -- requires membership in X, and this migration runs as `postgres`, which
    -- on Supabase is NOT a superuser and may not be a member of
    -- supabase_admin. Failing the whole migration over that would take the
    -- billing tables down with it for a hardening step that can be finished by
    -- hand. It warns loudly instead — READ THE CI OUTPUT.
    EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
      unchanged := unchanged || target_role;
      RAISE WARNING
        'could NOT alter default privileges for role % (%)', target_role, SQLERRM;
    END;
  END LOOP;

  IF array_length(unchanged, 1) IS NOT NULL THEN
    RAISE WARNING
      E'\n'
      '=====================================================================\n'
      'DEFAULT-PRIVILEGE HARDENING INCOMPLETE for role(s): %\n'
      'New objects owned by that role will STILL be granted to anon and\n'
      'authenticated. Finish it from the Supabase dashboard SQL editor\n'
      '(which connects with more privilege than CI has):\n'
      '\n'
      '  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\n'
      '    REVOKE ALL ON TABLES    FROM anon, authenticated;\n'
      '  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\n'
      '    REVOKE ALL ON SEQUENCES FROM anon, authenticated;\n'
      '  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\n'
      '    REVOKE ALL ON FUNCTIONS FROM anon, authenticated;\n'
      '=====================================================================',
      array_to_string(unchanged, ', ');
  END IF;
END;
$$;


-- Re-sweep the tables that exist today. Section 1 ran this same statement, but
-- it only covered tables existing on 2026-08-30; anything created since (and
-- anything created between this line and the DO block above taking effect)
-- would have picked the grants back up. Idempotent, and neither privilege is
-- ever legitimately needed by a browser role.
REVOKE TRUNCATE, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;


-- ─── HOW TO VERIFY AFTER DEPLOY ─────────────────────────────────────────────
--
-- 1. Default privileges now in force (anon/authenticated should not appear
--    against TABLES/SEQUENCES/FUNCTIONS for postgres or supabase_admin):
--
--      SELECT r.rolname AS for_role, n.nspname AS schema, a.defaclobjtype, a.defaclacl
--      FROM pg_default_acl a
--      JOIN pg_roles r     ON r.oid = a.defaclrole
--      JOIN pg_namespace n ON n.oid = a.defaclnamespace
--      WHERE n.nspname = 'public';
--
-- 2. No browser role holds a write privilege on any existing table:
--
--      SELECT table_name, grantee, string_agg(privilege_type, ', ') AS privs
--      FROM information_schema.role_table_grants
--      WHERE table_schema = 'public'
--        AND grantee IN ('anon', 'authenticated')
--        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
--      GROUP BY table_name, grantee
--      ORDER BY table_name;
--
--    `resumes` is the expected legitimate hit (authenticated holds
--    INSERT/UPDATE/DELETE, filtered by its own RLS policies). Anything else
--    warrants a look.
