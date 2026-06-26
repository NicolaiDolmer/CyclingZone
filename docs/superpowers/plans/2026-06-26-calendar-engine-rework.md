# Kalender-motor-rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lav en virkelighedstro løbskalender — realistisk blanding af grand tours, etapeløb og endagsklassikere; kapacitets-bevidst overlap (løb overlapper kun hvis holdene kan bemande dem); 5 etaper/dag; 140 etape-dage per division — og ret de bugs der gør, at løb bliver korrupte (#1856 in-flight-overlap + per-division race_days).

**Architecture:** To-fase rollout. **Fase 1** bygger den nye motor og anvender den KUN på AI-divisionerne 1–3 (0 ægte spillere → 0 risiko) som live-test. En hård verifikations-gate (simulering + fejlfri automatik) skal passeres, før **Fase 2** ruller 5/dag + 140-dages + per-division race_days ud til Div 4–7 (39 ægte spillere) med board/økonomi/sponsor-rekalibrering. **Fase 3** (sideløbende) giver UI-indsyn i alle divisioners kalendre (#1835), så fejl som "Div 1 ren etapeløb" fanges af ejeren næste gang.

**Tech Stack:** Node.js + Express backend, Supabase (Postgres), `node --test` unit tests. Determinisme er kritisk (seed-baseret, ingen `Date.now()`/random i rene funktioner) så dry-run == apply.

---

## Baggrund (verificeret mod prod 2026-06-26)

| Fakta | Værdi |
|-------|-------|
| Sæson | #1, active, dag 26/60 (men se race_days-bug) |
| Ægte spillere Div 1–3 | **0** (rene AI-divisioner) |
| Ægte spillere Div 4–7 | 10/10/10/9 = 39 |
| Div 1 sammensætning | 7 etapeløb + 1 endagsløb (completed) → **0 kommende endagsløb** = elendig |
| Div 2–7 sammensætning | sund blanding (7 etape + 8–12 endags hver) |
| Peak samtidige etapeløb | Div 1 = **3** (bug); Div 2–7 = 2 (designets loft) |
| race_days_completed | 26 = **sum på tværs af alle 7 divisioner** (bug; bør være per-division ~4–6) |

**Centrale kilde-filer:**
- `backend/lib/divisionCalendarGenerator.js` — to-fase generator (etapeløb-quota → fyld). `DEFAULT_TIER_RACE_CLASSES:34-39`.
- `backend/lib/seasonRaceSelection.js:22-25` — `DEFAULT_RACE_DAYS_TARGET=60`, `FIRST_SEASON_STAGE_RACE_QUOTA=8`.
- `backend/scripts/backfillRaceScheduledFor.js` — `STAGE_SLOTS_CET` (4 slots), `STAGES_PER_DAY=2`, `planRaceSchedules`.
- `backend/lib/seasonCalendarMaterializer.js` — orkestrerer generér→insert→profiler→schedule. Idempotent på `${league_division_id}:${pool_race_id}`.
- `backend/lib/raceBinding.js` — `raceBindingWindow`, `windowsOverlap` (status-agnostiske).
- `backend/lib/raceEntryGenerator.js:268-281` — `assignTeamAcrossRaces` (kapacitets-fordeling; in-flight delvist via `lockedWindows`).
- `backend/lib/seasonRaceDays.js` — `sumCompletedRaceDays` (global sum-bug).
- `backend/lib/betaResetService.js:359-384` — global reset (mønster for division-reset).

---

# FASE 1 — Ny motor + AI-divisioner 1–3 (eksekveres nu, 0 risiko)

## Task 1: In-flight-aware concurrency-funktion (#1856 kerne)

Ren funktion der afgør hvor mange etapeløb der er aktive samtidig pr. division, inkl. igangværende løb — fundamentet for både planlægning og en regressions-test.

**Files:**
- Modify: `backend/lib/raceBinding.js` (tilføj `peakConcurrentStageRaces` + `racesExceedingConcurrency`)
- Test: `backend/lib/raceBinding.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```javascript
import { peakConcurrentStageRaces } from "./raceBinding.js";

test("peakConcurrentStageRaces tæller in-flight + scheduled etapeløb pr. division", () => {
  // 3 etapeløb med overlappende dag-vinduer i samme division → peak 3
  const races = [
    { id: "a", league_division_id: 1, race_type: "stage_race", windowDays: { start: 0, end: 6 } },
    { id: "b", league_division_id: 1, race_type: "stage_race", windowDays: { start: 2, end: 6 } },
    { id: "c", league_division_id: 1, race_type: "stage_race", windowDays: { start: 2, end: 8 } },
    { id: "d", league_division_id: 1, race_type: "single",     windowDays: { start: 3, end: 3 } }, // endagsløb tæller ikke
  ];
  assert.equal(peakConcurrentStageRaces(races, { divisionId: 1 }), 3);
});
```

- [ ] **Step 2: Kør testen — forvent FAIL** (`node --test backend/lib/raceBinding.test.js`) med "peakConcurrentStageRaces is not a function".

- [ ] **Step 3: Implementér** — sweep-linje over dag-vinduer (genbrug `windowsOverlap`-tankegangen), tæl kun `race_type === "stage_race"`, filtrér på `divisionId`. Returnér max samtidige. Tilføj `racesExceedingConcurrency(races, { limitByDivision })` der returnerer de løb der bringer en division over dens loft.

- [ ] **Step 4: Kør testen — forvent PASS.**

- [ ] **Step 5: Commit** (`feat(race): peakConcurrentStageRaces — in-flight-aware concurrency (#1856)`).

## Task 2: 5/dag-infrastruktur (5. slot + un-clamp)

**Files:**
- Modify: `backend/scripts/backfillRaceScheduledFor.js` (`STAGE_SLOTS_CET`, fjern clamp i `planRaceSchedules`)
- Test: `backend/scripts/backfillRaceScheduledFor.test.js`

- [ ] **Step 1: Skriv fejlende test** — `planRaceSchedules({ races, tracks: 5 })` giver 5 distinkte slot-tider (ingen duplikat/wraparound); og en assertion `STAGE_SLOTS_CET.length === 5`.
- [ ] **Step 2: Kør — forvent FAIL** (kun 4 slots; clamp giver wraparound til 12:30).
- [ ] **Step 3: Implementér** — tilføj 5. slot. **`STAGE_SLOTS_CET = ["09:00","12:30","15:00","18:00","21:00"]`** (morgen-først bevarer eksisterende mid-dag-slots' rækkefølge-semantik dårligt → vurdér; default-anbefaling 09:00 forrest). Erstat `Math.min(tracks, slots.length)`-clamp med en hård guard: `if (tracks > slots.length) throw new Error("flere tracks end slots")`.
- [ ] **Step 4: Kør — forvent PASS.**
- [ ] **Step 5: Commit** (`feat(race): 5. etape-slot + un-clamp planRaceSchedules`).

> **NB:** `STAGES_PER_DAY` hæves IKKE til 5 globalt her (det ville ramme Div 4–7's materialisering). Fase 1 sender `tracks: 5` eksplicit kun i division-reset-scriptet for Div 1–3. Global `STAGES_PER_DAY` flyttes til 5 i Fase 2.

## Task 3: Generator — realistisk blanding (single-race-quota)

Roden til "Div 1 ren etapeløb": Tier 1's 8 store etapeløb fylder hele 140/60-target. Indfør en eksplicit endagsløb-/monument-quota pr. tier, så Fase B garanterer klassikere.

**Files:**
- Modify: `backend/lib/seasonRaceSelection.js` (nye quota-konstanter), `backend/lib/divisionCalendarGenerator.js` (separate stage/single-køer med egne quotaer)
- Test: `backend/lib/divisionCalendarGenerator.test.js`

- [ ] **Step 1: Skriv fejlende test** — med prod-lignende katalog + `raceDaysTarget: 140`: Tier 1 får **mindst 25–40% endagsløb** (ikke 0) OG mindst 2 Monuments OG ingen løb gentages på tværs af puljer.
- [ ] **Step 2: Kør — forvent FAIL** (nuværende output: Tier 1 ~0 endagsløb ved fyldt etape-quota).
- [ ] **Step 3: Implementér** — `SINGLE_RACE_MIN_SHARE` + `MONUMENT_MIN` pr. tier; modificér to-fase-algoritmen så endagsløb-køen har sin egen garanterede quota i Fase A (ikke kun "rest" i Fase B). Hæv `DEFAULT_RACE_DAYS_TARGET` → 140 og `FIRST_SEASON_STAGE_RACE_QUOTA` til et tal der efterlader plads til klassikere (kalibreres i Task 5).
- [ ] **Step 4: Kør — forvent PASS.**
- [ ] **Step 5: Commit** (`feat(race): tier-quota for endagsløb + monuments — realistisk blanding`).

## Task 4: Division-reset-script (dry-run default)

**Files:**
- Create: `backend/scripts/dev/reset-division-calendar.mjs`
- Test: `backend/scripts/dev/reset-division-calendar.test.js` (ren del: slette-rækkefølge/guard)

- [ ] **Step 1: Skriv fejlende test** — en ren `planDivisionReset({ races, teams })`-funktion der (a) NÆGTER hvis divisionen har ægte spillere (guard), (b) returnerer korrekt slette-rækkefølge.
- [ ] **Step 2: Kør — forvent FAIL.**
- [ ] **Step 3: Implementér** scriptet: input `--seasonId --divisionId [--live] [--tracks 5] [--race-days 140]`. **Guard:** afbryd hvis `teams` i divisionen har `is_ai=false AND is_bank=false AND is_frozen=false` (ægte spiller) medmindre `--force`. Slette-rækkefølge (verificeret mod FK'er): `UPDATE finance_transactions SET race_id=NULL WHERE race_id IN (...)` → `DELETE races WHERE season_id AND league_division_id` (cascade rydder entries/profiles/schedule/sim_runs/pending/results) → `DELETE season_standings WHERE season_id AND league_division_id` → re-kald `materializeSeasonCalendar({ seasonId, dryRun, onlyDivisionId, raceDaysTarget, tracks })`. Dry-run logger counts pr. tabel uden writes.
- [ ] **Step 4: Kør — forvent PASS.**
- [ ] **Step 5: Commit** (`feat(ops): reset-division-calendar script (dry-run default, ægte-spiller-guard)`).

> `materializeSeasonCalendar` skal udvides med `onlyDivisionId` + `raceDaysTarget`/`tracks`-pass-through. Lille edit, men nødvendig.

## Task 5: Simulér-før-ship — kapacitets-scorecard (HÅRD GATE)

Verificér mod ægte rytter-population at den nye kalender er bemandbar FØR prod. Kalibrér quota/tracks her.

**Files:**
- Create/extend: `backend/scripts/dev/simulate-overlap-fill.mjs` (genbrug `assignTeamAcrossRaces`, `selectionSizeForRace`, in-flight-aware fra Task 1)

- [ ] **Step 1:** Kør harness mod prod (read-only) for en regenereret Div 1–3-kalender (in-memory) med kandidat-parametre.
- [ ] **Step 2:** Mål scorecard: fuldt-hold-fyldnings-grad, andel auto-no-shows, peak-concurrency pr. division (skal aldrig overstige bemandbart), felt-styrke p10/p50/p90, og at de fire virkelighedstro mønstre opstår (ingen overlap / 2 endags / etape+endags / aldrig 2 grand tours).
- [ ] **Step 3:** Justér quota/tracks indtil scorecardet er virkelighedstro. **Gate:** ingen division med peak der gør felterne ufyldbare; fuldt-hold-grad acceptabel.
- [ ] **Step 4:** **Vis ejeren scorecardet + den foreslåede kalender (dry-run output) → ejer-go før Task 6.**

## Task 6: Anvend på Div 1–3 i prod (efter ejer-go)

- [ ] **Step 1:** `reset-division-calendar.mjs --seasonId 1 --divisionId 1 --tracks 5 --race-days 140` (dry-run) → verificér counts → vis ejer.
- [ ] **Step 2:** Gentag for div 2 + 3 (dry-run).
- [ ] **Step 3:** **Ejer-go** → kør `--live` for div 1, 2, 3. (Div 1–3 er AI-only → ingen ægte spiller berøres; La Corsa/Alpes/Émirats forsvinder med reset, hvilket gør #1844/#1845/#1848-oprydning overflødig for disse divisioner.)
- [ ] **Step 4:** Verificér i prod: peak-concurrency pr. division ≤ bemandbart; 0 ghost-entries; realistisk blanding (endagsløb findes); stage_scheduler afvikler uden fejl.
- [ ] **Step 5:** Patch notes + NOW.md + commit.

---

## Simulerings-fund + beslutninger (26/6, efter Task 5 dry-run mod prod)

Read-only preview (`preview-calendar-rework.mjs`) mod prod-kataloget afslørede to ting FØR prod blev rørt:

1. **Div 1 reddet:** med single-kvoten får Div 1 nu 13 endagsløb + 5 monumenter (op fra 0). #1856-fixet virker. ✅
2. **Kataloget for lille:** 376 race-dage i `race_pool` vs 7×140 = 980 behov (38%). Med global de-dup (#1714) sulter parallelle puljer på samme tier hinanden → ingen division nåede 140 (Div 1 = 117, svageste = 30). 🔴
3. **Peak = 5 samtidige etapeløb:** `tracks=5` lagde blindt 5 parallelle løb → ikke bemandbart, ikke virkelighedstro. 🔴

**Ejer-beslutninger (26/6):**
- **Concurrency:** fast **max 2 samtidige etapeløb** pr. division; endagsløb fylder de øvrige daglige slots op til 5 etaper/dag. → Task 7.
- **Katalog:** **genbrug på tværs af puljer** — parallelle puljer på samme niveau må køre samme løb (egen instans hver; usynligt for spillere). → Task 6.

### Task 6: Generator — `allowReuseAcrossPools`
`generateDivisionCalendars`: ny param (default false = #1714-adfærd bevaret). True → drop de-dup MELLEM puljer (per-pulje `selectedIds` beholdes), så hver pulje kan nå 140 fra sit tier-katalog. TDD: kontrast true vs false.

### Task 7: Planlægger — `stageRaceTracks` (kapacitets-bevidst)
`planRaceSchedules`: ny param `stageRaceTracks` (default null = nuværende blandede adfærd). Sat (=2) → etapeløb kun på de første 2 spor, endagsløb på de resterende 3 → garanteret peak ≤ 2 etapeløb, op til 5 etaper/dag. TDD: assertér `peakConcurrentStageRaces ≤ 2`.

### Task 8: Integrér + re-simulér
Materializer/reset sender `allowReuseAcrossPools:true` + `stageRaceTracks:2`. Re-kør preview → bekræft peak ≤ 2 + alle divisioner ~140 → vis ejeren → prod.

# GATE → Fase 2

Fase 2 starter KUN når: (a) Div 1–3 har kørt automatisk i ≥2 døgn uden scheduler-fejl, (b) felterne er bemandbare i praksis (verificeret), (c) ejeren har set og godkendt resultatet i UI (kræver Fase 3).

---

# FASE 2 — Udrul til Div 4–7 + per-division race_days (rammeplan)

> Detaljeres til fuld TDD efter Fase 1-gate + simulering. Højere risiko (39 ægte spillere midt i sæson).

1. **Per-division race_days (fixer 26/60-bug'en).** Denormalisér `race_days_completed`/`race_days_total` til `league_divisions`-tabellen (anbefalet option c). `seasonRaceDays.js`: `recomputeDivisionRaceDays({ divisionId })`. Migrér forbrugere til per-division: `boardMidSeason.js`, `boardWeekendFinalization.js` (salary-cap-checkpoints!), `boardRequests.js` (lock sidste 5 dage), `sponsorContractsService.js` (payout-normalisering), `economyEngine.js` (filter). Tests pr. forbruger (banner/lock fyrer per-division, ikke globalt).
2. **5/dag globalt.** `STAGES_PER_DAY` 2→5; `MAX_STAGES_PER_DAY` bliver 75; verificér daglig-cap-logik.
3. **Migration af Div 4–7's igangværende sæson.** Beslutning kræves: re-planlæg kun KOMMENDE løb (bevar afviklede + standings + præmie) vs. fuld sæson-restart. Default-anbefaling: re-planlæg kommende + tilføj realistisk blanding, bevar historik.
4. **board/økonomi-konsekvens-audit** for de 39 spillere (deadlines/sponsor må ikke skride).

---

# FASE 3 — UI-indsyn i alle divisioners kalendre (#1835, sideløbende)

- Read-only visning så ejeren (og spillere) kan se enhver divisions kalender. Direkte modgift mod "Div 1 ren etapeløb sneg sig forbi, fordi den ikke kunne ses." Mindste version: admin-side der lister hver divisions løb (type/klasse/dato) + peak-concurrency-indikator.

---

## Risici & rollback

- **Prod-data-mutation (Div 1–3 reset):** AI-only → ingen ægte spiller. Idempotent re-materialisering. Verificeret backup + PITR. Dry-run-først + ejer-go på `--live`.
- **5/dag rører board/økonomi (Fase 2):** isoleret til Fase 2, bag gate, kun efter per-division race_days-fix.
- **Slot-mismatch:** Task 2's hårde guard forhindrer stille wraparound.
- **Loop-guard:** 2 scheduler-fejl på samme symptom → STOP + spørg ejer.
- **PR med database/SQL (per-division race_days migration i Fase 2):** ejer merger (auto-applies i prod).

## Self-review-noter
- Spec-dækning: realistisk blanding (Task 3) ✓, kapacitets-overlap (Task 1+5) ✓, 5/dag (Task 2) ✓, 140/division (Task 3) ✓, race_days-fix (Fase 2 pkt 1) ✓, Div 1–3 nu (Task 6) ✓, UI-indsyn (Fase 3) ✓.
- Konsistens: `peakConcurrentStageRaces` (Task 1) bruges i Task 5 + Fase 1-verifikation. `materializeSeasonCalendar`-signatur udvides i Task 4, bruges i Task 6.
