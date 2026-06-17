# DB backup + verify-restore tooling

Verifiable logical backups of the Supabase/Postgres database, for use before any
irreversible production operation (notably the season-1 relaunch reset, which hard-
DELETEs a live season with no in-code undo — see
`docs/superpowers/specs/2026-06-17-relaunch-hybrid-engine-1307-design.md` §3/P3).

> A backup that has never been restored is an assumption, not resilience. These two
> scripts make the backup **verified**: dump it, then prove it restores and that the
> row counts match the source.

## Scripts

| Command | What |
|---|---|
| `npm run db:backup` | `pg_dump -Fc` of the target schema(s) → `BACKUP_DIR/cyclingzone-<ts>/{data.dump,manifest.json}`. Keeps column-level GRANTs, drops owner. Captures exact per-table row counts + dump sha256 + ACL-entry count into the manifest. Runs via `infisical run --env=prod`. |
| `npm run db:verify-restore` | Spins up a throwaway local Postgres, restores the latest (or `--dir`) backup into it, compares row counts vs the manifest and runs FK-integrity checks. No Docker, no cloud, no prod risk. |
| `npm run db:selftest` | End-to-end proof of the tooling against a seeded local DB. ~12 s. No prod access needed. |

## Prerequisites

- **PostgreSQL client/server binaries** (`pg_dump`, `pg_restore`, `psql`, `initdb`, `pg_ctl`).
  Installed via `scoop install postgresql` (currently 18.4 — a newer client dumping the
  PG17 server is supported and recommended). Scripts auto-resolve them from the scoop app
  dir; override with `PG_BIN=<dir>`.
- **`SUPABASE_DB_URL`** in the prod Infisical env (for `db:backup`). This is the only piece
  not yet wired — see below. `db:verify-restore` and `db:selftest` need no secret.

### Wiring `SUPABASE_DB_URL` (one-time, owner)

The raw Postgres connection string is **not** in Infisical yet (only `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY`, which pg_dump cannot use). To enable autonomous backups:

1. Supabase Dashboard → project `ghwvkxzhsbbltzfnuhhz` → **Connect** → **Session pooler**.
2. Copy the URI (`postgresql://postgres.<ref>:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`),
   fill in the database password.
3. Add it to the **prod** Infisical env as key `SUPABASE_DB_URL`.

The session pooler (port 5432) is pg_dump-compatible; the transaction pooler (6543) is not.
Credentials are passed to child processes via `PG*` env vars — never on argv, never printed.

## Usage before a destructive prod op

```sh
# 1. take a verified backup off-site (point BACKUP_DIR at OneDrive)
BACKUP_DIR="/c/Users/Nicolai/OneDrive/.../cz-backups" npm run db:backup

# 2. prove it restores (allow small drift on a live DB via BACKUP_COUNT_TOLERANCE)
BACKUP_DIR="/c/Users/Nicolai/OneDrive/.../cz-backups" npm run db:verify-restore
```

Scope defaults to the `public` schema — exactly the data the relaunch reset destroys
(seasons/races/standings/finance/loans/...). `auth` and `storage` are Supabase-managed and
covered by PITR/physical backups, not this logical dump. Override with `BACKUP_SCHEMAS`.

## Notes / caveats

- **Snapshot consistency:** counts are captured immediately before the dump in a separate
  transaction. On a live DB, high-churn tables may drift a few rows — run the backup in a
  low-activity window and use `BACKUP_COUNT_TOLERANCE` for the verify.
- **Cross-version replay:** the dump restores cleanly into the local verify instance (same
  major version) and into a Supabase target with the same/newer Postgres. PITR remains the
  primary same-project recovery path; this logical dump is the independently inspectable
  secondary.
- Relates to the restore-drill runbook (`docs/RUNBOOK_RESTORE_DRILL.md`, #332) and the
  backup-confirmation item #375. This is the missing automation those describe manually.
