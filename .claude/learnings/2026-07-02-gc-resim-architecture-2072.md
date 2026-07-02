# 2026-07-02 — Slut-GC re-simulerede hele løbet pr. etapedag (#2072)

## Symptom
Spillerne regnede selv efter på Vuelta Burgalesa (Discord 1/7): de publicerede
etape-gaps gav Jakub Adamczyk 61s samlet mod Oliver Wilsons 76s — men publiceret
slut-GC sagde Wilson +0:00, Adamczyk +0:32. Scorecard-sweep (read-only prod,
`backend/scripts/gcAccumulationScorecard.js`): **alle 6 afsluttede etapeløb** havde
slut-GC der modsagde de publicerede etaperesultater; mindst 3 med forkert vinder.

## Rod-årsag (arkitektur, ikke enkelt-bug)
`simulateStageByIndex` byggede HELE løbet forfra pr. etapedag (`buildRaceResults`)
og persisterede kun dagens etape. "Determinismen" (faste seeds) skulle gøre det
ækvivalent — men inputtene var IKKE faste på tværs af dage:
1. **Træthed dobbelt-taltes og drev**: `rider_condition.fatigue` opdateres efter
   hver etape (`applyRaceFatigue`) og læses live igen næste dag, HVOREFTER
   `stageEnteringFatigues` lagde de simulerede tidligere etapers belastning oveni.
2. **Feltet skrumpede**: solgte/slettede/udlånte ryttere forsvandt fra entrants
   (Burgalesa: 144→83), og #1844-frysningen droppede dem stille.
Resultat: etape-resultater og slut-GC kom fra 4-5 FORSKELLIGE simulationer.

## Fix (PR: fix/gc-accumulation-2072)
- Ny SSOT: klassementer AKKUMULERES fra de persisterede race_results-etaperækker
  (`raceClassifications.js`: parseGapSeconds/accumulateStageRows/filterCompletedEntrants;
  `buildStageRowsAccumulated` i raceRunner). Dagens etape simuleres ISOLERET med
  rytterens NUVÆRENDE fatigue (ingen re-akkumulering).
- #2081 i samme greb: fulde løbende klassementer persisteres pr. mellem-etape under
  dag-typerne (CHECK-constrainten tillader ikke nye result_types uden migration);
  `leader` bærer GC-gap. INGEN mellem-etape-`team`-rækker: race_points har `team__1`,
  så `rederiveSeasonRacePoints` ville udbetale dem pr. etape — frontend deriverer
  hold-stillingen af GC-rækkerne i stedet.

## Læringer
1. **"Deterministisk re-simulation" er kun deterministisk hvis ALLE inputs er
   persisterede/frosne.** Live-DB-berigelse (fatigue/form/felt) i en re-sim-sti er
   en tidsindstillet konsistens-bombe. Publicerede resultater er SSOT — afled alt
   aggregeret fra dem.
2. **Payout-sikkerhed ved genbrug af result_types**: enhver (result_type, rank) med
   en race_points-række udbetales OG gen-udbetales af `rederiveSeasonRacePoints`.
   Tjek opslags-tabellen FØR nye række-emissioner (her: dag-typer har kun rank 1 → ok).
3. **Spillernes efterregning er en gratis oracle** — sum-af-gaps-invariansen er nu
   både en regressionstest og et genkørbart prod-scorecard.

## Forward-guards
- Regressionstests: felt-ændring mellem etaper, gap-sum-invarians, payout-neutralitet
  (raceRunnerStage.test.js + raceClassifications.test.js).
- `backend/scripts/gcAccumulationScorecard.js` — read-only sweep, genkørbar efter
  hvert GT (Giro della Penisola 14/7).
