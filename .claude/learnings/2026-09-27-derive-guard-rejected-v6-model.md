# 2026-09-27 — derive-vagten afviste v6-værdimodellen (CYCLINGZONE-51 regression)

## Symptom
Efter flippet af `app_config.rider_valuation_model` til `v6` (26/9 22:21 CEST) kastede
`deriveForRiderIds` "valuation model unusable" på hvert kald. Heal-sweepen fejlede hvert
tick (86 events på 7 t), og alle 516 ryttere oprettet efter flippet stod uden `base_value`.

## Rod-årsag
Model-vagten i `backend/lib/backfillCores.js` kendte kun to former: v4/v5 (`fit.a/b`) og
v3 (`a/b` i roden). Den typefri v6-model har ingen af delene (bærende koefficient: `scale`).
`predictBaseValue` havde allerede en v6-gren — vagten foran den blev ikke opdateret i #5497.

## Fix
Vagten genkender v6 via `isTypefreeModel` og kræver en endelig `scale`. Regressionstest med
den rigtige v6-JSON i `backfillCores.test.js`.

## Læring
Når en ny model-form tilføjes bag en dispatcher (`predictBaseValue`), så grep efter
alle steder der validerer model-FORMEN (`fit.a`, `model.a`) — ikke kun dispatcheren.
En test der kører `deriveForRiderIds` med hver model i `VALUATION_MODEL_IDS` ville have
fanget det før flippet.
