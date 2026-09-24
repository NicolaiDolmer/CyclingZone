# Research-memo: løbsmotor v4 før S4 (#4914, #4707, #4915, #4948) (read-only kortlægning 22/9)

Formål: kort til workers. Ingen balancetal. Kontekst (#4916, ejer 22/9): v4 live ved S4-start; én PR pr. punkt, alt bag `race_engine_v4` (off); derefter én samlet v3-vs-v4-rapport på 5 seeds i `docs/audits/` som ejerens beslutningsgrundlag. Flippet er ejerens.

## 0. Kør v4 alene

```
cd backend && node --test --import ./test-setup.js "lib/engine/v4/**/*.test.ts"
```
538 tests, ~4 s, grøn på main 22/9. Hele suiten: `npm test` i `backend/` (`scripts/run-tests.js:57-59, 76-110`).

Harness der findes: `backend/scripts/headToHeadV4.js` (`--population= --stages= --seeds=s1,s2,... --field-size=180 --orders=none|ai`; seeds 706-712, aggregering 798-840) · `backend/scripts/lib/headToHeadAnchors.js` (13 ankre; `AGGREGATION_BAND_BY_ANCHOR_ID` 595-610) · `backend/scripts/buildV4AnchorBaseline.mjs` (`SEEDS = "s1,s2,s3"` linje 36; feltstørrelse 69-70) · `backend/scripts/renderV4AnchorTable.mjs --write|--check` (RULES §7b; `--check` håndhæves af `renderV4AnchorTable.test.mjs`) · `backend/scripts/teamPlayAbMeasure.mjs` (allerede 5-seed A/B-harness: `SEEDS` 52, `TAIL_GATE_SEEDS` 55, `FIELD_SIZE` 57; genbrug) · `backend/scripts/v4TailSpread.js --gate` (ejer-låst 3 seeds). Pinnede input: `backend/scripts/baselines/population-snapshot-2026-09-07.json`, `v4-proxy-stages-2026-09-06.json`; output `v4-anchor-baseline.json`.

## 1. #4914 kalibreringspakke

Bygget: holdspil (pkt. 1) lukket, `TEAM_PLAY` kalibreret til v3-paritet 7/9 (`tuning.ts:902-905, 933`) · feltspredning (pkt. 4) lukket via #4885 (`segmentLoop.ts:182-196 referenceCpByKind`, `213-232 groupStrengthSpeedFactor`, `274-289 computeSegmentSpeedKmh`; hale-bånd ejer-låst, vægte `tuning.ts:789-790`) · felt-antals-fordel i massefinalen (`finale.ts:76,92,117,245,278`, tests `finale.test.ts:347-560`) · grupetto som effort og redning (`breakaway.ts:213-221`, `finale.ts:349-361`, `timeLimit.ts:101-110, 187-256`, `tuning.ts:821-833`).

Mangler: (1) all_out gratis på fladt: modulationen sidder på KRAVET (`segmentLoop.ts:369-372` → `effortCost.ts:87-94`), men `demandMultiplierAllOut` er en flad konstant (`tuning.ts:577-583`) uden profil-afhængighed; work-cost-aksen er ejer-låst på 0 (`tuning.ts:920`, RULES §9 pkt. 3), rør den ikke. (2) Grupetto-tempo: `groupStrengthSpeedFactor` (213-232) og `computeGroupTempo` (291-316) regner kun på `collectiveCp`, ingen effort-term; ejer-valg om modellen udestår. (3) 5-seed-gate: `buildV4AnchorBaseline.mjs:36` kører 3 seeds; bjerg-top-10-ankeret FAIL efter populationsskiftet (RULES §7 række 21), hænger sammen med #4707. (4) Felt-favoritters win-rate rød og ejer-gated; aldrig ved at straffe styrke (§7 række 10).

Filer/tests: `mechanics/effortCost.ts(.test.ts)`, `segmentLoop.ts` (`segmentLoop.effortCost/tailSpread/groupDraft.test.ts`), `mechanics/timeLimit.ts(.test.ts)`, `tuning.ts`, `buildV4AnchorBaseline.mjs`, `teamPlayAbMeasure.mjs(.test.mjs)`, `v4TailSpread.js(.test.js)`.

## 2. #4707 jagt-model vs. bjerg-anker

Bygget: efter #4975 er sprinter-ankeret og felt-sammenhængen PASS i §7b; jagt-modellen tæller gruppestørrelse (§7 række 13).

Mangler (= §7 række 14 + 16): to led i `netChaseAdvantage` (`mechanics/breakaway.ts:287-320`) er absolutte konstanter mod en evne-relativ skala: `lateRaceUrgency` (304) × `lateRaceUrgencyWeight` (`tuning.ts:623`) og `countFactor` (307, `breakawayReferenceCount`) → `countResistanceWeight` (313). Naiv relativisering skubbede bjerg-ankeret ud 3/9 (rullet tilbage). Bjerg-ankeret ejes af overskuds-grenen i fart-modellen (`tuning.ts:789 surplusWeight`, dok. 776-791) og trækker mod hale-båndet (790 `deficitWeight`). Skala-invarianter over 5/11/30/60/99.

Filer/tests: `mechanics/breakaway.ts(.test.ts)`, `tuning.ts` (`breakawayExtra` 615-630, `strengthSpeedExtra` 756-794), `segmentLoop.ts:213-232`, `finale.ts(.test.ts)`, `fieldIntegrity.test.ts`, `segmentLoop.tailSpread.test.ts`. Måling: `headToHeadV4.js --seeds=s1..s5` + `v4TailSpread.js --gate`.

## 3. #4915 TTT-følgesager

Bygget: TTT-gren forlader segment-loopet før hooks (`index.ts:198-200`); `mechanics/teamTimeTrial.ts` sætter `win_type: "ttt_win"` (396); bro-tests `raceEngineV4Bridge.teamTimeTrial.test.js`.

Mangler: uheld (M10): `incidentHook` kun i segment-loopet (`index.ts:73`), ingen wiring i TTT · tidsgrænse (M15): bevidst fravalgt (`index.ts:192-197`), `applyTimeLimit` efter TTT-grenen (~228-245); grupetto-redning kalibreret mod massestart (`tuning.ts:821-822`) · point: TTT producerer ingen `passages` (0 hits); broen `passagesFromV4Output` (`raceEngineV4Bridge.js:283-298`) gater det gamle lag af for v4 (244-250) → TTT giver 0 point · anker `same_team_top10_share_4plus` (`headToHeadAnchors.js:325-335`, 601) uden TTT-undtagelse; **de pinnede proxy-etaper har 0 ttt-rækker**, så at tilføje dem ændrer pinnet for alle spor · TTT i S4-kalender: `calendarCompositionTargets.js:94-102` (`KB_TARGET_FULL` ttt 4 / `INTERIM` 0 / `TTT_ENGINE_SUPPORTED = false` 101) + filler `raceStageProfileGenerator.js:245-249`: ejer-beslutning · v3-bonusloft (`bonus_seconds_bounded`, 607) kun relevant hvis flip glider · passage uden race_results ved DNF: ny datatilstand, ikke ejer-godkendt (`raceEngineV4Bridge.js:283-298` + `raceRunner.js`).

Tests: `mechanics/teamTimeTrial.test.ts`, `index.teamTimeTrial.test.ts`, `mechanics/incidents.test.ts`, `mechanics/timeLimit.test.ts`, `raceEngineV4Bridge.teamTimeTrial.test.js`, `headToHeadAnchors.test.js`, `calendarCompositionTargets.test.js`.

## 4. #4948 hjælp-sektionen raceDay

Bygget: `HelpPage.jsx:66 FLAG_GATED_SECTIONS`, `SECTION_ENABLED` (781), hardkodet `raceDayEnabled = false` (771, begrundelse 52-65, 766-770); samme hardkodning for træning (78 `TRAINING_TICK_PER_RACE_DAY_HELP_ENABLED`). Løsning A (globalt allowlistet flag-endpoint) rydder begge. Katalog findes: `backend/lib/stageFlagCatalog.js:58` (`race_engine_v4`), preview-mock `frontend/src/preview/betaAccessMock.js:43`. Mønster: `GET /board/room`. Ejer-go på teksten (`help.json` → `sections.raceDay`) udestår.

## 5. Flag

`race_engine_v4`: `backend/lib/raceEngineFlag.js:83-87`; læses `raceRunner.js:2001-2044, 2651, 2866`, `raceEngineV4Bridge.js:449`; DB-række `database/2026-09-07-4951-app-config-flag-rows.sql:19,32`; guard `scripts/check-feature-registry-flags.mjs:25` · `race_day_intention_enabled`: `raceIntentionFlag.js` · `race_engine_v3_scoring` SKAL være ON mens v4 kører (`raceEngineFlag.js:74-78`) · `race_stage_timeline` (55-58) · `board_mandate_model_enabled` via `GET /board/room` (`HelpPage.jsx:52-56`).

## 6. Overlap og lane-fordeling

Konflikter: `tuning.ts` (#4914 + #4707), `segmentLoop.ts` (#4914 grupetto vs. #4707 bjerg-anker), `mechanics/timeLimit.ts` (#4914 vs. #4915), RULES §7/§7b (alle), `baselines/v4-anchor-baseline.json` (#4914 og #4707 regenererer begge).

Ejerskab: **#4914:** `engine/v4/mechanics/effortCost.ts*`, `mechanics/timeLimit.ts*`, `scripts/buildV4AnchorBaseline.mjs`, `scripts/teamPlayAbMeasure.mjs*`, `scripts/v4TailSpread.js*` · **#4707:** `mechanics/breakaway.ts*`, `finale.ts*`, `segmentLoop.ts*`, `fieldIntegrity.test.ts`, `tuning.ts` · **#4915:** `mechanics/teamTimeTrial.ts*`, `index*.ts`, `mechanics/incidents.ts*`, `scripts/lib/headToHeadAnchors.js*`, `calendarCompositionTargets.js*`, `raceStageProfileGenerator.js`, `raceEngineV4Bridge*.js` · **#4948:** `HelpPage.jsx`, `locales/*/help.json`, nyt `backend/api/featureFlagsApi.js`, `stageFlagCatalog.js`.

Serialisering: `tuning.ts` ejes af ÉN lane ad gangen (#4707 først; #4914 leverer `effortCostExtra` 577-583 som sidste rebase). Baseline-JSON + §7b regenereres én gang til sidst. #4948 er helt uafhængig.

## 7. Faldgruber

- Golden fixtures `engine/v4/fixtures/{bjerg-selektion,flat-massespurt,nedkoerselsfinale,punch-finale-forspring}/expected.json` (`fixtures.test.ts`) fryser output bit-for-bit; de fryser også §7 række 18's kendte fejl (`PLACEHOLDER_WIN_TYPE`, `index.ts:159,168`), ret den ikke som sidegevinst.
- §7b-synk: `renderV4AnchorTable.mjs --check` fejler ved drift; kør `buildV4AnchorBaseline.mjs && renderV4AnchorTable.mjs --write` i samme PR.
- Hale-gaten ejer-låst på 3 seeds (RULES §9 række 13), flyt den ikke til 5 (præcedens `teamPlayAbMeasure.mjs:53-55`).
- Re-eksportér ikke population/etaper (#4936: to ankre skiftede dom af populationsskiftet alene; sha256 i §7b).
- Kalender: TTT-flip rører KB-mål + generator; gate #4123 blokerende; `backend/scripts/dev/calendarGoldenDiff.mjs` FØR S4-generering.
- Ejer-gated: flippet (RULES §5 F6), holdspilsniveau, felt-favorit-ankeret, grupetto-tempo-modellen, raceDay-teksten, DB-oprydning multi-hunter (§7 række 12).
- Hard rule 17: ingen motor-interne vægte i issue/PR-body; anker-tal er offentlige.
- Kør aldrig v4 med `race_engine_v3_scoring` OFF (`raceEngineFlag.js:74-78`).
