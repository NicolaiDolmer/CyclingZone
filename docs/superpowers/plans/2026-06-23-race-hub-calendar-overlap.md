# Race Hub — kalender-overlap via parallelle spor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indfør ægte tids-overlap i sæson-kalenderen ved at planlægge hver puljes løb i to parallelle "spor", så bindingen fra Fase 0a aktiveres — og lever et empirisk fyldnings-scorecard der bliver baseline for bund-rytter-fasen.

**Architecture:** Erstat den sekventielle etape-pakning i `planRaceSchedules` med N parallelle spor (default 2): hvert spor planlægger sine løb sekventielt, 1 etape/dag, på sit eget faste dag-slot (spor 0 → 12:30, spor 1 → 15:00). Løb fordeles greedy-balanceret på etape-sum. To løb i forskellige spor på samme dag overlapper i tid; stage races' lange vinduer binder ryttere hen over nabosporets korte løb. Total throughput (2 etaper/dag/pulje) og sæson-længde er uændret. Materializeren får overlap automatisk (kalder allerede `planRaceSchedules` uden params). Et separat, dry-run-først script re-scheduler den live sæson 1 og rydder binding-konflikter i eksisterende manuelle udtagelser.

**Tech Stack:** Node.js (ESM), `node:test` + `node:assert/strict`, Supabase service-role (kun i scripts), eksisterende rene moduler `raceBinding.js` / `raceEntryGenerator.js` / `raceAutopick.js`.

**SSOT:** [`docs/superpowers/specs/2026-06-23-race-hub-calendar-overlap-design.md`](../specs/2026-06-23-race-hub-calendar-overlap-design.md)

**Branch:** `feat/race-hub-0c-base-riders` (isoleret worktree).

---

## Vigtig kontekst for engineering-worker (læs før Task 1)

- `planRaceSchedules` er en **ren funktion** (ingen DB) i `backend/scripts/backfillRaceScheduledFor.js`. Den eksporteres og kaldes af `seasonCalendarMaterializer.js:178` og `runBackfill` (samme fil) — begge **uden** `tracks`/`stagesPerDay`, så de arver den nye default.
- Hjælpefunktionerne `copenhagenWallClockToUTC(dateStr, "HH:MM")` og `copenhagenDatePlusDays(fromUTC, days)` findes allerede i filen (DST-robuste). Brug dem uændret.
- `STAGE_SLOTS_CET = ["12:30","15:00","18:00","21:00"]` og `STAGES_PER_DAY = 2` er eksporterede konstanter i filen.
- Binding-primitiver i `backend/lib/raceBinding.js`: `raceTimeWindow(scheduleRows)` → `{start,end}` (epoch-ms) og `windowsOverlap(a,b)` (inklusiv). Brug dem i tests og i konflikt-detektoren.
- Kør tests fra `backend/`-mappen: `node --test <fil>`.
- Commit-disciplin: `git commit -F <fil>` (aldrig heredoc). Verificér branch i commit-kæden: `test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"`.
- Alle prod-scripts køres `infisical run --env=prod -- node <script>` (runtime-injection; dump aldrig secret-values).

---

## Task 1: `planRaceSchedules` — parallelle spor

**Files:**
- Modify: `backend/scripts/backfillRaceScheduledFor.js` (funktionen `planRaceSchedules`, linje 75-104; dokblok 66-74)
- Modify: `backend/scripts/backfillRaceScheduledFor.test.js`

- [ ] **Step 1: Opdatér den ene dato-afhængige test + tilføj spor-tests (failing mod nuværende impl)**

I `backfillRaceScheduledFor.test.js`, **erstat** testen `"planRaceSchedules: et løbs etaper er konsekutive (sammenhængende blok)"` (linje 50-57) med den nye spor-adfærd, og **tilføj** de nye tests umiddelbart efter. Importér `raceTimeWindow`/`windowsOverlap` øverst.

Tilføj til importerne øverst i filen:

```javascript
import { raceTimeWindow, windowsOverlap } from "../lib/raceBinding.js";
```

Erstat den konsekutive-test:

