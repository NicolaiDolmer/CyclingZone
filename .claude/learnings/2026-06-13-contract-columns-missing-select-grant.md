# Postmortem: #1309 kontrakt-kolonner manglede SELECT-grant → "rider not found" i prod

**Dato:** 2026-06-13
**Severity:** P0 (hver rytter-profil viste "rider not found" i prod efter #1366-merge)
**Issue:** #1309 (kontrakt-data-seed), opdaget efter merge

## Symptom
Efter #1366 (#1309 kontrakt-data-seed) blev merget kunne ingen rytter-profil åbnes — siden viste
"rider not found" for HVER rytter. Hard-refresh hjalp ikke (vedvarende, ikke transient).

## Root cause
`riders` bruger en **kolonne-privilege-model** (#1162, `2026-06-10-riders-potentiale-column-privilege.sql`):
`REVOKE SELECT` på hele tabellen + `GRANT SELECT` kolonne-for-kolonne til `anon`/`authenticated`
(for at skjule `potentiale` server-side). #1309-migrationen tilføjede `contract_length` +
`contract_end_season` via `ALTER TABLE ADD COLUMN`, men **glemte at GRANT'e SELECT** på dem.
PostgREST (frontend, anon/authenticated) selecter kolonnerne i rytter-profil-queryen
(`RiderStatsPage.jsx:1092`, en blokerende `.single()`) → Postgres svarer
`ERROR: permission denied for table riders` → supabase-js giver `{data:null}` → `rider` = null →
`if (!rider) return notFound`.

Det ramte alle queries der selecter kontrakt-kolonnerne (rytter-profil, RidersPage, AuctionsPage, transfers).

## Hvorfor det blev misset
1. **Forgænger-migrationen ADVAREDE eksplicit** mod præcis dette ("FAIL-CLOSED for fremtidige
   kolonner ... nye læsbare kolonner kræver eksplicit GRANT SELECT i samme migration") — men
   advarslen lever kun i migrations-headeren, ikke i en CI-gate eller guardrail-tjekliste.
2. **Lokal/CI-verifikation fangede det ikke:** frontend-tests bruger Supabase-MOCKS (ingen ægte
   column-privileges); `node --test` + build + lint kører ikke mod en ægte DB med RLS/grants.
3. **Friske DB'er reproducerer ikke buggen** (#1162 kører dynamisk efter schema.sql og fanger
   kolonnen), så en dry-run-relaunch mod en frisk branch ville se grøn. Kun eksisterende DB'er
   (prod), hvor #1162 kørte før kolonnen fandtes, var ramt — en farlig blind vinkel.
4. Min "transient deploy-vindue"-hypotese var forkert; jeg verificerede den væk via postgres-logs
   ("permission denied for table riders", vedvarende) + `information_schema.column_privileges`.

## Fix
`GRANT SELECT (contract_length, contract_end_season) ON public.riders TO anon, authenticated;`
+ `NOTIFY pgrst, 'reload schema';` (jf. #1162-mønsteret). Anvendt som hotfix direkte i prod 13/6;
repo-migration: `database/2026-06-13-grant-select-contract-columns.sql`.

## Forebyggelse (forward-guard)
- **Regel:** når du tilføjer en player-facing kolonne til `riders` (eller enhver column-privilege-
  låst tabel — `rider_derived_abilities` har samme model), SKAL migrationen indeholde
  `GRANT SELECT (ny_kolonne) ... TO anon, authenticated` i SAMME migration. Skjult-info-felter
  grantes bevidst IKKE.
- **Pre-flight-tjek for `needs-contract`/DB-PR'er:** efter en `ALTER TABLE riders ADD COLUMN`,
  verificér `information_schema.column_privileges` for SELECT på den nye kolonne (eller kør en
  authenticated-rolle-select mod en branch der er klonet fra PROD — ikke kun en frisk DB).
- **Overvej en CI-gate:** assertér at alle ikke-skjulte riders-kolonner har SELECT for
  anon/authenticated (fanger fremtidig drift; relevant for #1308 akademi-MVP som tilføjer flere
  kolonner).
