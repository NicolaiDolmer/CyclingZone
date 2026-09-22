# Research-memo: #5497 typefri rytterværdi med marked (read-only kortlægning 22/9)

Formål: kort til den worker der bygger #5497 (R1-R6). Ingen tal, ingen navne. Kilde: hoved-checkout main 22/9. Ejer-beslutninger og rækkefølge står i #5497; genåbn intet.

## 1. Typeafhængigheder i værdi-/markedskæden

### 1.1 `backend/lib/riderValuation.js`

| Linje | Hvad typen gør | Skal erstattes af |
|---|---|---|
| 57-59 | `WEIGHTS_BY_TYPE` = `VALUATION_WEIGHTS` indekseret på type | type-uafhængig evne→output-afbildning |
| 63-76 `outputScore()` | vægtet snit af positive vægte for `primaryType` | |
| 79-86 `meanAbilityScore()` | allerede typefri (snit over `ABILITY_KEYS`) | skelet, men blind for profilform |
| 90-95 `blendedOutput()` | `alpha·outputScore + (1-alpha)·meanAbility` | |
| 115-122 `valuationOutput()` | dispatch: `weights_source==="display_recipes"` → `roleOutputRaw(abilities, type)` (v5), ellers `outputScore` (v4). Begge type-keyede | her skal R2's evne-vektor→forventet point ind |
| 134-137 `valuationTypeFor()` | `type_source==="primary"` → `primary_type`; ellers `valuation_type ?? primary_type` (#3345-frysning) | overflødig i ny model, men se 6.1 |
| 194-198 | pristillæg `offset = model.offset[type] ?? min(offsets)` | fjernes helt; ét fælles niveau-led |
| 200 | `exp(a + b·O + c·O² + offset)` | |

Vægttabeller: `backend/lib/weights/displayRecipes.js:70-85` og `backend/lib/weights/valuationWeights.js:20-27` (forskellige; valuationWeights har negative vægte).

### 1.2 `backend/lib/riderCareerNpv.js` (live model)

| Linje | Hvad typen gør |
|---|---|
| 71-74 | `FROZEN_NPV_RATE_BY_POTENTIAL` + `frozenNpvRate()`: potentiale-rate, IKKE type. Låst ("potentiale-rate uændret") |
| 76-88 `expectedNextAbilities()` | `peakAgeForType(primary_type)` (77), `signatureFactor(primary_type, ability)` (83), `abilityCap(cur, primary_type, ability, potentiale)` (84): lofterne og vækst-/faldkurven |
| 107 | `valuationTypeFor(rider, model)` |
| 118-124 | `offset = fit.offset[type] ?? min(offsets)` |
| 127 | `buildCaps(abilities, type, potentiale)` |
| 161 | `valuationOutput(ab, type, ...)` pr. sæson: typen slår igennem i hvert NPV-led |
| 169 | `expectedNextAbilities(..., { primary_type: type })` |
| 189-209 `applyElitePremium()` | typefri, men har `floor`/`floor_overall` = elitegulv (låst væk i #5497) |
| 265-271 `currentProductionValue()` | løngrundlag = `trajectory[0].prod`, arver alle typeled |

Opstrøms i `backend/lib/riderProgression.js` (det R3 reelt skal neutralisere): 390-391 `peakAgeForType` (men `PROGRESSION_CONFIG.peakAgeByType = null`, linje 30: topalder er allerede fælles); 375-380 `signatureFactor`; 458-460 `abilityCap()` = `headroomForPotential(potentiale) × signatureFactor(type, ability)` (den reelle type-asymmetri i lofterne); 665-671 `buildCaps()`; 152 `rateByPotential` (den nuværende motor) vs. NPV'ens frosne tabel.

Skal erstattes for at to ryttere med samme evner/alder får samme grundværdi: (a) `offset[type]` i begge filer, (b) `valuationOutput`s type-keyede vægtkilde, (c) `signatureFactor` i `abilityCap`/`buildCaps`, (d) `peakAgeForType`-hooket. (a)+(b) alene er ikke nok: NPV-fremskrivningen ville stadig give type-byttede kloner forskellige fremtidige evner.

### 1.3 `backend/lib/marketValueModel.js`

| Linje | Hvad typen gør |
|---|---|
| 24-32 `meanAbilityScore()` | typefri |
| 38-43 `offsetFor(type, offsetDict)` | type-offset med `min()`-fallback |
| 60-107 `predictMarketPrice()` | `primary_type` (61), `offsetFor` (78) indgår i `lnPrice` (86) |
| 119-136 `computeSupport()` | same-type-matching: 125 `if (s.primary_type !== rider.primary_type) continue;` R4's hovedblokker |
| 145-148 `blendTarget()`, 156-163 `applyWeeklyCap()` | typefri |

Kaldere: `backend/lib/marketValueSundaySweep.js:148, 176, 319-323, 337, 345, 348`. Artefakter: `marketValueModelV1.json` (`a_floor_shift` læses IKKE af kode på main), `marketValueModelV2.json` (`type_column: "valuation_type"`, dvs. fittet mod den frosne type).

### 1.4 Øvrige læsere
`riderValueRefresh.js:26-35` (best_role som argmax over displayRecipes), 74-86, 202-208 · `riderValuationTypeDampening.js` (#4000, slået fra i v5) · `riderPrognosis.js`, `scoutingReport.js`, `riderValueTrend.js`, `balanceSnapshot.js`, `backfillCores.js`, `starterSquadAllocator.js`, `scoutMission*.js`.

## 2. v4-løbsmotorens harness

- Motor: `backend/lib/engine/v4/` (`index.ts` `simulateStageV4`, `segmentLoop.ts`, `physiology.ts`, `groups.ts`, `finale.ts`, `timeline.ts`, `tuning.ts`, `adapters/`, `orders/`, `mechanics/` (16), `fixtures/` (4 etape-arketyper), `testUtils/makeHookCtx.ts`).
- **Motoren er typefri på indgangen:** `adapters/entrantAdapter.ts:73-74, 111` tager kun evner + `role` (`normalizeRole` → `free_role`). Typen kommer ind via udtagelsen (`raceAutopick.js:116-118` captain/helper; `seasonProductionSim.js:110-121`). R2's "ingen rolle-label" angriber udtagelses-/rolletildelingslaget, ikke motoren.
- Scripts: `backend/scripts/simulateSeasonProduction.js` (v3, ægte population + kalender, read-only, `--k --seed --v3 --out --season`) · `backend/scripts/headToHeadV4.js` (v4, 100 % read-only mod JSON: `--population --stages [--seed] [--films]`; fixture `backend/scripts/fixtures/headToHeadV4-example/`; ankre via `scripts/lib/headToHeadAnchors.js`) · kerne `backend/lib/seasonProductionSim.js` (`assignSeasonFields` 48, `aggregateRunTotals` 170, `aggregateSeasonSamples` 195).
- Kalender: `backend/lib/tierCalendarMaterializer.js:559` `materializeTierCalendars({ useUniformTierTilt })`, default `false`. R1-mønster: `backend/scripts/dev/gateStatus5405.mjs:98` (`useUniformTierTilt: false`). `buildSeasonCalendar.js:461, 692` (`--uniform-tilt`). Profiler: `raceStageProfileGenerator.js`; kvoter `calendarRaceDayTargets.js`, `calendarTierCaps.js`.
- Point pr. rytter: `raceResultsEngine.js` (`buildRacePointsLookup`, `PRIZE_PER_POINT`) → `resultRows {rider_id, points_earned, prize_money}` → `aggregateSeasonSamples` → `{races_entered, e_points, e_prize, sd_prize, p10/p50/p90_prize}`.
- Syntetiske ryttere: ingen navngivet reference-hold-mekanik. Korteste vej: `headToHeadV4-example/population.json`-kontrakten. `--free-agents` i `simulateSeasonProduction.js:71-74` bygger ability-matchede virtuelle hold (nærmeste eksisterende).

## 3. Markedsdata

Tabeller (`database/schema-snapshot.json` → `relations.<tabel>.columns`): `auctions`, `auction_bids` (`is_proxy`), `auction_proxy_bids`, `transfer_offers` (`offer_amount`, `counter_amount`, denormaliseret `rider_id`/`seller_team_id`), `transfer_listings`, `swap_offers`, `finance_transactions` (den faktisk betalte pris; `reason_code`, `related_entity_*`, `idempotency_key`), `fairplay_flags`, `fairplay_whitelisted_pairs`, `market_value_sunday_sweep_log`, `market_value_level_correction_*`, `transfer_windows`.

Misbrugsfilter der findes:
- `backend/lib/fairplayScoring.js`: 34-64 `FAIRPLAY_DEFAULTS` (`priceBandFloorPct 0.10`, `priceBandCapMultiple 2.2`, #3818's `directional*`-parametre) · 128-134 `computePriceOutlierStrength` (prisafvigelse) · 179-233 `computeDirectionalStrength` (gentagne modparter/transfer-ring, guards 166-178) · 308-348 `scorePairIncident` · 350-383 `scoreFunnelIncident`.
- `backend/lib/fairplayFlagsCron.js`: 163-233 `normalizeTransactions`, 289-295 counterparty-graf, 496+ `runFairplayScoringSweep`.
- `backend/lib/transferPriceBand.js`: app_config `transfer_price_floor_pct` / `transfer_price_cap_multiple`, default deaktiveret.
- Allerede anvendt på markedsfit: `backend/scripts/fitMarketValueModelV2.js:375-426, 555-556` (`evidence_filter`: ≥2 budgivere + hævet pris, kun menneske↔menneske, ekskl. `is_guaranteed_sale`, pris over multiplum af anker, par med 3+ handler bandlyst). Det er en delmængde: R4 skal koble `computeDirectionalStrength` + `computePriceOutlierStrength` på.
- Kendt hul: `.claude/learnings/2026-08-31-fairplay-detektoren-saa-ingen-direkte-handler.md`.

## 4. Privat evidens (worktree `codex-5443-best-role-refit/balance-internals/2026-09-22-best-role-refit/`)

Alle `.mjs` importerer `../../backend` relativt; kræver placering under `balance-internals/` i et verificeret worktree. Tunge kørsler via `scripts/verify-lock.ps1 -Max 2`. Læs `CLAUDE_REVIEW_README.md` først. Ældre snapshots kan indeholde navne: private.

- **R2:** `probeV4TeamPointContribution.mjs` + `ability-v4-team-points-*.json` (nyeste metode; kørt på IKKE-godkendt program) · `probeV4SupportContexts.mjs` + `ability-v4-support-context-*.json` (varierer antal hjælpere) · `probeV4AbilityContribution*.mjs` (forældet metode) · `probeV4PlannedProgramme.mjs` (eksperimentelt program) · `ability-v4-helper-pairs.json` (erklæret ikke gyldigt værdiinput). Fælles forbehold: én prøveetape pr. profil, faste syntetiske hold, ingen GC/trøje/fatigue-karriere; rå point må ikke omsættes direkte til kroner.
- **R1:** `captureReferenceProgramme.mjs` + `-draft.json` (FORKAST, gammel D4-kvote) · `captureReferenceProgrammeCliParity.mjs` + `-cli-parity.json` (scriptet genbrugeligt, kørslen ikke: uniform tilt TIL) · `captureReferencePointScales.mjs`.
- **R3:** `probeCareerTypeDependence.mjs` + `ability-career-type-dependence.json` (færdig R3-regressionsprøve: importerer `riderProgression.js` + `expectedNextAbilities`) · `ability-training-score-coverage.json` (rå gennemsnitsscore kan ikke erstatte potentiale).
- **R4:** `exportAbilityMarketEvidence.mjs` + `ability-market-raw.json` + `market-evidence/` (GET-only, ingen navne i dette udtræk) · `ability-market-observations.json`, `-history-coverage.json` (betalingsafstemt, men IKKE fuld kvalifikation) · `analyzeAbilityMarketEvidence.mjs` (negative evnehældninger; største-køber-fjernelse var følsomhed, ikke værn) · `analyzeMonotoneMarket.mjs`, `analyzeSmoothMarket.mjs`, `probeAbilityMarketSensitivity.mjs` (diagnose; senere data allerede set → ikke ren holdout).
- **Ikke genbrugeligt til R2-R4:** `simulation.json`, `snapshot.json`, `summary.json`, `rows.json`, `teams.json`, `top20_*.json`, `losses_over_half.json`, `perturbations.json`, `riderValuationModelV5.best-role.candidate.json`.

## 5. Eksisterende scorecard (`backend/lib/valuationV4Scorecard.js`, script `backend/scripts/valuationV4Scorecard.js`)

Regressionsgrænser (`hard: true`): 106-123 `scaleContinuityGate` (median-drift ±15 %) · 133-145 `eliteUnbuyableGate` (antager elitegulvets effekt) · 195-231 `developAndSellGate` · 274-291 `determinismGate`.
Kvalitetsmål (`hard: false`): 63-105 type-økonomi-tabel (meningsløs i typefri model; erstattes af ækvivalens-prøve) · 254-273 `anchorSanityRow` · 305-318 `symmetryReportRow`.
R5 skal tilføje: kontanter separat, tabsliste, misbrugsprøver, rolle-tie-glathed, type-bytte-ækvivalens. `projectAbilitiesForward` (232-253) deler kode med produktionen: R3 ændrer samtidig den hårde udvikl-og-sælg-gate.

## 6. Faldgruber

1. `valuationTypeFor` må ikke slettes: v4-stien skal regne bit-identisk mens `rider_valuation_model = 'v4'`. Ny model = NYT model-id. `riders.valuation_type` droppes kun i separat ejer-gated migration.
2. Dispatch: `backend/lib/riderValuationModelSelect.js:70-74` `MODEL_PATHS` er eneste sted der kender modelfiler (vagt `valuationModelReaders.test.js`). `riderValuation.js:152-154` er cutover-dispatchen. Fail-safe → `v4` (`DEFAULT_VALUATION_MODEL_ID`, 62); `readModelIdStrict`/`loadValuationModelStrict` (173-178) til skrive-stier.
3. To app_config-nøgler: `rider_valuation_model` (pris) og `rider_production_value_model` (løn). CPV måles separat i R5.
4. Potentiale-raten ligger to steder (`riderCareerNpv.js:71-74` frosset; `riderProgression.js:152` aktuel). Rør ikke 71 (kun sammen med #3750+#3449).
5. `applyElitePremium` = konveks præmie (197-199) + gulv (203-207). "Intet fast elitegulv" rammer gulvet; `eliteUnbuyableGate` skal omformuleres, ellers blokerer den enhver ny model.
6. `marketValueModel.js:125` same-type-matching + `marketValueModelV2.json.type_column = valuation_type` (fittet mod frossen type). R4 definerer "lokal" på evner/præstation/alder; `computeSupport`s kontrakt ændres.
7. Søndagspipeline: værdi-refresh FØRST, markedsblend SIDST (ECONOMY_RULES §9.1). Markedet er slukket i dag (`market_value_sweep_enabled off`, vægt 0, log tom).
8. `a_floor_shift` er en tavs no-op på main (implementering på ikke-merget `feat/3448-level-anchor`).
9. Motoren er typefri; udtagelsen er det ikke (se §2).
10. R1: sæt `useUniformTierTilt: false` eksplicit og bekræft nul skrivninger.
11. R3 og R5 kan ikke skrives uafhængigt (delt `expectedNextAbilities`).
12. #5444 må ikke lukkes; `codex/5443-best-role-refit` er ikke kompatibilitetsreviewet.

**Tillæg:** `database/2026-08-06-3138-fairplay-flags.sql` definerer `fairplay_flags`-skemaet; `backend/cron.js` kører `runFairplayScoringSweep` i produktion, så R4 kan læse `fairplay_flags` direkte i stedet for at gen-score handler selv.
