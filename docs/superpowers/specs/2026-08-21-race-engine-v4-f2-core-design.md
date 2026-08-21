# Race Engine v4 F2: motor-kernen — teknisk design (implementeringsklar)

> Barn af [2026-08-20-race-engine-v4-intra-stage-design.md](2026-08-20-race-engine-v4-intra-stage-design.md) (spec-SSOT, beslutning 1-26). Dette dokument låser F2's tekniske valg så byggearbejdet kan parallelliseres. Refs #4030 #3855.
> Tidsramme (addendum 8c): F2-kerne 21/8 → F3-bølge 22/8 → head-to-head 23-24/8 → ejer-gate 24/8 aften → evt. live tir 25/8 (v3-fallback ved rødt).

## 1. Tekniske valg (arkitekt, 21/8)

| Valg | Beslutning | Hvorfor |
|---|---|---|
| Placering | `backend/lib/engine/v4/` | Ingen npm workspaces i repoet; backend er ét npm-projekt med `node --test`-suite og CI-job. Adapters bor ved siden af forbrugerne (raceRunner). `packages/engine` fravalgt: ny workspace-infrastruktur uden gevinst før live-reveal-frontend evt. skal dele kode (F4+). |
| TS-strategi | **Erasable TypeScript kørt direkte af Node 24's type stripping** + `tsc --noEmit --strict` som CI-typegate | Ingen build-step, ingen bundler; `node --test` kører `.ts`-testfiler direkte. Krav: kun erasable syntax (ingen `enum`, ingen `namespace`, ingen parameter properties), `verbatimModuleSyntax`, eksplicitte `.ts`-extensions i imports (matcher #803-læringen). |
| tsconfig | `backend/tsconfig.engine.json` scoped til `lib/engine/v4/**` | Rører ikke resten af backend (som forbliver JS). `strict: true`, `erasableSyntaxOnly: true`, `noEmit`, `allowImportingTsExtensions`. |
| CI | Nyt step i `backend-tests`-jobbet: `npx tsc -p tsconfig.engine.json` (typescript som devDependency) | Intet eksisterende TS-mønster at genbruge; ét step, fejler ved type-fejl. Testene kører allerede med i `npm test` (run-tests.js samler `*.test.js` — udvides til også at finde `lib/engine/v4/**/*.test.ts`). |
| Renhed | Kernen importerer INTET fra det øvrige backend (heller ikke raceSimulator) | IO-fri, DB-fri, Date-fri, Math.random-fri. Egne kopier af `stableSeed`/mulberry32 i `rng.ts` (samme kontrakt; duplikering er etableret mønster, jf. routeSegments/raceTimeline — cyklisk-import-undgåelse). Adapters (uden for kernen) oversætter DB-rækker ↔ kerne-typer. |

## 2. Kerne-kontrakten (frossen — workers bygger imod denne)

Én deterministisk funktion. Samme input ⇒ byte-identisk output.

```ts
// index.ts
export function simulateStageV4(input: StageInput): StageOutput

// types.ts (uddrag — fuld fil er SSOT)
type StageInput = {
  route: RouteV2                    // fra F1: { distance_km, profile_type, finale_type, segments: Segment[], weather: Weather, waypoints }
  startlist: Entrant[]              // per-rytter state ved start
  orders: TeamOrder[]               // F2: tom liste accepteres (ordrer = M5/M14, F3)
  seed: string                      // etape-seed (commit-reveal-mønstret består)
  tuning: EngineTuning              // ALLE konstanter; default i tuning.ts, overridable i harness
}

type Entrant = {
  rider_id: string
  abilities: Record<AbilityKey, number>   // de 15 registry-evner, 0-99 (abilityRegistry er kanonisk liste)
  role: RiderRole                          // fra v3-rollemodellen (adapter mapper)
  effort: 'protect' | 'normal' | 'save'    // M12-kontrakten; F2 behandler alle som 'normal'
  condition: number                        // 0-1, dag-til-dag-slid (M7 forbruger i F3; F2 bærer feltet)
}

type StageOutput = {
  timeline: { timeline_version: 2, events: TimelineEvent[] }   // PRÆCIS #2410-taksonomien, nativt emitteret
  results: StageResult[]            // { rider_id, rank, time_seconds, group_id, status }
  loads: RiderLoad[]                // beslutning 18: { rider_id, wprime_depleted_j_norm, seconds_over_cp, work_norm }
  groupSnapshots: SegmentGroupSnapshot[]  // beslutning 20: pr. segment-grænse: [{ group_id, kind, rider_ids, gap_seconds }]
}
```

