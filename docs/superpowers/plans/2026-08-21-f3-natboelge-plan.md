# F3-natbølge 21-22/8 — køreklar bølgeplan (handoff til aften-sessionen)

> Ejer-godkendt plan-indhold 21/8 (dag-sessionen); **launch-go mangler** og gives i aften-sessionen (runbook trin 2-4: preflight → go → launch i SAMME tur → launch-bevis på skærm). Læs `docs/NIGHT_WAVE_RUNBOOK.md` FØR launch. Refs #3855 #4030.

## Kontekst (minimum at læse)

- F2 er MERGED til main (PR #4072): `backend/lib/engine/v4/` — ren TS-kerne, `simulateStageV4`, M1-M4 wiret, tidslinje v2, adapters, golden fixtures, head-to-head-stub. tsconfig.engine.json + tsc-typegate i CI; `run-tests.js` samler engine-`.test.ts` op.
- Mål (spec-addendum 8c): head-to-head 23-24/8 → ejer-gate man aften → v4 evt. LIVE tir 25/8 (v3-fallback ved rødt).
- Specs: mor-spec `2026-08-20-race-engine-v4-intra-stage-design.md` (§4 M5-M14) · F2-design `2026-08-21-race-engine-v4-f2-core-design.md` · taktik `2026-08-21-race-tactics-orders-v1-design.md` (T1-T4 + TeamOrder-kontrakten).

## Fælles worker-regler (ind i hver spawn-prompt)

Branch fra origin/main som FØRSTE skridt · kør `date` først · commit pr. delfix, push hvert 30. min · commits uden æøå · gh-retry-wrapper på alle gh-kald · INGEN under-agenter, arbejd sekventielt · engine-workers: rør KUN egne nye filer + ADDITIVE tuning-felter (aldrig types.ts/index.ts/segmentLoop.ts/groups.ts/physiology.ts/rng.ts — orkestrator wirer) · renhed: ingen IO/Date/Math.random i lib/engine/v4 (adapters undtaget) · eksplicitte .ts-extensions · verifikation engine-workers: tsc-p tsconfig.engine.json + node --test på egne filer (IKKE fuld suite; kun sidste worker pr. chunk kører run-tests.js) · PR-body: template m. Brugerverifikation ELLER backend-only-label · patch notes røres IKKE af workers.

## Chunk 1 — motor-mekanikker (6 workers, backend-only)

| # | Spor | Scope-kerne |
|---|---|---|
| 1 | M5 udbrud v2 | `mechanics/breakaway.ts`: jagt-interesse-modellen (#2416: sprinterholds interesse, GC-trussel, udbruds-motorstyrke, rest-km) + forbrug af TeamOrder.breakaway_stance ("chase"/"neutral"/"let_go", bounded) + try_break-flag (øger sandsynlighed, garanterer aldrig). Events: breakaway_formed/caught/survived. |
| 2 | M6+M9 | `mechanics/leadout.ts` (sprint-tog: leadout-roller flytter position i finale-opgøret) + `mechanics/bonusSeconds.ts` (10/6/4 mål + 3/2/1 indlagt, bounded ~10 s/etape GC-effekt, #2413). Tuning.bonusSeconds findes allerede. |
| 3 | M7+M12 | Distance-slid (monument-effekt 250 km+ dræner finale + dag-til-dag via Entrant.condition) + effort-forbrug (protect/normal/save modulerer work-cost/W'-forbrug i fysiologi-tick; kontrakt: effortFatigueMultiplier-mønstret fra raceRoles.js genimplementeres rent). |
| 4 | M8+M11 | Brosten-sektorer med reel vægt (sector-stars × cobblestone-evne, 15-20 % på udvalgte punch-etaper) + vejr-lag (regn forstærker T2-T3/brosten-risiko + descent attack-risiko; RouteV2.weather findes fra F1). Ny stat vejr-teknik: KUN hook-punkt/tuning-felt, ingen DB (stats fødes skjulte, F4+). |
| 5 | M10 | Incidents med km-mærke + 3 km-reglen (styrt sidste 3 km på flade etaper = gruppens tid, kun placering ryger; ingen regel på bjerg). Bygger oven på M3's incident-emission (descent.ts tæller kun op i dag). |
| 6 | Sub-tick-fysiologi | Fixture-fund 21/8: tickPhysiology dækker helt segment i ét tick → W'-tæring nær-binær. Del segmentet i sub-ticks (fx pr. km eller maks-dt) så tæring/genopladning bliver gradvis. RØR physiology.ts+segmentLoop.ts (undtagelse fra reglen — kør ALENE, merges FØRST i chunk 1, de andre rebaser). Golden fixtures SKAL regenereres (generateEngineV4Fixtures.mjs) og hensigterne re-verificeres. |

**Merge-rækkefølge chunk 1:** worker 6 først (rører kernen; fixtures regenereret), derefter 1-5 (kun nye filer, konfliktfri). Orkestrator wirer nye hooks ind i index.ts/segmentLoop-hook-interfaces til sidst (Fase-C-mønstret fra F2: rebaseline-invarianten består).

## Chunk 2 — taktik + gate-værktøj (5 workers)

| # | Spor | Scope-kerne |
|---|---|---|
| 7 | M13 TTT | Hold-som-gruppe på gruppemodellen: holdets tid = N'te rytter, work-rotation, ITT/TTT-finale_type (#2412/#3463). |
| 8 | M14 AI-taktik | Adaptiv, forklarlig AI-holdtaktik der genererer TeamOrder gennem PRÆCIS samme type som spillere (ingen side-kanaler). Harness-linse: mere troværdig, ikke stærkere. |
| 9 | Orders-API | Backend: `race_team_orders`-tabel (migration, IKKE applied — post-merge #2642), CRUD-endpoint pr. (team, race, stage), lås ved etapestart (T2), neutral-default (T4), adapter → StageInput.orders. SQL reviewes FØR merge. |
| 10 | Taktik-kort UI | Variant B (ejer-godkendt mockup i dag-sessionen, se taktik-spec §UI-anatomi): T2-kort under lineup, hold-stance + effort-segmented + "Try the break"-pill (guld-outline), lock-meta. EN/DA i18n. **DRAFT-PR — merges ALDRIG uden ejer-visuel-godkendelse.** Screenshots desktop+mobil. |
| 11 | Head-to-head scorecard | Udbyg `scripts/headToHeadV4.js`: scoring mod ALLE §5-ankre i mor-spec (felt-sammenhæng 80-95 %, nedkørsels-ratio ≤0,5, punch-korrelation, dominans 25-40 %, gap-realisme-bånd #2415, udbruds-rater, samme-hold-top-10 <3 %, type-integritet, bonus-bounded) + `--films`-flag der eksporterer 4-5 håndplukkede etape-tidslinjer som læsbare filer til ejer-gennemsyn. Population via `exportPopulationSnapshot.js` (read-only). |

## Merge-policy (morgen, ejer-bulk-go)

Engine-lib-PR'er (backend-only) auto-merge ved grøn CI efter bulk-go · UI-PR (spor 10) forbliver draft · migrations-PR (spor 9) SIDST med SQL-review · done-flip pr. merged issue i løkken · maks 5 åbne PR'er ad gangen — merge løbende · én fuld e2e ad gangen pr. maskine.

## Anti-hang (obligatorisk)

`preflight-night-wave.ps1 -Fix` skal printe [GO] · `keep-awake.ps1` i eget vindue hele natten · 2 Workflow-chunks (ikke ét stort barrier) · per-agent-timeout i workflow-script · `night-wave-stall-watch.ps1` periodisk · launch-bevis på skærmen før ejer går i seng.

## Efter bølgen (morgen-sessionen)

Integration (hook-wiring + fixtures-verify) → merges → head-to-head-kørsel på fuld S3-kalender → scorecard + film til ejer-gaten mandag aften. Bølge-artifact: `docs/audits/night-wave-2026-08-22.md`.
