# Live funktion-grants ≠ migration: Supabase default-privileges regranter anon EXECUTE efter reset

**Dato:** 2026-06-29
**Issue/PR:** [#1971](https://github.com/NicolaiDolmer/CyclingZone/issues/1971) / [PR #1982](https://github.com/NicolaiDolmer/CyclingZone/pull/1982)
**Klasse:** security (authorization) + migration-drift

## Symptom
Supabase security-advisor (0028/0029) flaggede at `apply_stage_result` — en `SECURITY DEFINER` write-RPC der bumper `races.stages_completed` og overskriver `race_results` — var EXECUTE-bar af `anon`. Verificeret mod live `routine_privileges`: `anon=EXECUTE` + `authenticated=EXECUTE` var faktisk til stede. Funktionen har ingen intern auth-guard → en uautoriseret PostgREST-kalder (offentlig anon-apikey i frontend-bundlen) kunne injicere/overskrive løbsresultater med selvvalgt `rank`/`points_earned`/`prize_money`.

## Hvorfor det var overraskende
Funktionens egen migration (`database/2026-06-21-stage-write-atomic-rpc.sql`) gjorde det **rigtige**:
```sql
REVOKE ALL ON FUNCTION public.apply_stage_result(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stage_result(...) TO service_role;
```
Alligevel havde live DB `anon`/`authenticated`. Ingen eksplicit `GRANT ... TO anon` fandtes nogen steder i repoet (grep ren).

## Rod-årsag
Supabase' prod-skema har `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated` (bekræftet i `.claude/learnings/2026-06-18-relaunch-rehearsal...md`). Når en funktion gen-oprettes ved en schema-restore/rebuild (flere reset/rebuild-operationer kørte 27-28/6), får `anon`/`authenticated` EXECUTE igen via default-privs — **selv om en tidligere migration eksplicit REVOKE'ede dem.** Per-funktion-REVOKE i en migration er altså ikke en permanent garanti; den kan nulstilles af en senere restore.

## Fix
REVOKE-only migration (`database/2026-06-29-secure-securitydefiner-rpc-grants.sql`) der fjerner `anon`/`authenticated` fra de over-eksponerede funktioner. `service_role` (backend) bevaret → race-afvikling upåvirket. Verificeret live efter auto-migrate.

## Lærdom / forward-guard
1. **Stol ikke på at en funktion-REVOKE i en migration "holder".** Efter enhver stor reset/rebuild/restore: kør grant-verifikationen (query i bunden af 2026-06-29-migrationen) og tjek advisoren.
2. **Live `routine_privileges` er source of truth, ikke migrationsfilen** — verificér grants mod prod, ikke mod hvad migrationen *burde* have sat (jf. [[feedback_runtime_verify_first]]).
3. **Robust beskyttelse for write-RPC'er** = intern `service_role`-guard i funktionsbody (overlever default-privilege-regrant), men kræver SQL-test mod ægte instans før ship — de mockede backend-tests fanger ikke en forkert guard på race-motoren.
4. Den ugentlige advisor-cron er nettet der fanger en regranted state mellem reset og næste audit.
