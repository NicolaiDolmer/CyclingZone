# race_days_completed blev aldrig talt op (#804)

**Dato:** 2026-05-30
**Type:** Data-/logik-bug (manglende skrive-sti)

## Symptom
`seasons.race_days_completed` stod på 0 i prod (sæson 1, `active`) trods 11 afviklede løb (= 22 race-dage). Opdaget under planlægning af board-test-mode (#805), fordi board-auto-accept-flowet bygger på den tæller.

## Rod-årsag
Der fandtes **ingen skrive-sti** der talte `race_days_completed` op. Kode-søgning i `backend/**` fandt kun læsninger (`api.js`, `boardAutoAccept.js`, `boardMidSeason.js`), en test-fixture og docs. Resultat-import-stierne ([pcmResultsImport.js](../../backend/lib/pcmResultsImport.js), [raceResultsSheetSync.js](../../backend/lib/raceResultsSheetSync.js)) satte `races.status='completed'` men rørte aldrig sæson-tælleren. Counteren blev derfor stående på sit seed-tal (0).

## Konsekvens
- `boardAutoAccept` (T-3/T-1/auto-accept ved race_days 2/4/5) og `boardMidSeason` (midtsæson-banner ved midpoint) fyrede aldrig — begge hænger på counteren. Skjult af at board i øvrigt er gated bag `board_negotiation_state='locked'` i sæson 1.
- Dashboardets sæson-fremgang viste 0.

## Fix
Ny [seasonRaceDays.js](../../backend/lib/seasonRaceDays.js): `recomputeSeasonRaceDays` udleder tælleren fra sandheden — `SUM(stages over completede løb)` (ét race day = én etape; single=1, stage_race=stages, matcher `seasonRaceSelection.totalRaceDays` + `race_days_total`). **Recompute, ikke delta-increment** → idempotent ved re-import og robust over for flere completed-stier. Kaldt fra begge import-stier i `!dryRun`. Prod sæson 1 backfilled 0→22.

## Læring / forward-guard
- **Et felt der kun læses, aldrig skrives, er et rødt flag.** Når en counter/aggregat findes: grep eksplicit efter skrive-stien (`\.update\(\{ ... field`), ikke kun læsninger. Fraværet af et match er signalet.
- **Foretræk derived/recompute frem for delta-increment** for aggregater med flere skrive-stier — eliminerer drift og dækker fremtidige stier (fx kommende egen race-engine #676) gratis, så længe de sætter `status='completed'`.
- **Backwards-check:** ingen andre sæson-counters fundet uden skrive-sti ved denne gennemgang. Fremtidig race-engine skal kalde `recomputeSeasonRaceDays` (eller sætte completed-status, som helperen så afspejler).