```javascript
test("planRaceSchedules: et løbs etaper er konsekutive, 1 etape/dag i sit spor", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  const alfa = stageRows.filter((r) => r.race_id === "rA").sort((a, b) => a.stage_number - b.stage_number);
  assert.deepEqual(alfa.map((r) => r.stage_number), [1, 2, 3]);
  // Spor-model: Alfa (3 etaper) ligger i ÉT spor → 1 etape/dag over 3 på hinanden følgende dage.
  const alfaDays = alfa.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10));
  assert.deepEqual(alfaDays, ["2026-06-21", "2026-06-22", "2026-06-23"]);
});

test("planRaceSchedules: to løb i forskellige spor kører samme dag, forskellige slots", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  // Dag 21/6: Alfa etape 1 (spor 0 → 12:30) + Beta etape 1 (spor 1 → 15:00).
  const day1 = stageRows.filter((r) => new Date(r.scheduled_at).toISOString().slice(0, 10) === "2026-06-21");
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
  const slots = day1.map((r) => hhmm(r.scheduled_at)).sort();
  assert.deepEqual(slots, ["12:30", "15:00"], "to forskellige slots samme dag");
  const races = new Set(day1.map((r) => r.race_id));
  assert.equal(races.size, 2, "to FORSKELLIGE løb samme dag (overlap)");
});

test("planRaceSchedules: stage race binder hen over et nabospor-løb (ægte overlap)", () => {
  // Et langt stage race (spor 0) + flere korte løb (spor 1) → vinduerne overlapper.
  const races = [
    { id: "tour", name: "AAA Grand Tour", stages: 7 },
    { id: "k1", name: "BBB Klassiker 1", stages: 1 },
    { id: "k2", name: "CCC Klassiker 2", stages: 1 },
    { id: "k3", name: "DDD Klassiker 3", stages: 1 },
  ];
  const { stageRows } = planRaceSchedules({ races, from: FROM });
  const winFor = (raceId) => raceTimeWindow(stageRows.filter((r) => r.race_id === raceId));
  const tourWin = winFor("tour");
  // Mindst ét kort løb skal have sit vindue inde i grand tour'ets span → binding aktiv.
  const overlaps = ["k1", "k2", "k3"].filter((id) => windowsOverlap(tourWin, winFor(id)));
  assert.ok(overlaps.length >= 1, `grand tour skal overlappe mindst ét nabospor-løb (fik ${overlaps.length})`);
});

test("planRaceSchedules: spor balanceres — spor-længderne afviger højst ét løbs etaper", () => {
  // 10 single-løb + 1 stage race → greedy skal holde sporene nogenlunde lige lange.
  const races = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Race ${String(i).padStart(2, "0")}`, stages: 1 })),
    { id: "sr", name: "ZZZ Stage Race", stages: 5 },
  ];
  const { stageRows } = planRaceSchedules({ races, from: FROM });
  // Sidste etape-dag pr. spor (slot) → spor-længder.
  const lastDayBySlot = {};
  for (const r of stageRows) {
    const t = new Date(r.scheduled_at);
    const slot = t.toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
    const day = t.toISOString().slice(0, 10);
    if (!lastDayBySlot[slot] || day > lastDayBySlot[slot]) lastDayBySlot[slot] = day;
  }
  const days = Object.values(lastDayBySlot).map((d) => Date.parse(d));
  const spreadDays = (Math.max(...days) - Math.min(...days)) / 86400000;
  assert.ok(spreadDays <= 5, `spor-længde-spredning ${spreadDays} dage skal være ≤ største løbs etape-antal (5)`);
});
```

- [ ] **Step 2: Kør tests → verificér de nye fejler**

Run: `cd backend && node --test scripts/backfillRaceScheduledFor.test.js`
Expected: De 4 nye/ændrede tests FEJLER (nuværende impl pakker 2 etaper/dag i én stream → Alfa på [21,21,22], kun ét løb pr. dag-slot-par, intet overlap). De øvrige eksisterende tests består stadig.

- [ ] **Step 3: Implementér spor-modellen**

Erstat dokblokken (linje 66-74) + funktionen `planRaceSchedules` (linje 75-104) i `backfillRaceScheduledFor.js` med:

```javascript
/**
 * REN planlægning (ingen DB). Fordeler løbene på `tracks` parallelle spor og planlægger
 * hvert spor sekventielt, 1 etape/dag, på sit eget faste dag-slot (spor t → slots[t]).
 * To løb i forskellige spor på samme dag overlapper i tid → bindingen (Fase 0a) aktiveres.
 * Løb fordeles greedy-balanceret på kumulativ etape-sum, så sporene afsluttes omtrent
 * samtidig. Total throughput = tracks etaper/dag/pulje (uændret: tracks default = STAGES_PER_DAY).
 *
 * Deterministisk: løb sorteres på name→id; greedy-tie brydes mod laveste spor-index.
 * `tracks=1` giver én sekventiel stream (1 etape/dag). `raceUpdates` returneres altid i
 * name-sorteret løbsrækkefølge uanset spor-tildeling.
 *
 * @param {{ races: Array<{id,name,stages}>, from?: Date, slots?: string[], tracks?: number }} args
 * @returns {{ raceUpdates: Array<{id, scheduled_for}>, stageRows: Array<{race_id, stage_number, scheduled_at}> }}
 */
