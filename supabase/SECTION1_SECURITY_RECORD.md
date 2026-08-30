# Section 1 — RLS & Database Function Security

**Applied 2026-08-30.** SQL in [`section1_security_fixes.sql`](section1_security_fixes.sql).
Verified post-apply by catalog query (`pg_proc` / `information_schema`) and by live
probes against the PostgREST and Storage APIs.

---

## Audit result: what was already correct

Worth recording so nobody "fixes" it later.

| Area | Finding |
|---|---|
| `resumes` RLS | SELECT / INSERT / UPDATE / DELETE all enforce `auth.uid() = user_id` |
| `profiles` RLS | SELECT-own only; `authenticated` holds no write grant — all writes go via backend service_role |
| Storage policies | Scoped to `(storage.foldername(name))[1] = auth.uid()::text` — no cross-user access |
| `anon` table access | No SELECT grant on any table; blocked at the privilege layer, before RLS |
| `admin_*` (10), `consume_addon_quota`, `release_addon_quota`, `claim_founding_member_slot(uuid)` | Already `{postgres, service_role}` with a pinned `search_path` — untouched |
| `payment_events` (RLS on, 0 policies) | Intentional: service-role-only, awaiting Moyasar. Not a broken feature |

`resumes` and `storage.objects` each carry two duplicate policy sets (an older
`"Users can …"` set and a newer `*_own` set) expressing identical conditions.
Permissive policies OR together, so this is redundant, not a hole. Left alone.

**`fetchResumes` / `deleteResume` in `frontend/src/lib/supabase/resumes.ts` have no
ownership filter in app code — RLS is the only thing scoping them. Verified correct.
Do not remove those policies.**

---

## What was fixed

### 1. `interview_preps` was silently broken
`service_role` held only `REFERENCES/TRIGGER/TRUNCATE` — no DML. All three call sites
in `backend/core/interview.py` (`_fetch_prep`, `_prepared_map`, `_save_prep`) wrap their
query in `try/except` and degrade quietly, so nothing ever surfaced.

Live effect: interview prep was **never persisted**. Every revisit re-ran a paid
Gemini/Claude generation, and the "already prepared" marker never appeared.

Fix: `grant select, insert, update on public.interview_preps to service_role`.
No DELETE — nothing in the code deletes preps.

### 2. `applications` — dead table, dropped
Zero references in current code *and* across the entire git history (all branches).
No role held any DML grant. Dropped along with its 4 policies.

### 3. EXECUTE revoked on 11 SECURITY DEFINER functions

**The important detail:** every one had `proacl = NULL`, meaning EXECUTE was held by
**PUBLIC** — not by explicit `anon`/`authenticated` grants. `REVOKE … FROM anon,
authenticated` would have been a **silent no-op that looked like a fix**. The revoke
had to target `PUBLIC`, then re-grant `service_role` where the backend calls it.

- Credit RPCs (`reserve_credits`, `refund_credits`, `reset_credits_if_due`) → revoked
  from PUBLIC, re-granted to `service_role`
- Trigger functions (`cascade_profile_info_to_resumes`, `enforce_resume_retention`,
  `handle_new_user`, `set_resume_owner_info`, `sync_credits_on_tier_change`,
  `sync_profile_from_auth_user`) → revoked, no re-grant. Triggers fire as the table
  owner and Postgres checks EXECUTE only at `CREATE TRIGGER`, so this cannot break them
- `rls_auto_enable` → revoked from PUBLIC *and* `service_role`; postgres only

**No `auth.uid() = p_user_id` check was added to the credit RPCs, deliberately.** They are
only ever called with the service_role key, where `auth.uid()` is `NULL` — such a check
would fail 100% of the time and break every CV generation on the site. Revoking EXECUTE
is strictly stronger here. Do not add one.

No `SECURITY INVOKER` conversions: once EXECUTE is revoked only `service_role` reaches
these, and it bypasses RLS either way.

### 4. `search_path` pinned on 8 functions
`handle_new_user` and `enforce_resume_retention` already had it and were left alone.

Applied `public, extensions, pg_temp` to seven. `extensions` is included because Supabase
installs pgcrypto/uuid-ossp there and pinning to `public` alone would break any
unqualified call into them.

`sync_profile_from_auth_user` got `public, extensions, auth, pg_temp` — it is an
`AFTER UPDATE` trigger on `auth.users` fired by GoTrue as `supabase_auth_admin`, whose
session path can include `auth`. Including `auth` removes the risk of breaking signup at
no security cost: `auth` is not a schema ordinary users can create objects in, which is
the entire threat model of the `function_search_path_mutable` advisory.

