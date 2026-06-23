# Postmortem: auto-løb trak hold på tværs af divisioner (pulje-filter fejlede åbent)

**Dato:** 2026-06-23 · **Issue:** [#1798](https://github.com/NicolaiDolmer/CyclingZone/issues/1798) · **Fix-PR:** #1793 · **Sværhedsgrad:** P0 (første live løbsdag i forever-relaunch-sæsonen)

## Symptom
Første automatiske løbsdag (12:30 + 15:00 slots, 7 puljer). Spillere: "mit hold deltog ikke i sit løb" + "andre hold kørte flere løb end de skulle". Prod-data: hvert af 14 løb-afviklinger fik hold fra **alle 7 divisioner**; de 24 stærkeste hold i ligaen kørte alle løb; svagere hold i underpuljer deltog aldrig. Boucles Mayennaises (div6) stage 2 havde 49 hold.

## Rod-årsag
Pulje-filteret i `fillMissingTeamEntries` (raceRunner.js, indført #1688) er **fail-open**:
```js
const racePoolId = race?.league_division_id ?? null;
if (racePoolId != null) { eligibleTeams = eligibleTeams.filter(t => t.league_division_id === racePoolId); }
```
`runAdminSimulateStage` / `runAdminSimulateRace` (adminSimulateRace.js) selekterede ikke `league_division_id` i deres race-query. → `race.league_division_id === undefined` → `racePoolId = null` → filteret **sprang over** → felt-cap'et tog de 24 stærkeste på tværs af HELE ligaen.

Filteret var korrekt (og enheds-testet på `fillMissingTeamEntries`-niveau). Bugget var i **datafremføringen**: race-objektet bar aldrig pulje-id'et frem til filteret.

## Hvorfor sluppet forbi
- Enheds-test for pulje-filteret gav race-objektet `league_division_id` direkte → testede aldrig at den faktiske SELECT i kald-stien faktisk henter kolonnen.
- Mock-supabase i adminSimulateRace.test.js ignorerede SELECT-felterne (returnerede hele canned-objektet uanset hvad der blev selekteret) → en manglende kolonne var usynlig for testen.
- Først synligt ved den FØRSTE rigtige flerpulje-løbsdag.

## Fix (#1793)
Tilføj `league_division_id` til begge race-SELECTs i adminSimulateRace.js. + 2 regressions-tests der **inspicerer SELECT-strengen** (`__selects`-spy i mock) og verificerer at race-objektet bærer pulje-id'et videre til motoren.

## Cleanup (prod, 23/6)
19,44M præmier tilbageført (237 tx/30 hold, 0 negativt) · 3071 race_results + 14 runs + 2418 entries slettet · 13 løb reset til `scheduled` · race-træthed (429 ryttere), rytter-værdibonus (153), standings (49 rækker), race_days_completed nulstillet (alle = engine-re-derivering fra 0 race_results) · løb re-scheduleret 20:00/21:00 · scheduler+auto-prize-flag toggled OFF under arbejdet, ON efter deploy verificeret.

## Lessons / forward-guards
1. **Fail-open guards er farlige.** `if (x != null) filter()` permitterer ALT når `x` mangler pga. en upstream-udeladelse (ikke fordi feltet bevidst er null). Overvej fail-closed når feltet *burde* være sat (løbet HAR en pulje), eller assertér tilstedeværelse.
2. **Test datafremføringen, ikke kun den rene funktion.** Når en pure filter-funktion afhænger af et felt på et objekt der hentes andetsteds, skal en test verificere at hele kæden (SELECT → objekt → funktion) bærer feltet. Mock'en skal kunne afsløre en manglende SELECT-kolonne.
3. **`select("...")`-strenge er en stille kontrakt.** En udeladt kolonne fejler ikke ved build/lint/test — kun i runtime-adfærd. Når en downstream-konsument læser en kolonne, skal kald-stiens SELECT inkludere den (jf. også column-privilege-mønstret #1309).
4. **Verificér første-gang-features mod ægte data tidligt.** Bugget var kun synligt på den første flerpulje-løbsdag — simulér-før-ship / en dry-run mod ægte population ville have fanget krydspulje-feltet.

Cluster: [[feedback_match_ui_filter_for_capacity_logic]] (samme klasse: filter-divergens mellem kilder), [[feedback_simulate_before_ship_balance]], [[feedback_verify_each_edit_landed]].