export function planRaceSchedules({ races = [], from = new Date(), slots = STAGE_SLOTS_CET, tracks = STAGES_PER_DAY }) {
  const sorted = [...races].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "en") || String(a.id).localeCompare(String(b.id)),
  );
  const trackCount = Math.max(1, Math.min(Number(tracks) || 1, slots.length));
  const trackDays = new Array(trackCount).fill(0); // næste ledige dag-index (0-baseret) pr. spor

  const raceUpdates = [];
  const stageRows = [];
  for (const race of sorted) {
    const stageCount = Math.max(1, Number(race.stages) || 1);
    // Vælg sporet med færrest kumulative dage (tie → laveste index → determinisme).
    let t = 0;
    for (let i = 1; i < trackCount; i++) if (trackDays[i] < trackDays[t]) t = i;
    const startDayIdx = trackDays[t];
    const slot = slots[t % slots.length];

    raceUpdates.push({
      id: race.id,
      scheduled_for: copenhagenWallClockToUTC(copenhagenDatePlusDays(from, startDayIdx + 1), slot).toISOString(),
    });
    for (let s = 0; s < stageCount; s++) {
      const dayIdx = startDayIdx + s;
      stageRows.push({
        race_id: race.id,
        stage_number: s + 1,
        scheduled_at: copenhagenWallClockToUTC(copenhagenDatePlusDays(from, dayIdx + 1), slot).toISOString(),
      });
    }
    trackDays[t] += stageCount;
  }
  return { raceUpdates, stageRows };
}
```

- [ ] **Step 4: Kør hele test-filen → alt grønt**

Run: `cd backend && node --test scripts/backfillRaceScheduledFor.test.js`
Expected: Alle tests PASS (inkl. de uændrede "2 etaper/dag", "scheduled_for sorteret på name", "sæson-længde 15 dage", determinisme — gennemregnet: spor-modellen bevarer dem).

- [ ] **Step 5: Commit**

```bash
cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"
git add backend/scripts/backfillRaceScheduledFor.js backend/scripts/backfillRaceScheduledFor.test.js
git commit -F <commit-msg-fil>
```
Commit-besked: `feat(race-hub): kalender-overlap via parallelle spor i planRaceSchedules`

---

## Task 2: Materializer producerer overlap (regressions-bevis)

**Files:**
- Modify: `backend/lib/seasonCalendarMaterializer.js` (kommentar linje 175-177)
- Modify: `backend/lib/seasonCalendarMaterializer.test.js` (ny test)

Materializeren kalder allerede `planRaceSchedules({ races: insertedRaces, from })` uden `tracks` → den arver default 2 automatisk. Ingen logik-ændring; vi tilføjer en test der **beviser** at den materialiserede kalender har overlap, så en fremtidig regression fanges.

- [ ] **Step 1: Skriv den fejlende overlap-test**

Tilføj i `seasonCalendarMaterializer.test.js` (importér binding-primitiver øverst):

```javascript
import { raceTimeWindow, windowsOverlap } from "./raceBinding.js";
```

```javascript
test("materialiseret kalender har tids-overlap i en pulje (binding aktiveres)", async () => {
  const sb = makeSupabase(seed());
  await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false,
  });
  // Saml vinduer pr. løb i pulje 1 (div1, altid live).
  const pool1RaceIds = sb.state.races.filter((r) => r.league_division_id === 1).map((r) => r.id);
  const winByRace = new Map();
  for (const id of pool1RaceIds) {
    const sched = sb.state.race_stage_schedule.filter((s) => s.race_id === id);
    winByRace.set(id, raceTimeWindow(sched));
  }
  // Mindst ét par løb i puljen skal overlappe tidsmæssigt.
  let overlaps = 0;
  for (let i = 0; i < pool1RaceIds.length; i++)
    for (let j = i + 1; j < pool1RaceIds.length; j++)
      if (windowsOverlap(winByRace.get(pool1RaceIds[i]), winByRace.get(pool1RaceIds[j]))) overlaps++;
  assert.ok(overlaps > 0, `pulje 1 skal have mindst ét overlappende løb-par (fik ${overlaps})`);
});
```

- [ ] **Step 2: Kør → verificér den nye test består (default tracks=2) og de øvrige stadig grønne**

Run: `cd backend && node --test lib/seasonCalendarMaterializer.test.js`
Expected: Alle PASS. (Hvis overlap-testen mod forventning fejler, er Task 1's default ikke 2 — fix Task 1 før du går videre.)

- [ ] **Step 3: Opdatér den nu-upræcise kommentar**

I `seasonCalendarMaterializer.js`, erstat kommentaren ved linje 175-177:

```javascript
    // 5b. Schedule (scheduled_for + race_stage_schedule). planRaceSchedules fordeler
    // puljens løb på 2 parallelle spor (default) → tids-overlappende løb, så bindingen
    // (Fase 0a) er aktiv. Throughput uændret (2 etaper/dag/pulje); MAX_STAGES_PER_DAY rører vi ikke.
