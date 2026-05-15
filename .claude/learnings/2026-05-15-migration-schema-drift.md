# Migration-drift: `schema.sql` kan dublere `database/*.sql` migration-applikation

**Dato:** 2026-05-15
**Trigger:** Auto-migrate fejlede (run 25936029315) efter #392 merge fordi `board_plan_snapshots_board_season_unique` constraint allerede eksisterede på prod.
**Fix:** [#400](https://github.com/NicolaiDolmer/CyclingZone/pull/400) — wrap `ADD CONSTRAINT` i `DO $$ ... pg_constraint`-check så migrationen er idempotent.

## Root cause

#392 lavede 3 ting:

1. Tilføjede `database/2026-05-15-board-snapshots-unique.sql` (timestamped migration)
2. Spejlede constraint i `database/schema.sql` ("authoritative schema")
3. Spejlede constraint i `database/supabase_setup.sql` ("bootstrap init")

Auto-migrate-workflowet kører kun #1 og bookkeeper i `schema_migrations`-tabellen. Men `schema.sql` / `supabase_setup.sql` kan være applied tidligere som en separat init-step (manuelt eller via en bootstrap-flow) — så constraint var **allerede aktiv på prod** før timestamped migration kørte. `ADD CONSTRAINT` uden `IF NOT EXISTS`-check → `relation already exists` → exit 3.

DELETE-step kørte fint (0 dubletter), så DB-state var korrekt; det var kun migration-bookkeeping der manglede entry.

## Fix-pattern (gælder fremover)

Hver `database/2026-*.sql`-migration der laver schema-ændring bør være idempotent — fordi vi ikke kan stole på at `schema.sql`/`supabase_setup.sql` ikke allerede har applied den. Mønstre:

- `CREATE TABLE IF NOT EXISTS …` (PostgreSQL native)
- `CREATE INDEX IF NOT EXISTS …` (PostgreSQL 9.5+)
- `ADD COLUMN IF NOT EXISTS …` (PostgreSQL 9.6+)
- For `ADD CONSTRAINT` (ingen `IF NOT EXISTS`): wrap i `DO $$ ... pg_constraint`-check:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'my_constraint_name'
      AND conrelid = 'my_table'::regclass
  ) THEN
    ALTER TABLE my_table ADD CONSTRAINT my_constraint_name UNIQUE (col_a, col_b);
  END IF;
END $$;
```

## Forward-guard

Issue oprettes for at undersøge om vi skal:

- Stoppe med at spejle schema i `schema.sql` / `supabase_setup.sql` (lade dem være rene init-snapshots, ikke "authoritative")
- ELLER tilføje en CI-linter der kræver at hver `database/2026-*.sql` bruger idempotent patterns

Indtil da: **review hver ny migration mod idempotency-checklist før merge.**

## Læring i kommunikationsform

"Hvis state-ændringen er udtryk i flere kilder (timestamped migration + schema.sql), skal migrationen være idempotent — ellers er prod-state og bookkeeping uafhængige spor der kan komme ud af sync."
