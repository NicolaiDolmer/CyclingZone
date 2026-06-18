# Relaunch-rehearsal fangede 2 bugs som kode-PR'er + CI missede (18/6)

**Kontekst:** P4 relaunch-rehearsal (`run-relaunch-rehearsal.mjs`) mod disposabel Supabase preview-branch. To latente bugs der begge ville have ramt prod-relaunchen — ingen af dem fanget af unit-tests eller CI. Fix: [PR #1463](https://github.com/NicolaiDolmer/CyclingZone/pull/1463).

## Bug 1 (P0): ny finance-type i kode uden constraint-migration
`#1441` (anti-inflation, merged 17/6) tilføjede kode der indsætter `finance_transactions.type = 'upkeep'` (`economyEngine.js:658`), men **ingen migration udvidede `finance_transactions_type_check`**. Upkeep kører kun i `processSeasonStart` → fyrer først ved season-transition = selve relaunchen. Derfor:
- Kode-PR'en merged grøn (CI rører aldrig season-transition destruktivt mod aktiv sæson).
- Bug'en ville have crashet prod-apply **midtvejs** (efter legacy-retire + beta-reset, før transition fuldfører) = ikke-genoprettbart halvt-state.

**Mønster:** enum-lignende værdi tilføjet i kode, men DB-CHECK-constraintet glemt. **Forward-guard:** når du tilføjer en ny `type`/status-værdi der INSERT'es i en tabel med CHECK-constraint → grep constraintet + tilføj migration i SAMME PR. Overvej en test der asserterer `kode-brugte finance-typer ⊆ constraint-tilladte` (diff via `pg_get_constraintdef`).

## Bug 2: ny FK-tabel uden opdatering af reset-servicen
`#1308` (academy-MVP, 13/6) gav `academy_intake` en `NOT NULL` FK til `seasons` (ingen `ON DELETE`), men `betaResetService.resetBetaSeasons` blev ikke opdateret → enhver beta-reset efter academy-intake har kørt fejler på FK. Eksponeret af rehearsalens founder-survival-sub-test.

**Mønster:** ny tabel med FK til en hyppigt-wiped parent (`seasons`), men reset-/teardown-stien ikke opdateret. **Forward-guard:** når du tilføjer en FK til `seasons` (eller anden reset-target), opdatér `resetBetaSeasons` (slet eller null'er afhængigt af nullability).

## Meta-læring
**Den destruktive ende-til-ende-rehearsal er det eneste der fangede begge.** Begge bugs lever i season-transition-stien, som hverken unit-tests eller CI eksekverer destruktivt. Bekræfter investeringen i `run-relaunch-rehearsal.mjs` + simulér-før-ship. Kør ALTID rehearsal mod en prod-tro branch før enhver destruktiv prod-orchestrering.

## Operationelle noter (branch-provisionering, for næste rehearsal)
- Preview-branch kommer op `MIGRATIONS_FAILED` med 0 public-tabeller for dette repo (prod-skema er delvist manuelt-applied). Spejl via cached `pg_dump` + `psql` (psql 18 håndterer `\restrict` nativt).
- Dump-headerens `\restrict`/`\unrestrict` (pg_dump-18-nonce) trigger secret-sanitize-hooket → cat ALDRIG den rå dump; brug `tail -n +N | grep -v unrestrict`.
- Prod-skema har custom rolle `codex_readonly` + `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` der fejler på branch → `CREATE ROLE codex_readonly NOLOGIN` først; default-priv-linjerne fejler på "permission denied" (irrelevant, kun fremtidige objekter).
- Branch-nøgler: `supabase branches get <navn> --project-ref <PROD-ref> -o env` → temp-fil, ekstrahér via `grep|sed` til shell-var (aldrig echo). Brug `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT), ikke ny `sb_secret` (401 mod PostgREST).
- Re-seed efter delvist apply: `reset-branch.sql` (TRUNCATE public CASCADE + DELETE auth.users) → re-kør `seed-relaunch-rehearsal.sql` → verificér baseline.
