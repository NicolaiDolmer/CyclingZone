# Re-derive opdaterede standings men ikke rytterværdier (2. afkobling)

**Dato:** 2026-06-03
**Område:** Præmiepenge / rytterværdi / re-derive
**Relateret:** [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893), #997, `2026-06-03-frozen-race-points-decoupling.md`

## Symptom

Ejer redigerede point-modellen mange gange (prod: 76 `race_point_model_edited` + 6
`race_points_regenerated` på én dag) og forventede at rytternes markedsværdi fulgte med.
Den gjorde den ikke — selv hvis re-derive-knappen var blevet brugt.

## Rod-årsag

`#997` lukkede afkoblingen mellem **config → race_results** (frosne point), men introducerede
en anden: `rederiveSeasonRacePoints` kaldte `updateStandings(seasonId)` men **ikke**
`updateRiderValues`. Rytterværdi = `max(5,uci_points)×4000 + prize_earnings_bonus`, og
`prize_earnings_bonus` genberegnes KUN i `updateRiderValues`, som indtil nu kun blev trigget
fra `paySeasonPrizesToDate` (#895/R3) og `processDivisionEnd` (sæson-slut).

Resultat: tre frysningslag i kæden, ikke ét.
`race_points (config)` → **[re-derive]** → `race_results.prize_money` → **[updateRiderValues]** → `riders.prize_earnings_bonus` → `market_value (generated)`.
`#997` koblede kun det første led; det andet blev hængende.

## Fix

`rederiveSeasonRacePoints` tager nu `updateRiderValues` som injiceret dep (samme mønster som
`updateStandings`) og kalder den efter standings. Endpointet `/admin/seasons/:id/rederive-points`
wirer `economyEngine.updateRiderValues` ind. Resultatet returnerer `ridersUpdated`, og admin-UI
viser det. Dep er optional → eksisterende kald uden den (og unit-tests) er bagudkompatible.

## Læring

Når en værdi er **afledt gennem flere frysnings-/cache-lag**, skal en "re-derivér fra kilden"-
handling kaskadere gennem ALLE lag, ikke kun det første. Find hvert sted hvor en down-stream
værdi materialiseres (`points_earned`, `prize_money`, `prize_earnings_bonus`, `market_value`)
og verificér at re-derive rører dem alle. Her fandtes mønsteret allerede (#997's egen
postmortem) — men fixet stoppede ét led for tidligt.

**Guard:** ny test `rederiveSeasonRacePoints refreshes rider values after standings when injected`
fastlåser rækkefølgen (standings → rider-values) og at klienten videregives.
