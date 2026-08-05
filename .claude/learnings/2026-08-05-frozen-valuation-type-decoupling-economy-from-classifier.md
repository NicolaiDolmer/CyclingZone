# Postmortem · 2026-08-05 · #3345 løst — frossen `valuation_type` afkobler økonomien fra ryttertype-klassifikatoren

## TL;DR
#3345's blocker (V3-anchors døde, V4 kan ikke re-fittes uden en Monte Carlo-sæson-simulering) blev omgået, ikke løst permanent: ejeren valgte at FRYSE værdisætningen på den type hver rytter havde i prod FØR #3325/#3343's reklassificering, i stedet for at vente på et re-fit. Ny kolonne `riders.valuation_type` (additiv migration i `database/proposals/`, ikke kørt), og value-stien (`predictBaseValue`/`predictBaseValueV4`/`currentProductionValue`) læser den FØR `primary_type` via en fallback-kæde: `rider?.valuation_type ?? rider?.primary_type ?? null`. `primary_type`/`secondary_type` reklassificeres nu frit uden at røre `base_value`/`market_value`. Bevis: hele populationen (8.296 aktive ryttere) gennem V4 med den nye klassifikation aktiv + frysning: total market_value **993,47M → 993,47M** (byte-identisk), tier-fordeling identisk, 0/368 hold ≥10% squad-værdi-skift (var 239/367 u-frosset). Opfølgning (re-fit V4 + fjern frysningen): #3353.

## Hvad blev bedt om
Byg oven på #3348's blocker-analyse: frys værdisætningen på den gamle type, find ALLE kaldsveje der skriver/beregner `base_value`/`market_value`, bevis populationens totale værdi er uændret, migration idempotent + read-only i denne PR.

## Designvalget: fallback-kæde, ikke et separat funktionssæt
`predictBaseValue`/`simulateCareer` (V4) ændrede ÉN linje hver: `type = rider?.primary_type` → `type = rider?.valuation_type ?? rider?.primary_type ?? null`. Dette betyder:
- Produktions-skrivestier (der SELECT'er `valuation_type` fra DB og lader den flyde igennem via objekt-spread) bruger automatisk den frosne type.
- ALLE eksisterende tests/simulations/fixtures/preview-scripts der konstruerer et rytterobjekt med KUN `primary_type` (ingen `valuation_type`) fortsætter uændret — nul testbrud, nul scope-explosion i de ~50 filer der importerer disse funktioner.
- Risikoen flytter til: "har jeg tilføjet `valuation_type` til SELECT'et på hver reel skrivevej?" — en glemt SELECT giver `undefined`, som `??` transparent falder tilbage til `primary_type` for (stille delvis revaluering, præcis den fælde opgaven advarede om).

## De kaldsveje der IKKE var i den oprindelige to-do-liste (fundet ved grundig grep)
Opgaven navngav eksplicit `riderValuation.js`, `riderValueRefresh.js`, `backfillCores.js`. Ved at grep'e efter `predictBaseValue(|predictBaseValueV4(|currentProductionValue(` i hele `backend/` (ikke kun de nævnte filer) blev to yderligere REELLE skrivestier fundet:
1. **`riderProgressionEngine.js`'s `developRidersForSeason`** — sæson-transitionen genberegner `base_value`/`current_production_value` for HVER aktiv rytter HVER sæson. Uden fix ville den FØRSTE sæson-transition efter merge stille have revalueret hele populationen igen, uafhængigt af backfillet.
2. **`backfillCores.js`'s `deriveForRiderIds`** (re-derive/heal-sweep-grenen, ikke kun ny-rytter-grenen) — kaldes BÅDE for helt nye ryttere OG for re-derive af EKSISTERENDE strandede ryttere (`riderDeriveHealSweep.js`, migreringsscripts). Første udkast satte `valuation_type: t.primary_type` ubetinget — ville have overskrevet en allerede-frosset værdi ved enhver re-derive. Rettet til `r.valuation_type ?? t.primary_type` (bevar hvis sat, kun default for HELT nye rækker).

Derudover 4 læse-stier i `api.js` (spiller-vendt preview-chip + scouting "expected value" + 2 admin-diagnostik-endpoints) fik `valuation_type` tilføjet til deres SELECT, så preview-tal matcher den faktisk persisterede (frosne) værdi i stedet for at vise et tal beregnet mod den nye type.

## Læring
1. **Et mandat-listet sæt filer er et gulv, ikke et loft.** Opgaven navngav 3 filer eksplicit ("mindst") — den fjerde og femte reelle skrivevej (sæson-progression, heal-sweep-re-derive) blev kun fundet ved at grep'e efter FUNKTIONSKALD på tværs af hele backend/, ikke ved at stole på filnavne der lyder relevante. En feature der "skriver en økonomisk værdi" har typisk flere indgange end de mest oplagte (daglig tick, sæson-tick, backfill, ny-rytter-intake, heal-sweep) — list dem alle systematisk (grep efter selve funktionskaldet, ikke efter emneord) før du erklærer dig færdig.
2. **En "frys ved oprettelse"-kolonne skal skelne mellem NY række og RE-DERIVE af en eksisterende række.** `deriveForRiderIds` bruges til begge. At antage "denne funktion er kun for nye ryttere" (som kommentaren i mit eget første udkast fejlagtigt påstod) er en sti-afhængig antagelse der først viser sig forkert ved næste heal-sweep — betinget bevaring (`r.existing ?? fresh`) er den robuste default for ethvert "sæt-én-gang"-felt der deler skrive-kode med en re-derive-sti.
3. **`??`-fallback-kæder er et billigt værktøj til bagudkompatibilitet i en stor, testet kodebase** — 5.248 eksisterende backend-tests passerede uændret, fordi ingen af dem behøvede at vide om det nye felt. Men de flytter samtidig "har jeg husket det nye felt overalt?"-risikoen fra en synlig fejl (kastet exception) til en STILLE fallback — kompenseret her ved at grep'e eksplicit efter kaldsteder i stedet for at stole på at mangler ville fejle højlydt.

## Relateret
Forlænger [2026-08-04-value-model-refit-blocked-v4-live-not-v3-anchors-dead.md](2026-08-04-value-model-refit-blocked-v4-live-not-v3-anchors-dead.md) (blocker-analysen denne PR bygger videre på). Opfølgning: #3353 (V4-re-fit, fjerner frysningen). #3345, #3325, #3343, #3348.