```

- [ ] **Step 4: Commit**

```bash
cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"
git add backend/lib/seasonCalendarMaterializer.js backend/lib/seasonCalendarMaterializer.test.js
git commit -F <commit-msg-fil>
```
Commit-besked: `test(race-hub): bevis at materialiseret kalender har overlap`

---

## Task 3: Binding-konflikt-detektor (ren funktion)

Re-scheduling kan sætte en manager-udtaget rytter i to nu-overlappende løb (udtagelsen var lovlig under den sekventielle kalender). Ren funktion der finder konflikterne; bruges af reschedule-scriptet (Task 4).

**Files:**
- Modify: `backend/lib/raceBinding.js` (ny eksporteret funktion)
- Modify: `backend/lib/raceBinding.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj i `backend/lib/raceBinding.test.js` (filen importerer allerede fra `./raceBinding.js` — tilføj `findManualOverlapConflicts` til importen):

```javascript
test("findManualOverlapConflicts: ingen konflikt når vinduer ikke overlapper", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 200 }],
    ["B", { start: 300, end: 400 }],
  ]);
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("findManualOverlapConflicts: samme rytter i to overlappende løb → drop det senere", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 300 }],
    ["B", { start: 200, end: 400 }], // overlapper A
  ]);
  const conflicts = findManualOverlapConflicts({ entries, windowByRace });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], { rider_id: "r1", keepRaceId: "A", dropRaceId: "B" });
});

test("findManualOverlapConflicts: forskellige ryttere giver ingen konflikt", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r2" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 300 }],
    ["B", { start: 200, end: 400 }],
  ]);
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("findManualOverlapConflicts: løb uden vindue ignoreres", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([["A", { start: 100, end: 300 }]]); // B mangler vindue
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});
```

- [ ] **Step 2: Kør → verificér fejl**

Run: `cd backend && node --test lib/raceBinding.test.js`
Expected: FAIL — `findManualOverlapConflicts is not a function`.

- [ ] **Step 3: Implementér funktionen**

Tilføj i `backend/lib/raceBinding.js` (efter `findRiderBindingConflicts`):

```javascript
// Efter en reschedule der introducerer overlap: find ryttere udtaget (manuelt) til to
// tidsoverlappende løb. Pure + deterministisk. Returnerer ét par pr. konflikt med det
// kronologisk TIDLIGSTE løb som "keep" og det senere som "drop" (resolve = fjern
// rytteren fra drop-løbet, så holdet ikke dobbeltbookes; det bliver blot underbemandet dér).
//
// @param {{ entries: Array<{race_id, rider_id}>, windowByRace: Map<race_id,{start,end}> }} args
// @returns {Array<{ rider_id, keepRaceId, dropRaceId }>}
export function findManualOverlapConflicts({ entries = [], windowByRace }) {
  const byRider = new Map();
  for (const e of entries) {
    const w = windowByRace.get(e.race_id);
    if (!w) continue; // løb uden vindue kan ikke binde
    if (!byRider.has(e.rider_id)) byRider.set(e.rider_id, []);
    byRider.get(e.rider_id).push({ race_id: e.race_id, window: w });
  }
  const conflicts = [];
  for (const [rider_id, races] of byRider) {
    races.sort((a, b) => a.window.start - b.window.start || String(a.race_id).localeCompare(String(b.race_id)));
    for (let i = 0; i < races.length; i++) {
      for (let j = i + 1; j < races.length; j++) {
        if (windowsOverlap(races[i].window, races[j].window)) {
          conflicts.push({ rider_id, keepRaceId: races[i].race_id, dropRaceId: races[j].race_id });
        }
      }
    }
  }
  return conflicts;
}
```

- [ ] **Step 4: Kør → grønt**

