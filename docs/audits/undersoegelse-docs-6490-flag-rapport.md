# Undersoegelse: flag training_peak_from_ticks_6490 (#6490)

Dato: 2026-11-26. Spor: undersoegelse (kind: investigate). Ingen kodeaendringer, ingen prod-skrivning.

## Spoergsmaal
Er flaget `training_peak_from_ticks_6490` klar til at blive taendt, eller skal det slettes?

## Hvad koden bag flaget goer
- Flaget styrer kun `loadTeamTrainingRuns` i `backend/lib/racePeakPlans.js` (peak-signalets input til motoren).
- Slukket: laeser `training_day_runs.report.riders` (kopien), praecis som foer.
- Taendt: kalder RPC `training_runs_from_ticks_6490` (service_role only, `p_slim`), som afleder status/focus fra kvitteringerne (`training_rider_ticks`). Paginerer stabilt (loeser samtidig raekkeloftet #8180 paa den nye vej).
- Kun den eksakte vaerdi "on" taender; alt andet, ogsaa opslagsfejl, giver slukket. Staar i FRESH_FLAG_KEYS og laeses med `fresh: true`.
- Egen kontakt, adskilt fra `training_history_from_ticks_6490` (Fable-dom 15/11), saa traeningssiden aldrig kan aendre motorens input.
- Filer: `backend/lib/trainingHistoryFromTicks6490.js`, `backend/lib/racePeakPlans.js`, `backend/lib/featureStage.js`, `backend/lib/stageFlagCatalog.js`, `database/2026-11-15-6490-training-history-runs.sql`.

## Test
- `trainingHistoryFromTicks6490.golden.test.js`: med flaget null/"off"/"beta" er peak-output bit-identisk med merge-base (ogsaa naar historik-flaget er "on").
- `trainingHistoryRuns6490.integration.test.js`: samme `riderMap` med og uden flaget, ogsaa naar kopiens indhold er rodet med; holdskift midt i en dato giver samme `riderMap`; slukket giver main-laesningen uanset historik-flaget; seed er "off".
- Dvs. slukket-stien og paritet ved taendt er daekket. Jeg koerte ikke suiten i dette spor (undersoegelse uden kodevindue).

## Prod-status (read-only)
`app_config` (SELECT):
- `training_history_from_ticks_6490` = on (taendt 23/11).
- `training_sweep_memory_6490` = on (17/11).
- `training_peak_from_ticks_6490` = **off** (uroert siden seed 15/11).

## Bevis: paritet i prod, peak-vejen
Read-only transaktion (rullet tilbage): sammenlignede kopien (`report.riders`: rider_id, status, focus) med `training_runs_from_ticks_6490(..., p_slim=true)` for 40 hold over de seneste 18 dage (peak-signalets laeseglue).
- Raekker i kopien: 3315. Raekker fra kvitteringerne: 3315. Afvigelser: **0**.
Tidligere paritet for historik-vejen: 0 afvigelser over 9.458 koersler (issue-kommentar 23/11), og historik-flaget har kørt on i 3 dage uden fejl.

## Hvad mangler for at taende
Intet teknisk. Det er motorens input, saa det er ejer-go (stoerste risiko = peak-planer for kommende loeb).
Tjekliste:
1. Ejer-go ordret (motor-input, "Fable-dommer foer aktivering").
2. Paritet frisk samme dag: `scripts/ops/6490-parity.sql` / ovenstaaende sammenligning = 0 afvigelser, ogsaa med alle hold.
3. Gem foer-billede af peak-planer (antal og indhold af aktive peak-planer for kommende loeb) til sammenligning.
4. Flip `app_config` til "on" (fresh-laesning, ingen deploy).
5. Efter flip: tjek Railway-log og Sentry for "training_day_runs (peak leadup)"-fejl, og at peak-planerne er uaendrede mod foer-billedet.
6. Rollback: saet vaerdien til "off" (samme sekund, ingen data aendret).
7. Roadmap/issue-opdatering; ingen spillervendt tekst, saa ingen patch note.

## Pris ved sletning (alternativet)
Fjern flag-noeglen i `featureStage.js` og `stageFlagCatalog.js`, grenen og `isTrainingPeakFromTicksEnabled` i `racePeakPlans.js`/`trainingHistoryFromTicks6490.js`, golden- og integrationstests for trin c, samt peak-RPC'en i SQL. Men RPC'en og den paginerede laesevej er forudsaetning for senere trin d (stop med at skrive kopien) og plads-gevinsten (ca. 1 GB). Sletning ville derfor blokere resten af #6490-sporet.

## Dom
Flaget er KLAR til taending (ikke SLET): koden er afgraenset og fail-safe, testet (golden + integration), og prod-paritet er 0 afvigelser. Eneste manglende skridt er ejer-go og tjeklisten ovenfor.

Dom: bekraeftet + fix-plan
