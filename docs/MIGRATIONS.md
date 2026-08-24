# Migrations — idempotency rule (#401)

> Forward-state of prod is **replayed** from `database/2026-*.sql` by
> [`.github/workflows/auto-migrate.yml`](../.github/workflows/auto-migrate.yml)
> (applied files tracked in the `schema_migrations` table). Every new migration
> must be **idempotent**: re-running it is a no-op, not an error.

## Why this matters

A non-idempotent migration crashes on any **re-run**:

- **Recovery replay** — a migration partially fails (`psql ON_ERROR_STOP=1`
  aborts mid-file), the `schema_migrations` row never lands, and the next run
  re-applies the whole file. If the first statement that already succeeded is a
  bare `CREATE TABLE`, the re-run dies on "relation already exists".
- **Fresh rebuild** — standing up a clean DB by replaying the full migration log.
- **Manual hot-fix** — applying a file by hand, then letting auto-migrate run it.

This is not hypothetical. The `2026-05-22-rls-permissive-policy-lockdown.sql`
migration shipped a `CREATE POLICY` with no preceding `DROP POLICY IF EXISTS`,
failed on its first replay, the `schema_migrations` row never landed, and the
drift sat for days until the weekly liveness audit caught it
(see [`docs/MIGRATIONS_AUDIT_2026-05.md`](MIGRATIONS_AUDIT_2026-05.md) §1).

`database/schema.sql` and `database/supabase_setup.sql` are **bootstrap /
disaster-recovery snapshots** — they are kept, not replaced by this rule.

## The rule

Every `CREATE …` / `ALTER … ADD …` in a new `database/2026-*.sql` migration must
carry an idempotency guard. The CI guard
[`scripts/lint-migration-idempotency.mjs`](../scripts/lint-migration-idempotency.mjs)
enforces it (job `migration-idempotency` in `ci.yml`, and at commit time via
`lint-staged`).

| DDL | Idempotent form |
|-----|-----------------|
| `CREATE TABLE` | `CREATE TABLE IF NOT EXISTS …` |
| `CREATE INDEX` / `CREATE UNIQUE INDEX` | `CREATE [UNIQUE] INDEX IF NOT EXISTS …` |
| `CREATE SEQUENCE` | `CREATE SEQUENCE IF NOT EXISTS …` |
| `ALTER TABLE … ADD COLUMN` | `ADD COLUMN IF NOT EXISTS …` (on **every** add) |
| `CREATE TYPE` | wrap in a `DO` block (Postgres has no `CREATE TYPE IF NOT EXISTS`) |
| `ALTER TABLE … ADD CONSTRAINT` | `DROP CONSTRAINT IF EXISTS …` first, **or** a `DO`-block guard (no `ADD CONSTRAINT IF NOT EXISTS`) |
| `CREATE POLICY` | `DROP POLICY IF EXISTS …` first (RLS policies have no `IF NOT EXISTS`) |
| `CREATE TRIGGER` | `CREATE OR REPLACE TRIGGER …`, **or** `DROP TRIGGER IF EXISTS …` first |

Already-idempotent and therefore fine: `CREATE OR REPLACE FUNCTION/VIEW/…`,
`CREATE EXTENSION IF NOT EXISTS …`, `CREATE VIEW IF NOT EXISTS …`,
`DROP … IF EXISTS …`, plain `INSERT … ON CONFLICT DO NOTHING`, `UPDATE`, etc.

## Recipes

### CREATE TYPE (enum)

```sql
DO $$ BEGIN
  CREATE TYPE rider_role AS ENUM ('leader', 'domestique', 'sprinter');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

### ADD CONSTRAINT (drop-first — preferred when you want the latest definition)

```sql
ALTER TABLE transfer_offers DROP CONSTRAINT IF EXISTS transfer_offers_status_check;
ALTER TABLE transfer_offers ADD CONSTRAINT transfer_offers_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'window_pending'));
```

### ADD CONSTRAINT (pg_constraint guard — preferred when you must NOT re-validate)

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_profiles_team_id_plan_type_key'
  ) THEN
    ALTER TABLE board_profiles
      ADD CONSTRAINT board_profiles_team_id_plan_type_key UNIQUE (team_id, plan_type);
  END IF;
END $$;
```