Run: `cd backend && node --test lib/raceBinding.test.js`
Expected: Alle PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"
git add backend/lib/raceBinding.js backend/lib/raceBinding.test.js
git commit -F <commit-msg-fil>
```
Commit-besked: `feat(race-hub): findManualOverlapConflicts — detektér binding-konflikter ved reschedule`

---

## Task 4: Simulér-før-ship harness (read-only mod prod)

Mål fyldnings-scorecardet MED overlap vs. den faktiske sekventielle baseline. Genbruger de rene byggeklodser. Ingen writes.

**Files:**
- Create: `backend/scripts/dev/simulate-overlap-fill.mjs`

- [ ] **Step 1: Skriv scriptet**

```javascript
// Read-only simulér-før-ship: mål 0b-generatorens fyldnings-grad MED kalender-overlap
// (planRaceSchedules tracks=2) vs. den faktiske sekventielle prod-baseline. Genbruger de
// rene byggeklodser (assignTeamAcrossRaces, selectionSizeForRace). INGEN writes.
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/simulate-overlap-fill.mjs
import { createClient } from "@supabase/supabase-js";
import { assignTeamAcrossRaces } from "../../lib/raceEntryGenerator.js";
import { selectionSizeForRace } from "../../lib/raceAutopick.js";
import { raceTimeWindow } from "../../lib/raceBinding.js";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { planRaceSchedules } from "../backfillRaceScheduledFor.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function readAllIn(table, cols, inCol, ids, extra) {
  const out = []; const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    let q = sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}
const pctl = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number}\n`);

// Løb + eksisterende (sekventielle) vinduer.
const { data: races } = await sb.from("races").select("id, name, race_class, league_division_id, stages").eq("season_id", season.id);
const raceIds = races.map((r) => r.id);
const sched = await readAllIn("race_stage_schedule", "race_id, scheduled_at", "race_id", raceIds);
const schedByRace = new Map();
for (const s of sched) { if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []); schedByRace.get(s.race_id).push(s); }
const baselineWin = new Map(raceIds.map((id) => [id, raceTimeWindow(schedByRace.get(id))]));

// Profiler (autopick scorer på dem).
const profiles = await readAllIn("race_stage_profiles", "race_id, stage_number, profile_type, finale_type, demand_vector", "race_id", raceIds);
const stagesByRace = new Map();
for (const p of profiles) { if (!stagesByRace.has(p.race_id)) stagesByRace.set(p.race_id, []); stagesByRace.get(p.race_id).push(p); }
for (const arr of stagesByRace.values()) arr.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

// Hold + ryttere + abilities + fatigue (eligible: ikke-test, ikke-frosset).
const { data: allTeams } = await sb.from("teams").select("id, is_test_account, is_frozen, league_division_id").or("is_test_account.is.null,is_test_account.eq.false");
const teams = (allTeams || []).filter((t) => !t.is_frozen);
const teamIds = teams.map((t) => t.id);
const riders = await readAllIn("riders", "id, team_id", "team_id", teamIds, (q) => q.or("is_retired.is.null,is_retired.eq.false"));
const riderIds = riders.map((r) => r.id);
const abilities = await readAllIn("rider_derived_abilities", ["rider_id", ...ABILITY_KEYS].join(", "), "rider_id", riderIds);
const abById = new Map(abilities.map((a) => [a.rider_id, a]));
const cond = await readAllIn("rider_condition", "rider_id, fatigue", "rider_id", riderIds);
const fatById = new Map(cond.map((c) => [c.rider_id, c.fatigue]));
const ridersByTeam = new Map();
for (const r of riders) {
  const ab = abById.get(r.id); if (!ab) continue;
  if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
  ridersByTeam.get(r.team_id).push({ rider_id: r.id, abilities: ab, fatigue: fatById.get(r.id) });
}

// Overlap-vinduer (tracks=2) pr. pulje, in-memory.
const racesByPool = new Map();
for (const r of races) { const k = r.league_division_id ?? "null"; if (!racesByPool.has(k)) racesByPool.set(k, []); racesByPool.get(k).push(r); }
const overlapWin = new Map();
const anchor = new Date("2026-07-01T00:00:00Z"); // fast anker (determinisme); kun relativ tid betyder noget
for (const [, poolRaces] of racesByPool) {
  const { stageRows } = planRaceSchedules({ races: poolRaces.map((r) => ({ id: r.id, name: r.name, stages: r.stages })), from: anchor, tracks: 2 });
  const byRace = new Map();
  for (const s of stageRows) { if (!byRace.has(s.race_id)) byRace.set(s.race_id, []); byRace.get(s.race_id).push(s); }
  for (const [id, rows] of byRace) overlapWin.set(id, raceTimeWindow(rows));
}

// Kør assignTeamAcrossRaces pr. pulje/hold mod et givet vindue-opslag → scorecard.
const teamsByPool = new Map();
for (const t of teams) { const k = t.league_division_id ?? "null"; if (!teamsByPool.has(k)) teamsByPool.set(k, []); teamsByPool.get(k).push(t); }

function score(winByRace, label) {
  let slots = 0, any = 0, full = 0, noShow = 0;
  let peakSum = 0, pools = 0;
  for (const [poolKey, poolRaces] of racesByPool) {
    const usable = poolRaces.filter((r) => winByRace.get(r.id));
    // Peak-concurrency pr. pulje (interval-sweep).
    const ev = [];
    for (const r of usable) { const w = winByRace.get(r.id); ev.push([w.start, 1], [w.end, -1]); }
    ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let cur = 0, peak = 0; for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur); }
    peakSum += peak; pools++;
    for (const team of teamsByPool.get(poolKey) || []) {
      const teamRaces = usable.map((r) => ({ race_id: r.id, window: winByRace.get(r.id), stages: stagesByRace.get(r.id) || [], sizeRule: selectionSizeForRace(r) }));
      const assignment = assignTeamAcrossRaces({ riders: ridersByTeam.get(team.id) || [], races: teamRaces });
      for (const r of usable) {
        const picks = assignment[r.id] || [];
        const min = selectionSizeForRace(r)?.min ?? 6;
        slots++;
        if (picks.length >= 1) any++; else noShow++;
        if (picks.length >= min) full++;
      }
    }
  }
  console.log(`\n=== ${label} ===`);
  console.log(`Peak-concurrency (snit pr. pulje): ${(peakSum / pools).toFixed(2)}`);
  console.log(`Hold-slots: ${slots}`);
  console.log(`  ≥1 rytter:  ${any}/${slots} (${Math.round(100 * any / slots)}%)`);
  console.log(`  FULDT hold: ${full}/${slots} (${Math.round(100 * full / slots)}%)`);
  console.log(`  auto-no-show (0 ryttere): ${noShow}/${slots} (${Math.round(100 * noShow / slots)}%)`);
  return { slots, any, full, noShow };
}

const base = score(baselineWin, "BASELINE (faktisk sekventiel kalender)");
const ovl = score(overlapWin, "OVERLAP (tracks=2, simuleret)");
console.log("\n=== SCORECARD-DELTA ===");
console.log(`FULDT hold: ${Math.round(100 * base.full / base.slots)}% → ${Math.round(100 * ovl.full / ovl.slots)}% (${Math.round(100 * (ovl.full - base.full) / base.slots)} pp)`);
console.log(`auto-no-show: ${Math.round(100 * base.noShow / base.slots)}% → ${Math.round(100 * ovl.noShow / ovl.slots)}%`);
console.log("\n(Faldet i FULDT-hold-grad = bund-rytter-behovet næste fase skal lukke.)");
process.exit(0);
```

