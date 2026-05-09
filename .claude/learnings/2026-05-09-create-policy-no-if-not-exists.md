# 2026-05-09 — CREATE POLICY mangler IF NOT EXISTS

## Hvad skete

Slice 09's migration `database/2026-05-09-race-pool.sql` blev anvendt på prod via Supabase MCP (`apply_migration`) under udvikling. Da PR #243 mergede, kørte `Auto-migrate`-workflow den samme migration igen — alle `CREATE TABLE/INDEX IF NOT EXISTS` og `ALTER ... ADD COLUMN IF NOT EXISTS` no-op'ed pænt med NOTICE, men `CREATE POLICY race_pool_public_read ON race_pool` fejlede med `ERROR: policy "race_pool_public_read" for table "race_pool" already exists`.

Workflow returnerede exit-kode 3, og siden migration-runner først INSERT'er i `schema_migrations` EFTER `psql -v ON_ERROR_STOP=1` succeeder, blev migrationen aldrig markeret som anvendt → ville fejle igen ved næste run.

## Root cause

Postgres understøtter ikke `CREATE POLICY IF NOT EXISTS` (i hvert fald ikke i den version Supabase kører). Det er asymmetri ift. `CREATE TABLE/INDEX IF NOT EXISTS` som har eksisteret længe.

Vi bruger to-step-pattern hvor migrationer ofte anvendes manuelt via MCP under udvikling og derefter skal være idempotent ift. Auto-migrate-workflow.

## Fix

Tilføj `DROP POLICY IF EXISTS <name> ON <table>;` FØR `CREATE POLICY` i alle fremtidige migrationer der opretter RLS-policies.

```sql
-- Idempotent pattern for RLS policies
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS my_policy ON my_table;
CREATE POLICY my_policy ON my_table FOR SELECT USING (true);
```

Hot-fix commit: [9577d99](https://github.com/NicolaiDolmer/CyclingZone/commit/9577d99).

## Hvad jeg burde have fanget tidligere

- Migration-filen blev ikke peer-reviewet for idempotency-patterns før den blev pushed
- Vi har ingen lint-regel der fanger `CREATE POLICY` uden foregående `DROP POLICY IF EXISTS`
- Vi har ingen automatiseret check der re-kører hver migration mod en clean+seeded test-DB for at fange den slags

## Forebyggelse

1. **Memory-entry tilføjet**: feedback_create_policy_idempotent — fremtidige sessions vil bruge DROP+CREATE-pattern
2. **Pattern-tjek i andre migrationer**: alle CREATE POLICY i `database/*.sql` bør auditeres for samme problem (ud af scope for denne læring; spawn separat task hvis relevant)
3. **Overvej migration-test i CI**: kør hver migration to gange mod en throwaway-DB for at fange manglende idempotency

## Læringer for AI

- Når jeg bruger `apply_migration` MCP-call under udvikling, SKAL migration-filen være safe at re-køre — Auto-migrate vil køre den igen ved push
- `IF NOT EXISTS` er ikke universelt; tjek per DDL-statement hvilke konstruktioner der understøtter det
- "Hot-fix" til migration er bedre end at hacke `schema_migrations`-tabellen direkte — koden følger med fremover
