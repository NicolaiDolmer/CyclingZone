# Postmortem · 2026-08-05 · race_results manglede unik nøgle + atomisk skrivning (#3022, #1847)

## Hvad skete der?
`race_results` (spillets point/præmie/ranglisters kilde) havde ingen unik nøgle og to skrivestier (fuld-løbs-simulering + PCM-import) delte stadig et delete-then-insert over TO separate HTTP-kald, ikke én transaktion. #1847's "247 orphaned rows" (NULL rider_id efter rytter-sletning) og #3022's "40.902 rækker ville bryde en naiv unik nøgle" var begge målt for 1-2 uger siden — begge tal havde ændret sig markant siden.

## Root cause
1. **Ingen unik nøgle:** kun app-lags-disciplin (slet-før-insert + fejltjek, #2898/#2974) forhindrede dubletter. Et hårdt proces-kill mellem delete og insert (crash-vindue, ikke en kodefejl) kunne stadig efterlade et løb resultatløst.
2. **Den "oplagte" nøgle virker ikke:** `UNIQUE (race_id, stage_number, result_type, rider_id)` kolliderer massivt, fordi AI-hold løbende slettes/regenereres og `rider_id`/`team_id` har `ON DELETE SET NULL`. Målt mod prod 2026-08-05 (10 dage efter issue-tallet): **710.397 rækker i alt, 225.947 (31,8 %) med `rider_id IS NULL`** — op fra 40.902 (2026-07-26) og 247 (issue-titlen, juni). Churnen er kontinuerlig (~10-15k/dag), ikke en engangs-læk. 100 % af orphans er AI-hold, 0 rigtige hold, 0 kr. reelt tab (allerede fastslået i #1847's tredje kommentar 2026-07-16, PR #2481).

## Fix
- **`entrant_key`** (genereret kolonne): rider_id/team_id når sat, ellers `lower(btrim(rider_name/team_name))`-fallback. ALDRIG NULL → almindelig `UNIQUE` er nok, `NULLS NOT DISTINCT` unødvendig. **0 kollisioner mod ALLE 710.397 rækker** (verificeret med `execute_sql` mod prod, read-only) — ingen DELETE-oprydning nødvendig, kun arkitekturændringen.
  `database/proposals/2026-08-05-race-results-entrant-key-unique-constraint.sql`
- **`apply_race_results_batch`**-RPC: samler delete-af-berørte-etaper + insert i én transaktion for fuld-løb/PCM-stien (samme mønster som #1598's `apply_stage_result` for per-etape-stien).
  `database/proposals/2026-08-05-race-results-batch-write-atomic-rpc.sql`
- `backend/lib/raceRunner.js::simulateRace()` og `backend/lib/pcmResultsImport.js::importPcmResults()`: fjernet det separate `.from("race_results").delete()`-kald, sender nu `stageNumbers` til `applyRaceResults()`, som internt bruger RPC'en atomisk.
- `backend/lib/raceResultEntrantKey.js`: delt JS/SQL-kilde-til-sandhed + `assertValidEntrantRows` — afviser en batch FØR databasen (deltager-løs række eller intern kollision) med et forklarende budskab.
- Bevist mod en ægte Postgres-motor (PGlite, ikke mock): `backend/lib/testdb/raceResultsEntrantUnique.integration.test.js` kører de ÆGTE migrations-filer og beviser constrainten afviser både ægte dubletter OG orphan-navne-kollisioner, samt at RPC'en ruller HELE batchen tilbage ved fejl.

## Forhindret-fremover
1. DB-constraint (kan aldrig omgås af en fremtidig kode-bug).
2. JS-forward-guard (`assertValidEntrantRows`) i begge atomiske RPC-wrappere — venligt budskab før et koldt `unique_violation`.
3. PGlite-integrationstest beviser SQL-filen virker, ikke kun "ser rigtig ud".
4. Eksisterende `verify-invariants.js`-dubletcheck (fra #2974/#2898) er uændret og forbliver et sikkerhedsnet.

## Læring
**"Målt for N uger siden" er ikke "målt nu" i en tabel med kontinuerlig churn.** Issue #3022's 40.902-tal og #1847's 247-tal var begge stale — de reelle tal var 6× og 900× højere. Havde jeg designet mod issue-tallene uden at genmåle, ville jeg have bygget en constraint der IKKE kunne appliceres (4.248 kolliderende grupper i dag). Genmål ALTID mod prod lige før du designer en constraint på en tabel der ændrer sig løbende — "verificér før du claimer" gælder også egne tidligere issue-kommentarer, ikke kun andres.

Sekundær læring: en "naiv" fix (FK-baseret unik nøgle) der virker på papiret kan være uigennemførlig i praksis, mens en lidt mere gennemtænkt nøgle (identitet med fallback, ikke bare FK) løser BÅDE uniqueness- og orphan-historik-problemet i samme greb, uden at skulle vælge mellem dem.