- [ ] **Step 2: Syntax-tjek + kør mod prod**

Run: `cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders && node --check backend/scripts/dev/simulate-overlap-fill.mjs && infisical run --env=prod -- node backend/scripts/dev/simulate-overlap-fill.mjs`
Expected: To scorecards + delta. BASELINE FULDT ≈ 72% (sanity mod 0b-verifikationen); OVERLAP-peak ≈ 2.00; OVERLAP FULDT lavere end baseline. Ingen fejl, ingen writes.

- [ ] **Step 3: Commit**

```bash
cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"
git add backend/scripts/dev/simulate-overlap-fill.mjs
git commit -F <commit-msg-fil>
```
Commit-besked: `feat(race-hub): simulér-før-ship harness for kalender-overlap fyldnings-scorecard`

**STOP-GATE efter Task 4:** Rapportér scorecardet til ejeren før Task 5/6. Det bekræfter overlap-mekanikken giver det forventede billede og leverer bund-rytter-baselinen.

---

## Task 5: Sæson-1 reschedule-script (dry-run-først, ejer-go på live)

**Files:**
- Create: `backend/scripts/dev/reschedule-overlap.mjs`

- [ ] **Step 1: Skriv scriptet**

```javascript
// Re-schedule den aktive sæsons scheduled løb til overlap-format (planRaceSchedules
// tracks=2), pr. pulje. Dry-run default: rapporterer ny peak-concurrency + binding-
// konflikter i eksisterende manuelle udtagelser UDEN writes. --live (ejer-go) skriver
// scheduled_for + race_stage_schedule og rydder konflikt-entries.
//
// Kør (preview): infisical run --env=prod -- node backend/scripts/dev/reschedule-overlap.mjs
// Kør (LIVE):    infisical run --env=prod -- node backend/scripts/dev/reschedule-overlap.mjs --live
import { createClient } from "@supabase/supabase-js";
import { planRaceSchedules } from "../backfillRaceScheduledFor.js";
import { raceTimeWindow, windowsOverlap, findManualOverlapConflicts } from "../../lib/raceBinding.js";

const LIVE = process.argv.includes("--live");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function readAllIn(table, cols, inCol, ids) {
  const out = []; const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const { data, error } = await sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number} — ${LIVE ? "LIVE (skriver)" : "DRY-RUN (ingen writes)"}\n`);

