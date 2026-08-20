# 2026-08-20 · Zombie-deploy gav dobbelt stage-scheduler; UI lækkede rå UUID'er

## Hvad skete der

Ved 18:00-starterne kørte TO backend-instanser samtidig på Railway — `b95e1d0be53f`
(release 5c8710ebb, nyeste) og `ffdc1690e9cf` (release 7611435e4, forrige deploy,
app_start 14:58 og altså aldrig stoppet). Begge kørte stage-scheduler-sweepet og
udvalgte de samme due etaper ud fra hvert sit snapshot. #2090-stale-tick-guarden
409'ede 11 forsøg — ingen etape kørte dobbelt (verificeret: 1 vinder pr. etape,
0 dublet-ranks i race_results). Sentry: CYCLINGZONE-4K.

Samtidig afslørede ejerens screenshot en frontend-følgefejl: Race Centre-live-
kortenes filmlinje viste rå rytter-UUID'er, fordi `riderNameById` kun blev bygget
af dagens FÆRDIGE etapers top-3 — og `stageTimelineFilm.js`-fallbacken var
`String(id)`.

## Rod-årsager

1. **Cross-process-hullet:** overlap-guarden (#2090) er et in-process-flag; to
   containere deler det ikke. Vinduet mellem "læs stages_completed" og "bump" er
   minutter (simuleringens varighed) — to instanser kan begge nå forbi guarden.
   Kun heldig timing + stale-tick-409'eren reddede os.
2. **Guard-skips capturede som error:** et velfungerende skip lignede en hændelse
   i Sentry (11 error-events) og kostede ejer-opmærksomhed.
3. **UI-fallback der lækker interne id'er:** "vis noget frem for intet" blev til
   "vis det rå id" — værre end at skjule linjen.

## Fixes (#4026)

- `race_stage_claims`-tabel + atomisk claim (insert ON CONFLICT DO NOTHING,
  15-min lease, CAS-steal, release ved sim-fejl) i `runAdminSimulateStage` —
  eneste guard-lag der også dækker to instanser. `claimed_by` = hostname, så en
  zombie-instans nu er synlig direkte i loggen/tabellen.
- Claim-miss + stale-tick markeres `benign` → scheduleren info-logger
  (`stage_scheduler_race_skipped`) uden Sentry-capture; ægte fejl captures som før.
- `describeEvent` skipper linjer den ikke kan navngive (aldrig rå id'er);
  Race Centre henter tidslinjens navne via `collectRiderIds` + `useRiderNames`.

## Læringer

- **In-process-guards beviser ikke single-flight i et deploy-miljø.** Alt der må
  køre præcis én gang pr. (entitet, trin) skal claimes i DB'en, ikke i processen.
- **Forventede guard-skips skal logges som info, ikke captures som error** — ellers
  drukner ægte hændelser, og guarden "råber ulv".
- **UI-fallbacks må aldrig vise interne id'er.** Ærlig degradering = skjul linjen.
- Åbent spørgsmål (observeres via claimed_by): hvorfor levede den gamle Railway-
  container >1 time efter ny deploy. Gentager det sig → separat issue på restart-/
  overlap-politik.