### CREATE POLICY

```sql
DROP POLICY IF EXISTS academy_intake_owner_read ON academy_intake;
CREATE POLICY academy_intake_owner_read ON academy_intake
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
```

### CREATE TRIGGER

```sql
DROP TRIGGER IF EXISTS reject_late_bid ON auction_bids;
CREATE TRIGGER reject_late_bid BEFORE INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION reject_late_auction_bid();
```

## DO-block escape hatch

DDL emitted **inside** a `DO $$ … $$` block is treated as already-guarded — the
block is your idempotency mechanism (a `pg_constraint`/`pg_type` existence check,
or `EXCEPTION WHEN duplicate_object`). The guard never flags DDL inside a
DO-block, so this is the catch-all for anything the table above doesn't cover.

## Historical whitelist

A handful of migrations shipped before this guard existed and are legitimately
non-idempotent (one-shot backfills, `DROP CONSTRAINT` without `IF EXISTS`, a
`CREATE POLICY` with no drop). They are parked in the `WHITELIST` constant in
`scripts/lint-migration-idempotency.mjs` with a per-file reason. The owner
decision (#401) is to **not rewrite shipped history** — those files already live
in `schema_migrations` (auto-migrate skips applied files), so re-runnability is
moot for them.

**Do not add new migrations to the whitelist.** Fix the DDL instead. The
whitelist is for closing the gap on history, not a bypass for new work.

## Local commands

```bash
npm run lint:migrations        # run the guard over database/2026-*.sql
npm run test:lint-migrations   # unit tests for the guard
```

Both run in CI (`migration-idempotency` job in `.github/workflows/ci.yml`); the
guard also runs at commit time via `lint-staged` on staged `database/*.sql`.

Refs [#401](https://github.com/NicolaiDolmer/CyclingZone/issues/401).

---

## Constraint form: recreate the FULL definition (#4163)

Idempotency asks *"can this migration run again?"*. There is a second, orthogonal
question a migration must answer: *"does it recreate the object in the **right
form**?"*

A migration that drops a constraint to rewrite data underneath it — a legitimate,
common pattern — must give it back **exactly as it was**. Dropping
`no_rider_double_booking` and re-adding it without `deferrable initially immediate`
is not a cosmetic difference: the batch RPC `apply_race_entry_unit_batch` (#3934)
opens with `set constraints … deferred`, and without deferrability Postgres answers
`42809`. The entry-generator sweep then falls back to per-unit insert-before-delete
and every rider swap between two overlapping races becomes a deterministic deadlock.

That is exactly what happened on 24/8-2026 (#4163): the #4155 calendar repair
recreated the constraint without the clause, and the sweep failed 116-140 units per
tick in the hours before the season's first race day. Its post-verify asked
`select conname from pg_constraint …` — existence, not form — and saw precisely what
it asked for.

**Rules**

1. Before dropping, capture the definition: `select pg_get_constraintdef(oid) …`.
   Compare it afterwards. Do not compare `conname`.
2. Post-verify the **form**: for this constraint, `condeferrable = true`. Assert it
   inside the same transaction so a half-restore rolls back.
3. A migration may never leave a critical guard down: drop and re-add belong in the
   same file.

`scripts/lint-constraint-form.mjs` enforces 1 and 3 statically over `database/*.sql`
(commit hook, preflight, and CI). Constraints whose form carries an operational
guarantee are registered in `CRITICAL_CONSTRAINTS` with a `why` that says what
breaks without the clause. Already-shipped files that predate the rule live in
`REMEDIATED`, each naming the migration that repaired it — the same
"don't rewrite history, document it" policy as the idempotency whitelist.

```bash
npm run lint:constraint-form        # run the guard over database/*.sql
npm run test:lint-constraint-form   # unit tests, incl. proof it catches #4155
```

Refs [#4163](https://github.com/NicolaiDolmer/CyclingZone/issues/4163),
[#4155](https://github.com/NicolaiDolmer/CyclingZone/issues/4155),
[#3934](https://github.com/NicolaiDolmer/CyclingZone/issues/3934).
