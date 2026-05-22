# Migrations Safety Audit — 2026-05-22 (#548 Del 3)

> **Issue:** [#548](https://github.com/NicolaiDolmer/CyclingZone/issues/548). **Related:** [`docs/RLS_AUDIT_2026-05-22.md`](RLS_AUDIT_2026-05-22.md) (Del 1+2).

## Scope

Review af 66 migrations i `database/2026-05-*.sql` (sidste 30 dage). Issue body's specifikke spørgsmål:

1. Skema-konsistens mod `database/schema.sql` (#401 follow-up)
2. Backwards-compat på UPDATE/ALTER statements
3. Idempotency på re-run
4. CHECK-constraints på `transfer_windows` — dækker de racing-window-invariant fuldt?

## Metode

- Subagent-baseret pattern-survey (CREATE TABLE without IF NOT EXISTS, ALTER without DEFAULT, etc.)
- Deep-dive på flagget filer (specifikt `2026-05-22-season-loop-rollback-additions.sql`)
- Skema-drift check via filsystem-timestamp + scope-overlap med #401

## Findings

### 1. Idempotency — ✅ PASS

Alle 66 migrations bruger idempotente patterns:
- 11× `CREATE TABLE IF NOT EXISTS`
- 15+× `CREATE INDEX IF NOT EXISTS`
- 3× `DROP POLICY IF EXISTS` før `CREATE POLICY` (auction-proxy, app-config, discord-settings)
- 6× `DO $$ ... $$` blocks med admin_log/schema_migrations idempotent guards
- 25× explicit `BEGIN;` / `COMMIT;` transaktionsgrænser

**Ny migration `2026-05-22-rls-permissive-policy-lockdown.sql` fejlede første replay** pga. manglende `DROP POLICY IF EXISTS "Admins can read all users"` — fixet i commit `4efaabe`. Forward-guard: alle nye policies skal DROP IF EXISTS før CREATE, ikke kun de policies der droppes som del af migrationen.

### 2. Backwards-compat — ✅ PASS

- Ingen `ALTER TABLE ... ADD COLUMN ... NOT NULL` uden `DEFAULT` fundet
- 1× `DROP COLUMN`: `2026-05-04-salary-generated-column.sql` — column erstattet med `GENERATED STORED` (kommentar bekræfter code-paths fjernet)
- Ingen column-renames detekteret
- 1× `ALTER COLUMN ... NULL` (`2026-05-21-admin-log-nullable-user.sql`): tilladelig — relaxer constraint

### 3. Concurrency protection — ✅ PASS

| Migration | Pattern | Status |
|---|---|---|
| `2026-05-07-economy-idempotency.sql` | `pg_advisory_xact_lock(team_id)` | ✅ Lock per team_id |
| `2026-05-09-balance-rpc.sql` | Lock + UPDATE + INSERT atomisk | ✅ |
| `2026-05-21-season-loop-rollback.sql` | Explicit `BEGIN;`/`COMMIT;` + admin_log audit | ✅ |
| `2026-05-22-season-loop-rollback-additions.sql` | `BEGIN;` + `DO $$` + admin_log idempotent guard | ✅ (note nedenfor) |
| `2026-05-20-fix-uci-translit-mismatches.sql` | UPDATE 45 riders + INSERT history; historisk data, ingen contention | ✅ |

**Note on `2026-05-22-season-loop-rollback-additions.sql`:** Migration har idempotent guard (skipper hvis `cleanup_phase='loans_rest_correction'` allerede findes i admin_log). Den har IKKE `LOCK TABLE loans / teams` eller `pg_advisory_xact_lock` på de affecterede tabeller under UPDATE.

Issue body's bekymring: "ikke transaktionelt atomisk — bør have `LOCK TABLE` eller `pg_advisory_xact_lock` hvis genbrugt som template".

**Konklusion:** Acceptabelt for én-gangs forensisk cleanup (idempotent-guard forhindrer re-run). MEN hvis filen bruges som template for fremtidige rollback-script, bør den udvides med `LOCK TABLE loans, teams IN EXCLUSIVE MODE` før UPDATE-statements for at undgå contention med cron-jobs.

### 4. CHECK-constraints på transfer_windows — ✅ DOKUMENTERET, hardening tilbage

`2026-05-22-transfer-window-racing-guard.sql` tilføjede 2 forward-guard CHECK constraints (v3.86-incident-postmortem):

```sql
CHECK (final_whistle_sent_at IS NULL OR closed_at IS NOT NULL)
CHECK (squad_enforcement_completed_at IS NULL OR closed_at IS NOT NULL)
```

**Issue body's spørgsmål:** "Skal udvides til at dække racing-window-invariant fuldt?"

**Status:** De 2 constraints dækker det specifikke symptom fra v3.86-incidenten (final_whistle og squad_enforcement uden closed_at). En "fuld racing-window-invariant" ville kræve yderligere:

- `CHECK (opened_at IS NULL OR closed_at IS NULL OR opened_at < closed_at)` — temporal ordering
- Exactly-one-active-window-per-season constraint (kunne være `EXCLUDE USING gist` eller partial unique index på `season_id WHERE closed_at IS NULL`)
- Ordering på phase transitions (opened → flash-bid → final_whistle → squad_enforcement → closed)

**Recommendation:** Followup-issue for fuld invariant-coverage (P3 hardening, ikke kritisk efter v3.86 fix).

### 5. Schema consistency vs database/schema.sql — ⏸ Out-of-scope

`database/schema.sql` sidst opdateret 2026-05-20 (488 linjer). Migrations fra 2026-05-21 og 2026-05-22 (incl. denne audit's egen migration) er ikke endnu reflekteret i schema.sql.

Dette er **#401's scope** (schema drift forward-guard) — out of scope for #548. Noteret som ventet follow-up.

## Anbefalede actions

| # | Action | Severity | Tracking |
|---|---|---|---|
| 1 | (Ingen P0/P1 fund i migrations) | — | — |
| 2 | Hvis `season-loop-rollback-additions.sql` genbruges som template → tilføj `LOCK TABLE loans, teams` | P3 future-template | Note her |
| 3 | Udvid `transfer_windows` CHECK-constraints med temporal-ordering + exclusion-constraint for fuld racing-window-invariant | P3 hardening | Followup-issue TBD |
| 4 | Opdatér `database/schema.sql` med 2026-05-21 + 2026-05-22 migrations | P3 doc-drift | #401 |
| 5 | Idempotency-postmortem for nye RLS-policies (DROP IF EXISTS før CREATE for ALLE policies, ikke kun droppede) | P3 lesson | Indlejret her |

## Konklusion

**Ingen P0/P1-fund i recent migrations.** Migration-corpus følger safe patterns konsistent. Eneste reelle issue var en idempotency-bug i denne audit's egen migration, som blev fanget af auto-migrate workflow og fixet hurtigt (commit `4efaabe`).

De resterende anbefalinger (P3) er minor template/hardening-forslag — ikke blockers for at lukke #548.
