# 2026-06-18 · Grøn migration-PR ≠ migration anvendt i prod (#1451/#1452/#1454)

## Symptom
PR #1452 (board-læsbarhed) havde alle PR-checks grønne og blev squash-merged. Men `board_satisfaction_events`-tabellen fandtes IKKE i prod bagefter — feature-koden var live, men dens tabel manglede.

## Rod-årsag
Migration-apply sker IKKE som en PR-check. Den kører i en **separat workflow (`Auto-migrate`) der trigges EFTER merge til main** (`on push`, `database/2026-*.sql`). Den fejlede på `FATAL: password authentication failed for user "postgres"` mod prod-pooleren — GitHub Actions-secret'en `DB_URL` havde et **stale/forkert password** (sandsynligvis prod-DB-password roteret uden at secret'en blev opdateret). Forbindelsen fejlede før nogen SQL kørte → 0 migrationer anvendt, men PR'en så 100% grøn ud (apply er ikke en branch-protection-check).

## Fix (hot-fix + rod)
- **Hot-fix:** anvendt migrationen manuelt via Supabase-management-API (MCP `apply_migration` — uafhængigt af postgres-passwordet, virker når SQL-pooler-auth er nede) + indsat filnavnet i `public.schema_migrations` så Auto-migrate ikke gen-applier den. Verificeret: tabel + 14 kolonner + 3 indexes.
- **Rod (ejer):** #1454 — opdatér `DB_URL`-secret. Bemærk prod-Infisical `SUPABASE_DB_URL` VIRKER (brugt til backup + skema-dump samme dag), så den stale værdi er specifik for GitHub-secret'en.

## Forward-guards
1. **Efter merge af enhver `database/*.sql`-PR: verificér at tabellen/ændringen faktisk findes i prod** (`to_regclass(...)` / kolonne-tjek via MCP). Stol ikke på at grønne PR-checks = migration anvendt — apply er en post-merge-workflow, ikke en check.
2. **Migration-apply mod prod kan ske via to uafhængige kanaler:** (a) `psql` med DB-password (Auto-migrate, prod-Infisical `SUPABASE_DB_URL`), (b) Supabase-management-API (MCP `apply_migration`). Hvis (a)'s password-auth er nede, virker (b) stadig — nyttig recovery-vej.
3. Når en CI-secret driver en out-of-band prod-handling (migration, deploy), vil drift i den secret fejle STILLE relativt til PR-status. Verificér effekten, ikke kun PR-farven.