Invarianter (property-based tests, `fast-check` som devDependency):
1. **Determinisme:** `simulateStageV4(x)` deep-equal ved gentagne kald; per-rytter-hash så én ekstra tilmelding ikke flytter andres relative udfald i uafhængige mekanikker.
2. **Gruppe-tid:** alle i samme mål-gruppe har identisk `time_seconds` (rent princip, beslutning 5).
3. **Monotoni:** inden for samme gruppe ved segment-start kan en rytter med lavere testet evne aldrig ende med BEDRE tid end en med højere (støj skalerer magnitude, aldrig fortegn) — se §4.
4. **Km-dækning:** timeline-events har `0 ≤ km ≤ distance_km`, monotont ordnet; taksonomi-konsistensregler fra #2410 §2.3 håndhæves.
5. **Fog-gate (#1791):** ingen rå komponenter/vægte/sandsynligheder i `events[].params` (samme test-mønster som raceTimeline.test.js).

## 3. Modul-layout

```
backend/lib/engine/v4/
  index.ts          orkestrering: init → segment-loop → finale → emission
  types.ts          ALLE kontrakter (frossen først, ændres kun af arkitekt)
  rng.ts            stableSeed (FNV-1a) + mulberry32 + gaussian + navngivne streams: rngFor(seed, mechanic, riderId?)
  tuning.ts         EngineTuning-default: alle konstanter samlet, Object.freeze (mønster: RACE_V3_TUNING)
  physiology.ts     CP/W'-afledning + tick-model (§5)
  groups.ts         M1: gruppe-state, split/merge, gap-bogføring, tid-tildeling
  segmentLoop.ts    event-drevet loop pr. segment (§4)
  finale.ts         M4 punch-finale + placerings-opgør i frontgruppen
  mechanics/
    climbSelection.ts   M2 (gradient × klatre-underskud × W'-rest)
    descent.ts          M3 (monotoni-garanti, descent attack 10-20 s-loft, risiko-kobling)
  timeline.ts       nativ event-emission, timeline_version 2, #2410-taksonomien
  adapters/         (uden for renheds-grænsen, må importere backend-moduler)
    entrantAdapter.ts   rider_derived_abilities-række + rolle → Entrant
    routeAdapter.ts     race_stage_profiles-række → RouteV2 (synthesizeSegments-fallback for legacy)
  fixtures/         golden fixtures: syntetiske startfelter + faste ruter (committet), bit-identitets-snapshots
  *.test.ts         kontrakt-tests pr. modul + property-tests
```

## 4. Segment-loop + gruppemodel (M1)

State mellem segmenter = spec §3.2 (`groups`, `riders`, `km`, `virtual_gc`). Pr. segment:

1. **Krav-tempo:** gruppens front-tempo afledes af segment-kind + stærkeste motorer i gruppen (kollektiv CP, læ-rabat for position: front betaler `tuning.frontWorkFactor`, hjul betaler `tuning.draftFactor` — flat/rolling høj rabat, climb lav, descent mellem).
2. **Fysiologi-tick (§5):** hver rytter betaler segmentets effekt-krav; over CP → W'-tæring, under → genopladning.
3. **Events:** selektions-tjek (M2 på climb-segmenter: ryttere hvis W' rammer nul ELLER hvis klatre-underskud × gradient overstiger tærskel, splitter bagud som `chase`/`gruppetto` — `peloton_splits`-event med årsag), descent-tjek (M3: teknisk nedkørsel + stor descending-forskel + `tuning.descentAttackWindow` → `finale_attack`-event nedad, gevinst clamped 10-20 s, seeded styrt-risiko let forhøjet, dæmpet af descending — `incident`-event med km), brosten-segmenter bærer kaos-hook (fuld M8 i F3, F2 emitterer kun passage).
4. **Gap-bogføring:** grupper bevæger sig med egen hastighed; gaps opdateres pr. segment (`gap_update`-events ved tærskler). Sammensmeltning når gap < `tuning.mergeThreshold` (`breakaway_caught`-mønstret).
5. **Snapshot:** per-segment gruppe-snapshot appendes (beslutning 20).

**Finalen (M4):** ved sidste klatre-/punch-segment bæres forspring over toppen EKSPLICIT ind: frontgruppens placerings-opgør scorer `punch`-tungt ved `finale_type: 'punch'` (demand-vektor pr. finale-type i tuning), med `carriedGapSeconds` som reelt forspring — første mand over toppen med W'-reserve VINDER medmindre indhentet af målbar mekanik (jagt-tempo > flugt-tempo over rest-km). Fixer #3965 strukturelt.

**Monotoni-implementering:** selektions-score = `deficit(testetEvne) + energiUnderskud + støj` hvor støj ~ N(0, sd·|deficit|-skaleret) — OG en rank-guard efter hvert split: inden for præ-split-gruppen sorteres udfalds-tider så rækkefølgen på den testede evne aldrig inverteres (støj flytter afstande, ikke fortegn). Guard'en er en ren post-sortering, testbar som property.

## 5. W'/Critical Power-model (beslutning 17, v1-formler — kalibreres i head-to-head)

Alle værdier normaliserede (0-1); ingen fysiske watt i F2 (genre-first, fog-gate).

- `cp = w.tempo·A.tempo + w.endurance·A.endurance + w.climbSpec·A.climbing·isClimb + w.tt·A.time_trial·isFlat` (terræn-vægtet tærskel; vægte i tuning, normaliseret /99)
- `wprimeMax = w.punch·A.punch + w.accel·A.acceleration + w.sprint·A.sprint` (anaerob reserve)
- `rechargeRate = base · (0.5 + 0.5·A.recovery/99)` pr. sekund under CP
- Tick pr. segment: `demand > cp` ⇒ `wprime -= (demand − cp)·dt`; ellers `wprime += rechargeRate·(wprimeMax − wprime)·dt` (eksponentiel genopladning, W'bal-inspireret)
- `wprime ≤ 0` ⇒ rytteren KAN ikke følge accelerationer/splits (tvungen selektion); dagsform (v3-mønstret: per-rytter-hash gaussian, genbygget i kernen med samme kontrakt) modulerer `cp` ±, jour sans som sjælden negativ hale — kontrakten fra raceDayForm genskabes rent i `physiology.ts`.
- Output pr. rytter (beslutning 18): `wprime_depleted_j_norm` (samlet tæring), `seconds_over_cp`, `work_norm` — trænings-/udviklingssystemet forbruger senere; kontrakten ligger fast nu.

## 6. Tidslinje (nativ)

`timeline.ts` emitterer under selve loopet (ikke syntetisk baglæns som v3's raceTimeline.js): samme event-former `{ km, type, params }`, km 2 decimaler, taksonomien fra #2410 (stage_start, peloton_splits, gap_update, kom_passage, incident, finale_attack, sprint_decided, finish, gc_change, …). `timeline_version: 2`. Persisterings-vejen (raceRunner.persistStageTimelines) genbruges uændret — aftagerne kan ikke se format-forskel, kun ægthed (spec §3.4).

## 7. Test- og fixture-plan

- **Kontrakt-tests pr. modul** (node --test, .ts): physiology (tæring/genopladning/grænser), groups (split/merge/tid), mechanics, timeline-konsistens.
- **Property-tests** (fast-check): invarianterne i §2. Min. 4 properties, 200 runs, seeded.
- **Golden fixtures:** 4 committede syntetiske scenarier (flad massespurt, bjerg-selektion, punch-finale m. forspring over top, nedkørselsfinale) — input + forventet fuldt output som JSON; bit-identitet ved samme seed.
- **Harness-hook:** `backend/scripts/headToHeadV4.js` (F2 leverer stub, fuld version til 23-24/8): kører v3 (`simulateStage`) og v4 (`simulateStageV4`) på samme population-snapshot (`exportPopulationSnapshot.js`) + S3-kalenderens ruter, scorer BEGGE mod §5-ankrene i mor-spec'en (felt-sammenhæng 80-95 %, nedkørsels-ratio, punch-korrelation, dominans 25-40 %, gap-realisme-bånd fra #2415).

## 8. Byggeplan (worker-faser, 21/8)

| Fase | Indhold | Afhængighed |
|---|---|---|
| A (én worker, sekventiel) | tsconfig + CI-step + `types.ts` (fra dette dokument) + `rng.ts` + `tuning.ts` + `physiology.ts` + `groups.ts` + `segmentLoop.ts`-skelet med flat-only gennemløb + determinisme-test grøn | — |
| B1 (parallel efter A) | `mechanics/climbSelection.ts` (M2) + tests | A's kontrakter |
| B2 (parallel efter A) | `mechanics/descent.ts` (M3) + tests | A's kontrakter |
| B3 (parallel efter A) | `finale.ts` (M4) + tests | A's kontrakter |
| B4 (parallel efter A) | `timeline.ts` + adapters + golden fixtures + property-suite + harness-stub | A's kontrakter |
| C (arkitekt) | Integration-review, fixture-godkendelse, PR-samling | B1-B4 |

Én samlet PR (`feat/4030-engine-v4-f2-kerne`) — rent additiv, intet kaldes fra prod, ingen patch note (ikke spillervendt endnu; skrives ved flag-flip).
