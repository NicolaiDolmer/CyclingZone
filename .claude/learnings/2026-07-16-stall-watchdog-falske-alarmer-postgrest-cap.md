# Stall-watchdog fyrede falske etape-alarmer — PostgREST's 1000-rækkers cap (#2430)

**Dato:** 2026-07-16 (daglig Sentry/Railway-triage)
**Symptom:** `CYCLINGZONE-2G` "Stall-watchdog: stage stall (5)" eskalerede (31 events/3 dage),
`CYCLINGZONE-24` "stage stall (6)" (44 events/12 dage). Railway loggede `🚨 Stall-watchdog:
5 ny(e) tavs(e) stall(s) alarmeret` hver 3. time.

## Rod-årsag

`fetchWatchdogState` byggede `resultKeys` (hvilke etaper har resultater) med en **rå `.in()`
uden `.range()`**:

```js
supabase.from("race_results").select("race_id,stage_number").in("race_id", dueRaceIds)
```

PostgREST returnerer maks **1000 rækker** pr. select og **trunkerer tavst** — ingen fejl.
I prod stod der 7.277 race_results-rækker for de 5 forfaldne løb. Watchdogen så altså kun
~14% af dem → etaper der HAVDE resultater så resultat-løse ud → `has_entries && !has_results`
→ falsk "etape forfalden m. startfelt, ingen resultater importeret".

Uden `.order()` er række-rækkefølgen desuden vilkårlig mellem kald — derfor svingede
alarmen mellem 5 og 6 stalls (to separate Sentry-issues for samme ikke-eksisterende bug).

## Verifikation (prod, før fix)

Alle 10 forfaldne etaper havde `has_results = true` i databasen, mens watchdogen alarmerede
om 5 stalls. 7.277 rækker for 5 løb mod en cap på 1000.

## Fix

`fetchAllRaceRows`-helper i `stallWatchdog.js`: id-chunket + range-pagineret via den
kanoniske `fetchAllRows` fra `supabasePagination.js`, med **total sortering** (`.order("id")`
— unik nøgle, så ties ikke flytter rækker mellem sider). Anvendt på alle tre rå `.in()`-loads:
`race_results(anchors)`, `race_results(due-stages)`, `race_entries(due-stages)`.

## Læring

1. **Bug-klassen var allerede kendt og dokumenteret** — `supabasePagination.js`' egen header
   nævner PCM-matcheren (tabte 88% af ryttere) og updateStandings (38% underberegning);
   `api.js` har tre `fetchAll*`-helpers med samme advarsel (#1798/#1839). Watchdogen blev
   bare skrevet uden dem. **En helper forhindrer ikke bug-klassen — kun brugen af den gør.**
   Værd at overveje: en lint-regel/grep-gate mod `.in(` uden `.range(`/`fetchAllRows`.
2. **Ironien er pointen:** overvågningskoden selv havde den bug-klasse, den var bygget for at
   fange. Watchdogs skal holdes til samme standard som det, de overvåger — en falsk-alarmerende
   watchdog er værre end ingen, fordi den lærer folk at ignorere alarmer.
3. **"Verificér FØR claim" fangede den.** Triagen 15/7 konkluderede "throughput verificeret grøn,
   watchdog-alarm ikke motoren" — korrekt, men stoppede ved symptomet. Først da alarmen blev
   holdt op mod DB'ens faktiske tilstand (alle forfaldne etaper HAR resultater) blev
   modsigelsen synlig og mekanismen fundet.
4. **Regressionstest skal bevises.** Første version af testen passerede med den buggy kode —
   rækkelayoutet lagde begge etaper inden for de første 1000. En test der ikke fejler på den
   gamle kode beviser intet. Bevis-loopet (revert fix → test fejler → gendan fix → test passerer)
   er billigt og bør være standard ved regressionstests.
