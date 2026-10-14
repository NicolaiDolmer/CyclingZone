# S5-etapeprofiler: byg-plan + målt baseline (13/10)

Epic **#6369**. Spec (design-go ejer 12/10): [`../specs/2026-10-12-s5-etapeprofiler-design.md`](../specs/2026-10-12-s5-etapeprofiler-design.md). Benchmark: `docs/design/s5-benchmark/gt-2021-2025.json` (315 GT-etaper). Deadline: S5-kalenderen live senest **lørdag 18/10**. Ingen låste beslutninger er genåbnet her; alle tal i §5 og §3 er ejerens.

Hard rule 36: motor/DB-delene har målt baseline (§2) før første PR.

## 1. Kortlægning af nuværende kode

| Del | Hvor | Hvad den gør i dag | Hvad S5 kræver |
|---|---|---|---|
| Pass 1 (type + finale) | `backend/lib/raceStageProfileGenerator.js` (`PROFILE_TYPES` l.106, `FINALE_TYPES` l.110, `DEMAND_VECTORS` l.120, `FINALE_WEIGHTS_BY_PROFILE` l.160, `ARCHETYPE_PROFILES` l.234, `balanceFinaleQuotas` l.694, `weaveGrandTourScaffold` l.914, `GENERATOR_VERSION = 5`) | Typen trækkes FØRST (arketype-garantier + filler-vægte), finalen trækkes af vægte pr. type og kvote-balanceres pr. tier | Typen afledes af stigningerne (B+), finalen vælges inden for matrixen (§3), GT får kvoter + ugestruktur (§5) |
| Pass 2 (rute) | `backend/lib/raceRouteGenerator.js` (`CLIMB_SPEC` l.114, `CAT_PROFILE` l.134, `UPHILL_FINISH_SHARE` l.145, `BASE_ELEVATION` l.150, `buildClimbs` l.223, `elevationGain` l.460, `attachRoute` l.475) | Stigninger trækkes ud fra den allerede valgte type med overlappende spænd (rod-årsagen i #6359). Sidste ikke-topmål-stigning lægges altid 5-20 km før mål, så næsten alle kuperede/bjergetaper får nedkørsels-geometri. Højdemeter = stigninger + fast grundtal pr. type | Stigninger først, type bagefter; finale-geometri (sidste 0,5-3 km, gradient) som egen akse; højdemeter regnet af ruten (#6366) |
| DB-CHECK (prod, læst 13/10) | `race_stage_profiles_profile_type_check`, `race_stage_profiles_finale_type_check` | profile_type: flat, rolling, hilly, mountain, high_mountain, itt, itt_hilly, ttt, cobbles, gravel, classic · finale_type: bunch_sprint, reduced_sprint, punch, long_climb, descent, solo_tt, breakaway | Additivt: `medium_mountain`, `uphill_sprint`, `wall_finish` + underlags-kolonne/-felt. Gamle værdier bliver (S1-S4 historik) |
| Motor v4 | `backend/lib/engine/v4/tuning.ts` (finale-demand l.138-143; pr.-finale-tabeller l.865, l.950, l.984, l.1004), `finale.ts` (`isMassFinishRoute`, `fieldFinaleTypeBehindBreakaway`, demand-opslag l.612), `types.ts` l.133, `adapters/routeAdapter.ts`, `mechanics/breakaway*.ts` | Kender kun de 7 finaletyper; `breakaway` er en finaletype med egne vægte | Nye finaler + durability-hybrid (spec §4), mellembjerg-terræn, udbrud som adfærd (#6368). Bag ny regel-revision i `backend/lib/raceEngineRulesRevision.ts` (binder pr. løb ved første etape) |
| Kalender-gaten | `backend/scripts/dev/calendarGoldenDiff.mjs` (#4123) + `lib/__fixtures__/calendarGoldenSnapshot.s3.json`; `backend/scripts/buildSeasonCalendar.js` (dry-run default, hårde gates + `--allow-*-drift`); `lib/stageFinaleMetrics.js` (TERRAIN_FINALE_BANDS, §7b), `lib/calendarCompositionTargets.js` (`PROFILE_TO_CATEGORY`, K-B), `lib/raceRouteRealismMetrics.js` | Golden diff måler PLACERING af løb (ikke terræn). Finale-bånd og K-B-komposition kender kun de gamle typer | Ny benchmark-gate (#6367) oven i de eksisterende gates; nye typer skal have kategori/bånd ellers fejler regressionsvagterne |
| Offline tørkørsel | `scripts/dev/calendarDryRunLocal.mjs`, `scripts/dev/lib/s3OfflineCalendarPlan.mjs` (fixture `racePoolCatalog.prod.json`, hentet 3/9) | Pakker kalenderen uden DB | Bruges til S5-tørkørsel (§2.2); fixturen bør genopfriskes før den endelige tørkørsel |
| Motor-bench | `backend/scripts/dev/motorBench.mjs` (read-only, `--revisions=a,b`) | Skyggeløb af prod-etaper under to revisioner | Tidsgab pr. ny finale mod benchmark-facit (spec §5) |
| Frontend | `frontend/src/lib/{stageProfileConfig,stageRouteProfile,stageTerrain,terrainBucket,terrainTypeIcons}.*`, `components/race/{StageProfileCard,StageProfileGraph,StageDetailPanel,RaceStageProfileRow,StageStripe,TerrainTypeGlyph}.jsx`, `components/calendar/TerrainGlyph.jsx`, `public/locales/{en,da}/{races,calendar,planner,rider,help}.json` | Én etiket (profile_type) + dobbelt profil | Etapekortet (spec §6) med tre akser |

## 2. Målt baseline (read-only, 13/10)

Metode: SELECT via Supabase MCP på `race_stage_profiles` ⨝ `races` ⨝ `seasons` (kolonnenavne fra `database/schema-snapshot.json`), senior, **én række pr. unikt parcours** (`pool_race_id` + etape; samme løb i flere puljer tæller én gang). B+ (spec §2) og finale-geometri er regnet af de gemte `climbs`. S5 findes ikke i `seasons` endnu (S4 `active`, 502 løb).

Geometri-klassen er en tilnærmelse: "kort op" = topmål på kat. 3/4 (bakke/mur/stigende spurt kan ikke skelnes uden gradient sidste km, som ruten ikke har i dag); "nedkørsel" = sidste kat. 3-eller-hårdere top 5-25 km før mål.

### 2.1 S4 (prod), senior

| | n | Flad | Bølget | Kuperet | Mellembjerg | Bjerg | Højbjerg | TT |
|---|---|---|---|---|---|---|---|---|
| Alle unikke etaper (B+) | 420 | 120 (29 %) | 10 (2 %) | 74 (18 %) | 75 (18 %) | 42 (10 %) | 61 (15 %) | 38 (9 %) |
| 3 GT'er, 52 etaper (B+) | 52 | 12 (23 %) | 0 | 14 (27 %) | 5 (10 %) | 4 (8 %) | 11 (21 %) | 6 (12 %) |
| Benchmark (315 GT-etaper) | 315 | 18 % | 3 % | 22 % | 10 % | 22 % | 16 % | 10 % |

- S4 GT finale_type (52): long_climb 11 · bunch_sprint 9 · reduced_sprint 9 · breakaway 6 · descent 6 · punch 5 · solo_tt 6. Geometri: bjergtop 11 (21 %) mod benchmark 28 %.
- Finale-geometri, alle 420: nedkørsel-geometri 142, bjergtop 97, kort op 15, flad mål 128, TT 38. Kuperet-etaper: 61 af 74 har nedkørsels-geometri (følger af `buildClimbs`' faste 5-20 km-placering, ikke et valg).
- Spec §2's S4-tal (407/20/200/278/137/164) er talt over alle puljerækker; tallene her er pr. unikt parcours. Fordelingen peger samme vej.

### 2.2 S5 tørkørt med nuværende generator (offline, intet skrevet)

Kørsel: scratchpad-script på `buildTierMaterializationPlan` + `generateRaceStageProfiles` + `balanceFinaleQuotas` mod `racePoolCatalog.prod.json` (3/9), første løbsdag 28/10 (pladsholder til #5833), 28 dage, 3 seeds (S5-season_id kendes ikke endnu, så seedet er repræsentativt). Realisme-gen-trækket (`season_variant`) er ikke med.

| Seed | Unikke | Flad | Bølget | Kuperet | Mellembjerg | Bjerg | Højbjerg | TT | Type ≠ B+ |
|---|---|---|---|---|---|---|---|---|---|
| A, alle | 420 | 128 | 2 | 57 | 79 | 64 | 54 | 36 | 119 af 351 (34 %) |
| B, alle | 420 | 120 | 6 | 63 | 73 | 57 | 63 | 38 | 123 |
| C, alle | 420 | 118 | 8 | 65 | 73 | 58 | 60 | 38 | 119 |
| A, GT (52) | 52 | 14 | 0 | 6 | 10 | 5 | 11 | 6 | 19 |
| B, GT | 52 | 13 | 1 | 12 | 5 | 5 | 10 | 6 | 14 |
| C, GT | 52 | 18 | 1 | 6 | 10 | 3 | 9 | 5 | 19 |

Pr. GT (3 GT'er på 18/17/17 etaper) mod ejerens kvoter (spec §5):

| Pr. GT | Kvote Tour/Giro/Vuelta | S5 nuværende generator (gns. 3 seeds) | Afvigelse |
|---|---|---|---|
| Højbjerg | 5 / 2 / 2 | 3,3 (et løb fik 7) | Spredning, ikke niveau |
| Bjerg | 1 / 4 / 6 | 1,4 | **For få** (Giro/Vuelta-type mangler 3-5) |
| Mellembjerg | 1 / 2 / 2 | 2,8 | For mange (falder ud af "hilly"/"mountain" ved et tilfælde) |
| Kuperet | 5 / 4 / 2 | 2,7 (et løb fik 0) | For få og ustyret |
| Bølget | 1 / 0 / 0 | 0,2 | |
| Flad | 3 / 3 / 3 | 5,0 | **For mange** |
| TT | 2 / 2 / 1+TTT | 1,9 (aldrig TTT) | TTT mangler |
| Bjergtop | 4 / 4 / 7 | 4,3 | Ok i snit, men ikke styret pr. type |

Konklusion: nuværende generator rammer hverken kvoterne eller typenavnet (34 % af etaperne har en type der ikke passer med ruten) og kan ikke give mur, stigende spurt eller bakke som afslutning. Det er baseline for benchmark-gaten.

Benchmark-facit (egen udregning fra JSON): finaler flad spurt 34 % · bjergtop 28 % · nedkørsel 18 % · stigende spurt 6 % · bakke 3 % · mur 2,5 % · TT 9,5 %. Median gap10: bjergtop 116 s · mur 70 s · nedkørsel 64 s · enkeltstart 63 s · bakke 21 s · stigende spurt 4 s · flad spurt 0 s (spec §5 bruger de korrigerede tal efter kort 5; gaten bruger spec'ens).

## 3. Rækkefølge

```
13/10  Fase 0 kontrakt-PR (orkestrator, opus)  ── merge + migration apply post-merge
14-16/10  Bølge: Spor 1 ║ Spor 2 ║ Spor 3 ║ Spor 4   (4 laner, verify-semafor 2)
16/10 aften  Integration: hele S5 tørkørt + benchmark-gate + motor-bench
17/10  Før/efter-billede → ejer-go · preview-go på etapekortet
18/10  buildSeasonCalendar --season 5 --apply (ejer-go pr. skridt) → verify → #5841 synlig
```

### Fase 0: kontrakt (én PR, før bølgen, opus)

Gør sporene uafhængige ved at lægge det delte ordforråd først:

- `PROFILE_TYPES` + `medium_mountain`; `FINALE_TYPES` + `uphill_sprint`, `wall_finish` (og `flat_sprint`-navnet som alias, spec §3: flad spurt afløser bunch/reduced; gamle værdier bevares til historik). Underlags-felt (spec §1C) som del af `sectors`/ny kolonne: beslut i PR'en ud fra hvad motoren allerede læser (`sectors`).
- Migration (additiv, idempotent): udvid de to CHECK'er. Apply post-merge per #2642, Claude post-verificerer med `pg_get_constraintdef`.
- `engine/v4/types.ts` FinaleType/ProfileType-unions + tom regel-revision `s5_profiles_v1` (ikke aktuel, ikke tændt).
- Legacy-mapping-funktion (gammel type/finale → S5-akser) så frontend og gate kan læse S1-S4.
- Regressionsvagter der kræver kategori pr. type (`calendarCompositionTargets.test.js`, stageFinaleMetrics) opdateres med pladsholder-kategorier.
- Verify: `node --test` backend, `pwsh -File scripts/preflight-pr.ps1`, TIER FULL (`scripts/verify-local.ps1`, delte libs).

### Spor 1: generator (#6359, model opus)

Issue #6359 (dækker generator-delen af #6360/#6361/#6362/#6363 og #6366, fordi de rører samme funktioner; `Refs` på dem, ingen separate workers på samme fil).

- Filer: `backend/lib/raceRouteGenerator.js`, `backend/lib/raceStageProfileGenerator.js`, `backend/lib/raceStageOrderProfiles.js`, `docs/CALENDAR_RULES.md` (én B+-regel), `lib/__fixtures__/pass1-golden.json` (regenereres bevidst), tests `raceRouteGenerator.test.js`, `raceStageProfileGenerator.test.js`, `routeSegments.test.js`.
- Indhold: stigninger trækkes først pr. "terræn-mål", typen afledes med B+ (spec §2) som ren eksporteret funktion; finale vælges kun inden for matrixen (spec §3) og ruten får finale-geometri (sidste km-gradient for mur/stigende spurt/bakke, nedkørsel kun når top er kat. 3+); GT-kvoter for Tour/Giro/Vuelta-typen + ugestruktur (ingen højbjerg i første tredjedel, kongeetape i sidste tredjedel, kort ITT tidligt + sen, sidste dag flad/ITT); `BASE_ELEVATION` fjernet (#6366); TTT genereres igen kun for Vuelta-typen hvis Spor 2 bekræfter at motorens TTT (`mechanics/teamTimeTrial.ts`) må bruges, ellers ITT (ejer-beslutning, se risici). `GENERATOR_VERSION` 5 → 6.
- Test: property-test "type == B+(climbs)" for alle genererede etaper over N seeds; matrix-test (ulovlig kombination kaster); kvote- og ugestruktur-test pr. GT-type.
- Verify: TIER FULL (`scripts/verify-local.ps1`) + offline S5-tørkørsel (§2.2-scriptet gjort permanent som `scripts/dev/s5ProfileDryRun.mjs`).

### Spor 2: motor (#6363 + #6362 motor-del, #6368, model opus)

Issue #6363 (Refs #6362 #6360 #6368).

- Filer: `backend/lib/engine/v4/tuning.ts`, `finale.ts`, `adapters/routeAdapter.ts`, `mechanics/breakaway.ts`, `mechanics/breakawayPermission.ts`, `ai/aiTactics.ts`, `mechanics/timeModel.ts`, `backend/lib/raceEngineRulesRevision.ts`, `backend/lib/raceTerrain.js`, motor-fixtures under `engine/v4/fixtures/` (nye: mur-finale, stigende spurt, mellembjerg).
- Indhold: demand-vektorer for mur (punch 40 · acceleration 30 · position 10 + 20 hybrid, ingen klatring), bakke (klatring 15 + taktik 15 erstattet af hybrid), stigende spurt (sprint-tungt + hybrid); hybrid = 20 point efter antal tidligere kategoriserede stigninger (0-1 → punch, flere → durability). Mellembjerg som terræn i motorens bucket. Alle pr.-finale-tabeller i tuning.ts får rækker for de nye finaler. `breakaway` som finale afløses af sen-angrebs-adfærd (#6368) for S5-revisionen; gamle løb uændrede (revision binder pr. løb).
- Alt bag revision `s5_profiles_v1`. Tænding er ejer-only (memory: aldrig gen-tænde motor uden go).
- Test: `node --test` + motor-fixture-goldens; motor-bench `node backend/scripts/dev/motorBench.mjs --revisions=official_times_v3,s5_profiles_v1` på tørkørte S5-ruter (`--from-cache`) mod spec §5's tidsgab-facit (mur ~43 s, bakke ~21 s, stigende spurt ~2 s, bjergtop ~116 s).
- Verify: TIER FULL. Kører i verify-semaforen (`scripts/verify-lock.ps1 -Max 2`).

### Spor 3: benchmark-gate (#6367, model opus)

- Filer: ny `backend/lib/s5BenchmarkGate.js` (+ test), `backend/scripts/dev/calendarGoldenDiff.mjs` / `scripts/dev/lib/calendarGoldenDiffReport.mjs` (ny sektion), `backend/scripts/buildSeasonCalendar.js` (gaten som hård gate, ingen override), `lib/stageFinaleMetrics.js`, `lib/calendarCompositionTargets.js` (`PROFILE_TO_CATEGORY` for medium_mountain), `lib/raceRouteRealismMetrics.js`, `docs/CALENDAR_RULES.md`.
- Gaten (grøn påkrævet før `--apply`): (1) hver etape: type == B+(climbs) og finale ∈ matrix; (2) pr. GT: kvoter fra spec §5 pr. GT-type (± tolerance der fastlægges i PR'en og vises ejeren som tal) + ugestruktur; (3) sæson: finale-andele mod benchmark-fordelingen; (4) motor: median gap10 pr. finale fra motor-bench inden for benchmarkens interval. Baseline i §2 skal give RØD på (1)-(2) — det er gatens egen test.
- Kan bygges mod Fase 0's typer og syntetiske fixtures, uafhængigt af Spor 1.
- Verify: TIER FULL (config/delte libs).

### Spor 4: etapekortet + i18n + Hjælp (#6364, model sonnet)

Issue #6364 (Refs #6365).

- Filer: `frontend/src/components/race/StageProfileCard.jsx`, `StageProfileGraph.jsx`, `StageDetailPanel.jsx`, `RaceStageProfileRow.jsx`, `TerrainTypeGlyph.jsx`, `components/calendar/TerrainGlyph.jsx`, `frontend/src/lib/{stageProfileConfig,stageTerrain,terrainBucket,terrainTypeIcons}.*`, `public/locales/{en,da}/{races,calendar,planner,help}.json`, `PatchNotesPage.jsx` (samlet ved close-out, ikke i PR'en).
- Indhold: spec §6 (tre akser, én profil m. kategori-mærker og afgørende stigning, "her afgøres etapen", "dagen kræver" høj/mid/lav). Læser via Fase 0's legacy-mapping, så S4-etaper vises korrekt. T3-skabelon, TASTE, TONE_OF_VOICE, EN først. Hjælp-tekst (help.json en+da) for de tre akser og nye afslutninger.
- Verify: `npm run lint`, `node --test`, build, hele `npm run test:e2e` (i18n), snapshots i alle 3 Playwright-projekter. Ejer-go på preview med samlet før/efter-billede før merge (memory-regel).

### Ikke i bølgen (tages når en lane frigøres)

- **#5841** S5-kalenderen synlig før skiftet + kun egen divisions løb: skal være klar 18/10. Første frie lane (sonnet, frontend).
- **#3463** TTT-format: motoren har TTT (`mechanics/teamTimeTrial.ts`), men "formatvalg + egen tid til droppede" er ikke bygget. Se risici.

## 4. Integration og gate før live (16-18/10)

1. Genopfrisk `racePoolCatalog.prod.json` read-only (`scripts/dev/dumpRacePoolFixture.mjs`).
2. Tørkør hele S5: `node backend/scripts/buildSeasonCalendar.js --season 5 --first-day <#5833-dato> --uniform-tilt` (dry-run, intet skrives) + offline `s5ProfileDryRun.mjs` på 5 seeds.
3. Benchmark-gaten grøn + eksisterende hårde gates grønne + `calendarGoldenDiff.mjs` exit 0 (placering bør være uændret; terrænet er ikke en del af golden-diffen).
4. Motor-bench på de tørkørte S5-ruter under `s5_profiles_v1`.
5. Før/efter-billede (§2-tabellerne mod S5-tørkørslen mod benchmark) → ejer-go.
6. `--apply` (ejer-go på netop det skridt) → post-verify med SELECT (fordeling pr. GT, CHECK, antal løbsdage) → #5841 synlig.
7. Revision `s5_profiles_v1` tændes kun på ejerens ordrette go, før S5's første etape.

## 5. Risici mod 18/10

1. **S5-startdatoen (#5833) er ikke i repoet.** Uden den kan `--apply` ikke køres (`resolveCalendarFrom` kræver dato). Skal afklares senest 16/10.
2. **Generator-omskrivningen er den lange pol.** B+ + matrix + kvoter + ugestruktur i én PR på en fil med fem års kalibrering (K-B, §6b, §7b-finalebånd). De eksisterende komposition-/finale-gates vil fejle på de nye typer; Spor 3 skal levere nye mål samtidig, ellers blokerer `buildSeasonCalendar` med drift. Fallback: `--allow-finale-drift` kun med ejer-go.
3. **Motor-vægte uden målt facit.** Spec §4: "præcise vægte måles mod motor-bench før live". Kræver mindst én bench-iteration; hvis gab-facit ikke rammes 16/10, kan generatoren gå live med nye typer mens revisionen holdes slukket (motoren kører så de nye finaler på legacy-mapping). Det er en ejerbeslutning.
4. **TTT i Vuelta-typen** afhænger af #3463 (formatvalg). Forslag til ejeren: ITT i stedet i S5, TTT når #3463 er færdig.
5. **Ét regenereret fixture-sæt pr. spor** (`pass1-golden.json`, motor-goldens, snapshots) giver merge-konflikter; merge-kø én ad gangen (`scripts/merge-queue.ps1`), Fase 0 først.
6. **Fixture er fra 3/9.** Katalog-ændringer siden da ændrer udvalget; genopfrisk før den endelige tørkørsel.
7. **Frontend kræver visuelt ejer-go** på preview; planlæg billedet til 17/10 formiddag.
