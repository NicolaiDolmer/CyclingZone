# Postmortem · 2026-09-28 · Ungdomsløb kunne hverken ses eller udtages (#5843)

## Hvad skete der?
På løbsdag 1 i S4 kunne managers hverken se eller udtage til de 10 U23- og 10 juniorløb. Kalender- og Results-fanerne på U23/Junior-siderne var tomme, løbssiden sagde "Dette løb er i en anden division", og en AI-/late_fill-udtagelse kunne ikke ændres ("trup låst"). Samtidig stod 22 ryttere fra en forkert trup i kommende ungdomsløb.

## Root cause
1. `GET/PUT /races/:id/selection`, bulk, auto og afmelding hentede `races` uden `squad` og matchede løbets pulje mod holdets SENIORpulje. Ungdomsløb ligger i ungdomspuljer → altid "forkert pulje". Den trup-bevidste funktion (`teamInRaceSquadPool`, #5645) fandtes, men ruterne kaldte den ikke.
2. `promote()` (ungdom → senior) og RPC'en `move_academy_rider_squad` (junior ↔ U23) ændrede kun `riders.squad` og lod rytterens entries i den gamle trups kommende løb stå. Kun demote-RPC'en ryddede.
3. Kalender/Results var bevidst tomme tilstande fra v1 (#5631), mens patch 7.306 lovede ungdomsløb fra 28/9.

## Fix
PR #5869 (merge `7bea260`): `squad` i race-select + `teamInRaceSquadPool` i fem ruter; `moveRider` rydder off-squad entries (`backend/lib/squadEntryCleanup.js`); `YouthRacesTab` viser holdets ungdomsløb med rækken → eksisterende `/races/:id?tab=team`.

## Forhindret-fremover
- 3×3 trup-matrix-test i `raceSelection.test.js` (løbets trup × rytterens trup).
- `late_fill`-test: en senior havner aldrig i et U23-løb.
- Kilde-kontrakttest `apiYouthSelection.routes.test.js` på de fem ruter.
- E2E `5843-youth-race-selection.spec.ts` med seniorpulje ≠ ungdomspulje.
- "Ingen ungdomsgruppe" og "ingen løb" har hver sin tekst, så en tom fane kan diagnosticeres fra et skærmbillede.

## Læring
- En ny dimension (her `races.squad`) skal med i ALLE `select`s, der fodrer en trup-bevidst funktion. Helperen findes ikke før kalderne bruger den.
- En tilstandsændring (trup-flyt) skal rydde de afledte rækker i samme vej som den ændrer kilden; ellers bliver de hængende som "låste" data.
- Previews bruger prod-backenden (Railway). Backend-rettelser kan kun testes efter deploy; sig det før ejer-test.
- Tjek Supabase edge-loggen (hvilke kald browseren faktisk sendte), før man jagter en fejl, der ikke kan genskabes. Her viste den, at testen kørte en gammel build.
