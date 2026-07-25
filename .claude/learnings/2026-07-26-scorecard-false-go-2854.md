# Et scorecard der siger GO på en delscore det ikke gate'r (#2854)

**Dato:** 2026-07-26 · **Issue:** [#2854](https://github.com/NicolaiDolmer/CyclingZone/issues/2854) · **Slice:** race-engine (epic #2768)

## Symptom

`raceRouteRealismScorecard.js` printede `✅ GO — alle gatede tiers grønne` og exit 0,
selvom `scoreGrandTour` samtidig printede `HC-stigninger 1 udenfor 3-8 ❌` for Tour de
l'Hexagone. Gaten gav grønt lys på et grundlag den lige havde vist var rødt.

## Rodårsag

`allPass` blev kun bygget af `scoreTier`. GT-resultatet blev beregnet, formateret og
printet i den samme løkke — men aldrig læst igen. Delscoren var kosmetik, ikke en gate.

Klassen er bredere end den ene linje: aggregeringen var et `&&` over de delscorer nogen
huskede at tilføje. Alt andet — 0 løb, en tier uden mål i `TIER_TARGETS`, en GT der ikke
kunne måles, en generator der kastede — kollapsede tavst til `true`. **Fravær af evidens
så ud præcis som bestået evidens.**

## Fix

Tre udfald i stedet for to (`scoreSeason` i `raceRouteRealismMetrics.js`):

- **GO (0)** — hver gatet delscore KØRTE og bestod.
- **NO-GO (1)** — mindst én delscore kørte og fejlede sit bånd.
- **UKENDT (2)** — gaten kunne ikke vurdere det den skal vurdere.

GO kræver nu positiv evidens (`gatedTiersEvaluated > 0` + tomme `failures`/`unassessed`),
ikke fravær af et registreret brud. Tier 1-2 rendere som "ikke gatet", ikke som ✅.

## Læring (generaliserbar)

1. **En delscore der beregnes og printes, men ikke læses af verdicten, er værre end ingen
   delscore** — den ser ud som dækning uden at være det. Spørg altid: hvilke af de tal
   scriptet printer, kan faktisk fælde det?
2. **Boolean-akkumulatorer der starter på `true` lyver ved tomt input.** `let allPass =
   true` + en løkke der aldrig kører = GO. En gate skal tælle hvad den *har* verificeret,
   ikke hvad den ikke har afvist.
3. **"Kunne ikke vurderes" fortjener sin egen tilstand.** At mappe det til NO-GO gør folk
   blinde for forskellen mellem "kalenderen er dårlig" og "gaten er blind".
4. **Verdicten skal nå exit-koden.** Fem søster-scorecards printede `HEADLINE: ❌ FAIL` og
   exitede 0; to af dem fejler faktisk deres primære gate i dag (`inflationScorecard`,
   `moneySupplyScorecard`) uden at nogen maskine kunne se det.
5. **`process.exit(N)` med åbne supabase-handles fælder libuv på Windows med exit 127** —
   en dokumenteret exit-kontrakt holdt ikke i praksis. Brug `process.exitCode` + naturligt
   exit.

## Guard

`backend/lib/raceRouteRealismMetrics.test.js` — 10 tests på `scoreSeason`, hvor
reproduktionstesten (`#2854: en grand tour udenfor HC-båndet må ikke give GO`) fejler mod
commit `6ae0eb4a` (verbatim-udtrækket af den gamle adfærd) og består mod fixet. Dertil tests for tom kalender, ukendt tier,
u-gatede tiers, umålelig GT og generator-fejl — alle skal give ≠ GO.