// SIKKERHED: kun scheduled løb uden afviklede etaper.
const { data: races } = await sb.from("races")
  .select("id, name, league_division_id, stages, status, stages_completed").eq("season_id", season.id);
const reschedulable = races.filter((r) => r.status === "scheduled" && (r.stages_completed || 0) === 0);
if (reschedulable.length !== races.length) {
  console.error(`STOP: ${races.length - reschedulable.length} løb er IKKE rene scheduled/0-afviklet. Afbryd og afklar.`);
  process.exit(1);
}

// Planlæg overlap pr. pulje fra et fælles anker (i morgen).
const anchor = new Date();
const racesByPool = new Map();
for (const r of reschedulable) { const k = r.league_division_id ?? "null"; if (!racesByPool.has(k)) racesByPool.set(k, []); racesByPool.get(k).push(r); }
const allRaceUpdates = [];
const allStageRows = [];
const newWin = new Map();
for (const [, poolRaces] of racesByPool) {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: poolRaces.map((r) => ({ id: r.id, name: r.name, stages: r.stages })), from: anchor, tracks: 2 });
  allRaceUpdates.push(...raceUpdates);
  allStageRows.push(...stageRows);
  const byRace = new Map();
  for (const s of stageRows) { if (!byRace.has(s.race_id)) byRace.set(s.race_id, []); byRace.get(s.race_id).push(s); }
  for (const [id, rows] of byRace) newWin.set(id, raceTimeWindow(rows));
}

// Ny peak-concurrency pr. pulje (rapport).
for (const [poolKey, poolRaces] of racesByPool) {
  const ev = [];
  for (const r of poolRaces) { const w = newWin.get(r.id); if (w) ev.push([w.start, 1], [w.end, -1]); }
  ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let cur = 0, peak = 0; for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur); }
  console.log(`  pulje ${poolKey}: ${poolRaces.length} løb → ny peak-concurrency = ${peak}`);
}

// Binding-konflikter i eksisterende MANUELLE udtagelser (pr. hold).
const raceIds = reschedulable.map((r) => r.id);
const manualEntries = (await readAllIn("race_entries", "race_id, team_id, rider_id, is_auto_filled", "race_id", raceIds))
  .filter((e) => e.is_auto_filled === false);
const byTeam = new Map();
for (const e of manualEntries) { if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []); byTeam.get(e.team_id).push(e); }
const conflictDrops = []; // {race_id, team_id, rider_id}
for (const [team_id, entries] of byTeam) {
  const conflicts = findManualOverlapConflicts({ entries: entries.map((e) => ({ race_id: e.race_id, rider_id: e.rider_id })), windowByRace: newWin });
  for (const c of conflicts) conflictDrops.push({ race_id: c.dropRaceId, team_id, rider_id: c.rider_id });
}
console.log(`\nManuelle entries: ${manualEntries.length} · binding-konflikter efter overlap: ${conflictDrops.length}`);
for (const c of conflictDrops.slice(0, 20)) console.log(`  drop rytter ${c.rider_id} fra løb ${c.race_id} (hold ${c.team_id})`);

if (!LIVE) {
  console.log("\nDRY-RUN — ingen writes. Kør med --live efter ejer-go.");
  process.exit(0);
}

