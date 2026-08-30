# Backups and restore

Checked 2026-08-30.

## The situation, plainly

**This project has no automatic database backups, and cannot have them on its
current plan.** Supabase's own documentation is explicit: the Free plan gets no
automatic backups, and free-tier projects are told to "regularly export their
data using the Supabase CLI db dump command and maintain off-site backups."

| Plan | Automatic backups | Retention |
|---|---|---|
| **Free (this project)** | **None** | — |
| Pro | Daily | 7 days |
| Team | Daily | 14 days |
| Enterprise | Daily | 30 days |

Point-in-Time Recovery is a paid add-on for Pro and above (~$100–400/month) and
requires the Small compute add-on. Not relevant here.

### Why this is worth acting on rather than noting

Three things compound:

1. There are real users with real data — CVs, names, emails, phone numbers.
2. Migrations deploy to production **automatically on merge to main**, with no
   staging project (decided 2026-08-30, see `.github/workflows/`). A bad
   migration reaches live data with a PR dry-run as the only gate.
3. There is nothing to roll back to. Not "a stale backup" — nothing.

The schema is safe: `supabase/migrations/20260830073317_remote_baseline.sql` is
a committed `pg_dump` of the full public schema, so the structure can always be
rebuilt from git. **It is the DATA that is unprotected.**

## Taking a backup

`pg_dump` 17 is already installed locally (added 2026-08-30 to produce the
baseline). Connect through the **session pooler on port 5432** — the direct
`db.<ref>.supabase.co` endpoint is IPv6-only and will not resolve on most
networks. Do not use port 6543; that is transaction mode.

**Full backup, schema and data:**

```powershell
$env:PGPASSWORD = '<database password>'
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" `
  --host aws-1-ap-south-1.pooler.supabase.com --port 5432 `
  --username postgres.gucnxchtywmdytsvkjup --dbname postgres `
  --schema=public --no-owner --format=custom `
  --file "tarshih-backup-$stamp.dump"
Remove-Item Env:\PGPASSWORD
```

`--format=custom` (not plain SQL) because it compresses and lets `pg_restore`
pick individual tables during a partial recovery.

**Where to put it.** Anywhere that is not this repository. The repo is
**public**, and the dump contains every user's CV content, name, email and
phone number. For the same reason, do not add a GitHub Actions workflow that
uploads a dump as a build artifact — artifacts on a public repository are
publicly downloadable, which would turn a backup into a breach.

Suggested cadence while on Free: weekly, plus immediately before merging any
migration that alters or drops a column.

## Restoring

**If the project still exists** (bad migration, deleted rows):

```powershell
$env:PGPASSWORD = '<database password>'
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
  --host aws-1-ap-south-1.pooler.supabase.com --port 5432 `
  --username postgres.gucnxchtywmdytsvkjup --dbname postgres `
  --clean --if-exists --no-owner --single-transaction `
  "tarshih-backup-<stamp>.dump"
Remove-Item Env:\PGPASSWORD
```

`--single-transaction` matters: a restore that fails halfway rolls back
entirely rather than leaving a half-restored database. `--clean --if-exists`
drops the existing objects first, so this **overwrites current data** — take a
fresh dump before running it, even of the broken state.

To recover only one table, add `--table=public.<name>` and drop `--clean`.

**What a dump does not restore.** `pg_dump --schema=public` covers the
application's own tables and functions. It does **not** include:

- `auth.users` — the accounts themselves. Losing that schema means every login
  breaks and `profiles.id` points at users who no longer exist.
- Storage objects (none currently — the legacy bucket was deleted 2026-08-30).
- Project settings: auth providers, the send-email hook, secrets.

For a whole-project loss, the accounts are the hard part, not the tables. That
is an argument for Pro rather than for a longer script.

## Recommendation

Upgrade to **Pro ($25/month)** and the backup problem largely goes away: daily
backups, 7-day retention, restore from the dashboard, and PITR available if it
ever becomes worth it. It also unblocks Supabase branching, which would give
the migrations workflow a real staging target instead of the dry-run gate it
uses today.

Until then, the manual dump above is the whole of the safety net, and it only
protects what someone actually remembers to run.
