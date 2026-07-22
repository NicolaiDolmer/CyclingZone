# Postmortem: passage-gaten lækkede på legacy-etaper (`Number(null) === 0`)

**Dato:** 2026-07-22 · **Issue:** [#2786](https://github.com/NicolaiDolmer/CyclingZone/issues/2786) · **Fix:** PR #2787 · **Indført af:** PR #2777 (Sub-2, #2770)
**Varighed i prod:** 12:04 → 21:5x UTC (~7 timer, opdaget samme dag)

## Hvad skete der

Sub-2's passage-lag skulle være **data-gated**: etaper uden rutedata (hele sæson 1) skulle returnere tomt og bevare legacy-adfærd. Gaten var:

```js
const distance = Number(stageProfile.distance_km);
if (!Number.isFinite(distance) && climbs.length === 0 && sprints.length === 0) return empty;
```

`Number(null)` er `0` — et **endeligt** tal. Sæson-1-profiler har `distance_km = NULL` (kolonnen blev først udfyldt fra Sub-1 og kun for S2), så `Number.isFinite(0) === true` → negationen blev `false` → gaten udløste aldrig. Etapen kørte videre med `dist = 0`, waypoint-listen fik et fantom-`finish` ved km 0, og laget uddelte grøn-point på Tour-skalaen + 10/6/4 bonussekunder midt i en aktiv sæson.

**Skade (25 igangværende etapeløb):** 3.727 korrupte etaperækker · 435 fantom-passage-rækker · 580 bonussekunder trukket fra GC · 3.727 dagstrøje-rækker beregnet fra korrupt akkumulering · 145 trøjeholder-præmier (32.250) udbetalt på forkert grundlag. Ingen slut-klassementer nåede at blive skrevet.

## Hvorfor testene ikke fangede det

Tre lag af tests var grønne, og **alle testede den samme forkerte antagelse**:

1. `racePassages.test.js` testede "ingen rutedata" som `{ profile_type, stage_number }` — nøglen `distance_km` var **fraværende**, ikke `null`. `Number(undefined)` er `NaN` → gaten virkede. Produktionen leverer `null` fra Postgres, ikke `undefined`.
2. `raceRunnerPassages.test.js` byggede `STAGES_BARE` ved at udelade rutefelterne — samme fejl.
3. Konkurrence-scorecardet (`race:competitions`) kørte kun på **genererede** GT'er med fuld rutedata — legacy-stien blev aldrig eksekveret.

Ingen test brugte en fixture der spejlede en ægte DB-række.

## Rod-årsag

Fixturer blev skrevet ud fra **koden**, ikke ud fra **datalaget**. `null` vs `undefined` er den klassiske JS-faldgrube i netop dette skel, og Postgres leverer altid `null`.

## Forebyggelse (indført)

- Gaten kræver nu eksplicit positiv distance: `rawDistance == null ? NaN : Number(rawDistance)` + `distance > 0`.
- 3 regressionstests dækker `null`, `undefined`, `0` og manglende nøgle — samt at rute-etaper er upåvirkede.

## Læring til fremtidige data-gates

1. **Test gaten med den værdi databasen faktisk sender.** En "mangler data"-fixture skal indeholde `null`, ikke bare udelade nøglen. Gerne begge.
2. **`Number(null) === 0`** — brug aldrig `Number.isFinite(Number(x))` alene som "findes værdien?"-gate. Kræv `x != null` først.
3. **Legacy-stien skal have sin egen eksplicitte test mod en ægte rækkeform**, ikke kun den nye sti.
4. Kobler til [[feedback_test_real_endpoint_not_just_mocked]]: mocket/syntetisk input beviser kun at koden kører — ikke at den møder virkelighedens dataform.
5. En harness der kun kører den NYE kodesti kan ikke gate et data-gated feature. Kør begge grene.

## Hvad der gik rigtigt

Den adversariske verifikations-workflow mod **live data** (ikke kun tests) fandt fejlen samme dag, før nogen slut-klassementer blev skrevet. Uden den ville de 25 løb have afsluttet med skala-inkonsistente trøjer.

## Bagud-tjek (udført 22/7)

`grep -rn "Number.isFinite(Number(" backend/lib backend/routes` gav 19 forekomster uden for testfiler. Gennemgået én for én:

- **Korrekt guardet** (parret med eksplicit `!= null`/`!== null`): `abilityDerivation.js:160-161`, `balanceSnapshot.js:61,73`, `boardEvaluation.js:202`, `boardWeekendUpdate.js:205`, `racePeaks.js:158`, `economyEngine.js:1255,1355`, `boardWeekendFinalization.js:356`. De tre sidste er de mest kritiske (sæson-start-anker for bestyrelsens tilfredshed, hvor **25 af 420 board_profiles faktisk har `season_start_satisfaction` NULL** i prod) — alle tre har `&& board.season_start_satisfaction !== null` ved siden af, så ankeret falder korrekt tilbage til den løbende værdi.
- **Ufarlig**, fordi fallback-værdien er 0 uanset: `raceIncidents.js:55` (positioning), `raceFatigue.js:57` (startFatigue).
- **Skrøbeligt mønster uden live-effekt**: `boardTransparency.js:44-45` bruger `Number.isFinite(Number(board?.satisfaction)) ? ... : 50` — en NULL ville give 0 i stedet for default 50, men `satisfaction`/`budget_modifier` er NOT NULL i praksis (0 af 420 rækker). Værd at stramme ved næste berøring, ikke et issue værd nu.
- `raceRunner.js:1259,1871` regner på en beregnet værdi, ikke en DB-kolonne.

**Konklusion: ingen søskende-fejl med live-effekt.** Fælden opstår kun når `Number.isFinite(Number(x))` bruges som *eksistens-tjek* på en nullable DB-kolonne uden null-guard — hvilket kun passage-gaten gjorde.