These values were chosen without reading the function bodies (no psql/CLI/DB password
available). They are safe supersets, not minimal. Tightening is optional cleanup.

---

## Found outside the original brief

### `claim_founding_member_slot` had an exposed second overload
Two functions share the name. `claim_founding_member_slot(uuid)` was already locked.
`claim_founding_member_slot(uuid, integer, numeric)` was `SECURITY DEFINER` with EXECUTE
held by PUBLIC and no `search_path` — **and it is the overload PostgREST exposes.**

Anyone holding the public anon key could call it with their own `p_user_id`,
`p_max_slots` **and `p_price`** — a self-service founding-member grant at an
attacker-chosen price. Nothing in the codebase calls either overload.

Revoked. Consider dropping the 3-arg version outright when Moyasar is wired up.

### `TRUNCATE` was granted to `anon` and `authenticated` on every table
RLS does **not** filter `TRUNCATE` — one statement empties a table regardless of policy.
Not reachable through PostgREST, so latent rather than live, but it meant the RLS
protecting `resumes` and `profiles` was one SQL-executing RPC away from irrelevant.

`TRUNCATE` and `REFERENCES` revoked from both roles on all public tables.

⚠️ This covers tables existing at the time. Supabase's platform-level
`ALTER DEFAULT PRIVILEGES` re-grants these on **tables created later** — re-run the
revoke after adding a table.

### Legacy `resumes` storage bucket still held user files
The code path stores nothing (`storage.from` has zero hits; `documents.py` regenerates
on demand), but a private bucket created 2026-07-06 still held **26 PDFs from 7 users**.
`anon` could not reach them, and the storage policies were correctly per-user scoped — so
not an active exposure, but live PII with no owner.

Complication found before deleting: **12 of 20 resume rows have no `generation_snapshot`**,
and `documents.py:82` returns 404 for those. 11 of them had their only surviving copy in
this bucket.

All 26 objects were backed up to
`C:\Users\abdul\Documents\tarshih-storage-backup-2026-08-22` (outside the repo, with a
PII manifest), integrity-checked, then the objects and the bucket were deleted. Paths
preserved as `{user_id}/{resume_id}/{cv|cover-letter}.pdf` for manual recovery.

The 8 `storage.objects` policies now reference a bucket that no longer exists. They are
inert; drop statements are left commented at the bottom of the SQL file.

---

## Post-apply verification

| Check | Result |
|---|---|
| `applications` removed from schema | ✅ `PGRST205` / absent from OpenAPI spec |
| `service_role` SELECT on `interview_preps` | ✅ `200` (was `42501`) |
| `service_role` INSERT / UPDATE on `interview_preps` | ✅ `23502` NOT NULL / `204` — constraint, not permission; no row written |
| `anon` → the 5 revoked RPCs | ✅ all `42501 permission denied for function` — rejected before execution, no mutation |
| `service_role` → `reset_credits_if_due` / `reserve_credits` | ✅ `204` / `200 false` — backend path intact |
| `anon` table reads | ✅ still `42501` on every table |
| `authenticated` grants after TRUNCATE revoke | ✅ `resumes` keeps DELETE/INSERT/SELECT/UPDATE; `profiles` keeps SELECT |
| All 8 `search_path` values | ✅ pinned as intended |
| All 11 EXECUTE ACLs | ✅ no `anon`/`authenticated`; `service_role` retained only where required |
| Storage buckets | ✅ `GET /storage/v1/bucket` returns `[]` |

---

## Deferred to Section 3 — leaked password protection

Supabase's built-in HaveIBeenPwned check is a **paid-plan feature**, and this project is
on the Free plan, so the dashboard toggle is not an option.

Decided 2026-08-30: implement the check in application code instead, as part of Section 3
(login/session work) rather than here. Approach — HIBP's free k-anonymity range API:

1. SHA-1 the candidate password, uppercase hex
2. Send only the **first 5 hex chars** to `https://api.pwnedpasswords.com/range/<5chars>`
3. Reject if the remaining 35-char suffix appears in the response body

Must be enforced **server-side** on both the signup flow and the password-change flow —
a frontend-only check is bypassable by calling the Supabase Auth API directly. Fail open
on an HIBP outage (do not block signups on a third-party dependency), and log when it
happens.

## Optional follow-ups — deliberately skipped

Reviewed and declined 2026-08-30, not oversights:

- Dropping the 8 inert `storage.objects` policies (drop statements left commented in the
  SQL file)
- Tightening `search_path` from the safe supersets to minimal per-function sets