// LIVE: opdatér scheduled_for, erstat race_stage_schedule, ryd konflikt-entries.
for (const ru of allRaceUpdates) {
  const { error } = await sb.from("races").update({ scheduled_for: ru.scheduled_for }).eq("id", ru.id);
  if (error) throw new Error(`races update ${ru.id}: ${error.message}`);
}
for (let i = 0; i < raceIds.length; i += 200) {
  const { error } = await sb.from("race_stage_schedule").delete().in("race_id", raceIds.slice(i, i + 200));
  if (error) throw new Error(`race_stage_schedule delete: ${error.message}`);
}
for (let i = 0; i < allStageRows.length; i += 500) {
  const { error } = await sb.from("race_stage_schedule").insert(allStageRows.slice(i, i + 500));
  if (error) throw new Error(`race_stage_schedule insert: ${error.message}`);
}
for (const c of conflictDrops) {
  const { error } = await sb.from("race_entries").delete().eq("race_id", c.race_id).eq("team_id", c.team_id).eq("rider_id", c.rider_id).eq("is_auto_filled", false);
  if (error) throw new Error(`konflikt-drop ${c.rider_id}/${c.race_id}: ${error.message}`);
}
console.log(`\nLIVE: ${allRaceUpdates.length} løb re-scheduled · ${allStageRows.length} etape-tider · ${conflictDrops.length} konflikt-entries ryddet.`);
process.exit(0);
```

- [ ] **Step 2: Syntax-tjek + dry-run mod prod**

Run: `cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders && node --check backend/scripts/dev/reschedule-overlap.mjs && infisical run --env=prod -- node backend/scripts/dev/reschedule-overlap.mjs`
Expected: Peak-concurrency ≈ 2 pr. pulje + konflikt-rapport (forventeligt få). Ingen writes.

- [ ] **Step 3: Commit (IKKE --live endnu)**

```bash
cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"
git add backend/scripts/dev/reschedule-overlap.mjs
git commit -F <commit-msg-fil>
```
Commit-besked: `feat(race-hub): sæson-reschedule-script til overlap (dry-run-først)`

**EJER-GO-GATE:** Selve `--live`-kørslen mod prod (muterer scheduled_for + race_stage_schedule + rydder konflikt-entries) kræver ejerens eksplicitte go. Kør IKKE --live uden det. Verificeret backup `cyclingzone-20260622-153339` + PITR findes.

---

## Task 6: Patch notes (brugerrettet ændring)

Kalender-overlap ændrer spil-oplevelsen (samme hold kan ikke længere køre alle løb; stage races strækker sig 1 etape/dag). Brugerrettet → patch note obligatorisk.

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/public/locales/en/help.json` + `frontend/public/locales/da/help.json` (hvis race-planlægning er dækket; ellers note hvorfor ikke)

- [ ] **Step 1: Find nyeste version + tilføj patch-note-blok**

Læs toppen af `frontend/src/pages/PatchNotesPage.jsx` for det nuværende version-mønster (seneste var v6.04). Tilføj en ny version-blok øverst i samme struktur som de eksisterende, fx:

> **v6.05** — Løb overlapper nu i kalenderen. Hver division kører to løb ad gangen, og en rytter kan kun køre ét løb ad gangen — så du skal fordele truppen mellem samtidige løb. Etapeløb afvikles én etape om dagen og binder dine ryttere, mens de står på. (EN primær, DA sekundær — match den eksisterende fil-struktur og to-sprogs-konvention.)

(Worker: kopiér den NØJAGTIGE struktur fra den øverste eksisterende blok — felt-navne, dato-format, i18n-nøgler. Ingen em-dash i copy; følg tone-reglerne.)

- [ ] **Step 2: Verificér frontend build + version-check**

Run: `cd frontend && npm run build`
Expected: Build OK (patch-notes version-check i CI kræver en ny blok ved brugerrettet ændring).

- [ ] **Step 3: Commit**

```bash
cd C:/dev/CyclingZone-worktrees/feat-race-hub-0c-base-riders
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/race-hub-0c-base-riders"
git add frontend/src/pages/PatchNotesPage.jsx frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -F <commit-msg-fil>
```
Commit-besked: `docs(patch-notes): v6.05 kalender-overlap`

---

## Afsluttende: CI-gate + PR

- [ ] **Kør hele CI-gate-sættet** fra worktree-roden:
  - `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + frontend-build)
  - `cd frontend && npm run lint` + i18n-leak + tone-em-dash + warning-budget
- [ ] **Åbn PR** mod main med Brugerverifikation-sektion. PR-body skal nævne: overlap-mekanik (mergebar), simulér-scorecard (vedlæg tallene), og at sæson-1 `--live`-reschedule afventer ejer-go (ikke en del af merge). Ingen `database/*.sql` i denne PR → normal merge-flow (men prod-reschedulen er en separat ejer-handling).

---

## Self-Review (udført af plan-forfatter)

**Spec-dækning:**
- §4 spor-mekanik → Task 1 ✅
- §5 materializer-integration → Task 2 ✅
- §6 sæson-1 reschedule + §6.1 konflikt-håndtering → Task 3 (detektor) + Task 5 (script) ✅
- §7 simulér-scorecard → Task 4 ✅
- §9 test-strategi → tests i Task 1-3, harness-kørsel i Task 4-5 ✅
- Patch note (brugerrettet) → Task 6 ✅

**Placeholder-scan:** Ingen TBD/TODO; al kode er konkret. Patch-note-teksten henviser til eksisterende fil-struktur frem for at gætte i18n-nøgle-navne (bevidst — worker læser den faktiske struktur).

**Type-konsistens:** `findManualOverlapConflicts({entries, windowByRace})` → `{rider_id, keepRaceId, dropRaceId}` bruges identisk i Task 3 (def) og Task 5 (forbrug). `planRaceSchedules({races, from, slots, tracks})` konsistent i Task 1/4/5. `selectionSizeForRace(race).min` konsistent.
