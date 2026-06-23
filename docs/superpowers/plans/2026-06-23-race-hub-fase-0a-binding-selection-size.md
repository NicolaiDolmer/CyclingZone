# Race Hub — Fase 0a: rytter-binding + selection-størrelse (6/7/8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indfør den hårde overlap-regel (en rytter kan kun køre ét løb ad gangen; et etapeløb binder fra første til sidste etape) i manager-udtagelsen, og gør startfelt-størrelsen kategori-afhængig (6/7/8 pr. `race_class`).

**Architecture:** To rene moduler + én endpoint-integration. `raceBinding.js` indeholder pure funktioner (tidsvindue, overlap, konflikt-detektion) plus én tynd DB-loader. `raceAutopick.js`'s `SELECTION_SIZE` udvides til en fuld `race_class → {min,max}`-mapping. PUT `/api/races/:raceId/selection` afviser en udtagelse hvis en rytter allerede er bundet i et tidsoverlappende løb (ny fejlkode `selection_rider_bound`).

**Tech Stack:** Node.js (ESM), Supabase (`@supabase/supabase-js`), `node:test` + `node:assert/strict`. Ingen nye dependencies.

**Afgrænsning:** Denne plan dækker IKKE afmeld-state, den proaktive generator, eller bund-ryttere (Fase 0b/0c). De præcise klasse→størrelse-tal er en **kalibrerbar konstant** der bekræftes i simulerings-trinnet (Fase 0c) — strukturen bygges her.

---

### Task 1: Udvid `SELECTION_SIZE` til 6/7/8 pr. race_class

**Files:**
- Modify: `backend/lib/raceAutopick.js:11-19`
- Test: `backend/lib/raceAutopick.test.js:15-19` (eksisterende test opdateres)

- [ ] **Step 1: Opdater den eksisterende test til den nye mapping**

Erstat testen `selectionSizeForRace: GT = 8/8, øvrige 6-8` (raceAutopick.test.js:15-19) med:

```javascript
test("selectionSizeForRace: 8 (GT), 7 (WorldTour), 6 (øvrige), default 6", () => {
  assert.deepEqual(selectionSizeForRace({ race_class: "TourFrance" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "GiroVuelta" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "Monuments" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "OtherWorldTourA" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "OtherWorldTourC" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "ProSeries" }), { min: 6, max: 6 });
  assert.deepEqual(selectionSizeForRace({ race_class: "Class1" }), { min: 6, max: 6 });
  assert.deepEqual(selectionSizeForRace({ race_class: null }), { min: 6, max: 6 });
  assert.deepEqual(selectionSizeForRace({}), { min: 6, max: 6 });
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceAutopick.test.js`
Expected: FAIL — fx `Monuments` giver i dag `{min:6,max:8}`, ikke `{min:7,max:7}`.

- [ ] **Step 3: Udvid SELECTION_SIZE-mappingen**

Erstat `SELECTION_SIZE`-objektet (raceAutopick.js:11-15) med den fulde mapping. Behold `selectionSizeForRace` uændret (den slår allerede op pr. `race_class` med `default`-fallback):

```javascript
// Spec 8.1 + race-hub Fase 0a: startfelt-størrelse pr. kategori — 8 (Grand Tours),
// 7 (WorldTour-niveau), 6 (øvrige). Nøgler = race_class-værdier (database/2026-05-09-race-pool.sql).
// KALIBRERBAR: de præcise klasse→antal bekræftes i simulér-før-ship (Fase 0c).
export const SELECTION_SIZE = Object.freeze({
  default:         Object.freeze({ min: 6, max: 6 }),
  Class2:          Object.freeze({ min: 6, max: 6 }),
  Class1:          Object.freeze({ min: 6, max: 6 }),
  ProSeries:       Object.freeze({ min: 6, max: 6 }),
  OtherWorldTourC: Object.freeze({ min: 7, max: 7 }),
  OtherWorldTourB: Object.freeze({ min: 7, max: 7 }),
  OtherWorldTourA: Object.freeze({ min: 7, max: 7 }),
  Monuments:       Object.freeze({ min: 7, max: 7 }),
  GiroVuelta:      Object.freeze({ min: 8, max: 8 }),
  TourFrance:      Object.freeze({ min: 8, max: 8 }),
});
```

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceAutopick.test.js`
Expected: PASS (alle tests i filen grønne — bekræft at `autopick`-testene stadig passer, da `min(rule.max, available)` håndterer de nye max-værdier).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceAutopick.js backend/lib/raceAutopick.test.js
git commit -m "feat(race): selection-størrelse 6/7/8 pr. race_class" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure binding-funktioner (`raceBinding.js`)

**Files:**
- Create: `backend/lib/raceBinding.js`
- Test: `backend/lib/raceBinding.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Opret `backend/lib/raceBinding.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { raceTimeWindow, windowsOverlap, findRiderBindingConflicts } from "./raceBinding.js";

test("raceTimeWindow: start=tidligste, end=seneste etape", () => {
  const w = raceTimeWindow([
    { scheduled_at: "2026-06-23T10:30:00Z" },
    { scheduled_at: "2026-06-25T13:00:00Z" },
    { scheduled_at: "2026-06-24T13:00:00Z" },
  ]);
  assert.equal(w.start, Date.parse("2026-06-23T10:30:00Z"));
  assert.equal(w.end, Date.parse("2026-06-25T13:00:00Z"));
});

test("raceTimeWindow: tom/ugyldig → null", () => {
  assert.equal(raceTimeWindow([]), null);
  assert.equal(raceTimeWindow(null), null);
});

test("windowsOverlap: deler tidspunkt → true; adskilte → false", () => {
  const a = { start: 100, end: 200 };
  assert.equal(windowsOverlap(a, { start: 150, end: 300 }), true);  // overlap
  assert.equal(windowsOverlap(a, { start: 200, end: 400 }), true);  // rører ved enden
  assert.equal(windowsOverlap(a, { start: 201, end: 400 }), false); // adskilt
  assert.equal(windowsOverlap(a, null), false);
});

test("findRiderBindingConflicts: rytter i tidsoverlappende løb flagges", () => {
  const thisWindow = { start: 100, end: 200 };
  const otherRaces = [
    { window: { start: 150, end: 250 }, riderIds: ["r1", "r2"] }, // overlapper
    { window: { start: 400, end: 500 }, riderIds: ["r3"] },        // overlapper IKKE
  ];
  const conflicts = findRiderBindingConflicts({ riderIds: ["r1", "r3", "r4"], thisWindow, otherRaces });
  assert.deepEqual(conflicts.sort(), ["r1"]); // r1 bundet; r3 i ikke-overlappende; r4 fri
});

test("findRiderBindingConflicts: intet vindue → ingen konflikter", () => {
  assert.deepEqual(findRiderBindingConflicts({ riderIds: ["r1"], thisWindow: null, otherRaces: [] }), []);
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceBinding.test.js`
Expected: FAIL med "Cannot find module './raceBinding.js'".

- [ ] **Step 3: Skriv `raceBinding.js` (pure del)**

Opret `backend/lib/raceBinding.js`:

```javascript
// backend/lib/raceBinding.js
// Race-hub Fase 0a: rytter-binding. En rytter kan kun køre ÉT løb ad gangen.
// Et etapeløb binder fra første til sidste etape (hele tidsvinduet).

// Et løbs tidsvindue = [tidligste etape-tid, seneste etape-tid] som epoch-ms.
// Tom/ugyldig schedule → null (løbet kan ikke binde noget).
export function raceTimeWindow(scheduleRows) {
  if (!scheduleRows?.length) return null;
  const times = scheduleRows
    .map((r) => Date.parse(r.scheduled_at))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

// To vinduer overlapper hvis de deler mindst ét tidspunkt (inklusiv ender —
// to løb der starter samtidig overlapper). Defensiv mod null.
export function windowsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
}

// Givet det løb man udtager til (thisWindow) og holdets andre løb (otherRaces:
// [{ window, riderIds }]), returnér de rider_ids fra `riderIds` der allerede er
// bundet i et tidsoverlappende løb. Pure + deterministisk.
export function findRiderBindingConflicts({ riderIds = [], thisWindow, otherRaces = [] }) {
  if (!thisWindow) return [];
  const wanted = new Set(riderIds);
  const bound = new Set();
  for (const other of otherRaces) {
    if (!windowsOverlap(thisWindow, other.window)) continue;
    for (const rid of other.riderIds || []) {
      if (wanted.has(rid)) bound.add(rid);
    }
  }
  return [...bound];
}
```

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceBinding.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceBinding.js backend/lib/raceBinding.test.js
git commit -m "feat(race): pure binding-funktioner (tidsvindue, overlap, konflikt)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: DB-loader `loadTeamBindingContext`

**Files:**
- Modify: `backend/lib/raceBinding.js` (tilføj loader nederst)
- Test: `backend/lib/raceBinding.test.js` (tilføj mock-test)

- [ ] **Step 1: Skriv den fejlende mock-test**

Tilføj øverst i `raceBinding.test.js` (efter de eksisterende imports) import af loaderen:

```javascript
import { raceTimeWindow, windowsOverlap, findRiderBindingConflicts, loadTeamBindingContext } from "./raceBinding.js";
```

Tilføj denne mock + test nederst i filen:

```javascript
// Mock-supabase: svarer pr. tabel; ignorerer filtre (testen verificerer kombinations-
// logikken, ikke query-filtrene). Mønster fra raceFatigue.test.js.
function makeSupabase({ scheduleByRace = {}, teamEntries = [] } = {}) {
  function from(table) {
    const f = {};
    const b = {
      select() { return b; },
      eq(col, val) { f[col] = val; return b; },
      neq(col, val) { f["neq_" + col] = val; return b; },
      in(col, vals) { f["in_" + col] = vals; return b; },
      then(resolve, reject) {
        let data = [];
        if (table === "race_stage_schedule") {
          if (f.race_id) data = scheduleByRace[f.race_id] || [];
          else if (f.in_race_id) data = f.in_race_id.flatMap((id) => scheduleByRace[id] || []);
        } else if (table === "race_entries") {
          data = teamEntries;
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("loadTeamBindingContext: bygger thisWindow + otherRaces grupperet pr. løb", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }],
      "race-a": [
        { race_id: "race-a", scheduled_at: "2026-06-23T13:00:00Z" },
        { race_id: "race-a", scheduled_at: "2026-06-24T13:00:00Z" },
      ],
    },
    teamEntries: [
      { race_id: "race-a", rider_id: "r1" },
      { race_id: "race-a", rider_id: "r2" },
    ],
  });
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.equal(ctx.thisWindow.start, Date.parse("2026-06-23T10:30:00Z"));
  assert.equal(ctx.otherRaces.length, 1);
  assert.equal(ctx.otherRaces[0].window.end, Date.parse("2026-06-24T13:00:00Z"));
  assert.deepEqual(ctx.otherRaces[0].riderIds.sort(), ["r1", "r2"]);
});

test("loadTeamBindingContext: ingen andre entries → tom otherRaces", async () => {
  const supabase = makeSupabase({
    scheduleByRace: { "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }] },
    teamEntries: [],
  });
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.deepEqual(ctx.otherRaces, []);
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceBinding.test.js`
Expected: FAIL med "loadTeamBindingContext is not a function" (eller import-fejl).

- [ ] **Step 3: Tilføj `loadTeamBindingContext` til `raceBinding.js`**

Tilføj nederst i `backend/lib/raceBinding.js`:

```javascript
// DB-loader: hent det aktuelle løbs tidsvindue + holdets udtagne ryttere i ANDRE
// løb (grupperet pr. løb med deres tidsvindue), så findRiderBindingConflicts kan
// afgøre om en udtagelse dobbeltbooker en rytter. Tynd I/O — al logik er pure ovenfor.
export async function loadTeamBindingContext({ supabase, race, teamId }) {
  const { data: thisSched, error: e1 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at").eq("race_id", race.id);
  if (e1) throw new Error(`race_stage_schedule (this): ${e1.message}`);
  const thisWindow = raceTimeWindow(thisSched);

  // Holdets entries i ANDRE løb end dette.
  const { data: entries, error: e2 } = await supabase
    .from("race_entries").select("race_id, rider_id").eq("team_id", teamId).neq("race_id", race.id);
  if (e2) throw new Error(`race_entries (binding): ${e2.message}`);

  const ridersByRace = new Map();
  for (const e of entries || []) {
    if (!ridersByRace.has(e.race_id)) ridersByRace.set(e.race_id, []);
    ridersByRace.get(e.race_id).push(e.rider_id);
  }
  const otherRaceIds = [...ridersByRace.keys()];
  if (!otherRaceIds.length) return { thisWindow, otherRaces: [] };

  const { data: scheds, error: e3 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", otherRaceIds);
  if (e3) throw new Error(`race_stage_schedule (others): ${e3.message}`);

  const schedByRace = new Map();
  for (const s of scheds || []) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }

  const otherRaces = otherRaceIds
    .map((rid) => ({ window: raceTimeWindow(schedByRace.get(rid)), riderIds: ridersByRace.get(rid) }))
    .filter((o) => o.window); // løb uden schedule kan ikke binde
  return { thisWindow, otherRaces };
}
```

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceBinding.test.js`
Expected: PASS (7 tests i alt).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceBinding.js backend/lib/raceBinding.test.js
git commit -m "feat(race): loadTeamBindingContext DB-loader til binding-check" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Håndhæv binding i PUT `/selection`

**Files:**
- Modify: `backend/routes/api.js:1469-1476` (PUT-handler, før `saveSelection`)

- [ ] **Step 1: Tilføj import af binding-modulet**

Find den eksisterende import af `validateSelection`/`saveSelection`/`getSelectionContext` i toppen af `backend/routes/api.js` (søg: `from "../lib/raceSelection.js"`). Tilføj på linjen efter:

```javascript
import { loadTeamBindingContext, findRiderBindingConflicts } from "../lib/raceBinding.js";
```

- [ ] **Step 2: Indsæt binding-check i PUT-handleren**

I PUT `/races/:raceId/selection`-handleren (api.js:1469-1476), efter `validateSelection`-resultatet er tjekket og FØR `await saveSelection(...)`, indsæt:

```javascript
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    // Race-hub Fase 0a: håndhæv overlap-binding — en rytter må ikke være udtaget i
    // et tidsoverlappende løb (et etapeløb binder hele sit vindue).
    const binding = await loadTeamBindingContext({ supabase, race, teamId: req.team.id });
    const bound = findRiderBindingConflicts({ riderIds, thisWindow: binding.thisWindow, otherRaces: binding.otherRaces });
    if (bound.length) {
      return res.status(409).json({ error: "selection_rider_bound", bound_rider_ids: bound });
    }

    await saveSelection({ supabase, race, teamId: req.team.id, riderIds, captainId, sprintCaptainId, hunterId });
```

(Bemærk: den eksisterende `if (!result.ok) ...`-linje og `await saveSelection(...)`-linjen er allerede der — indsæt binding-blokken imellem dem, så den gamle `saveSelection`-linje ikke duplikeres.)

- [ ] **Step 3: Verificér at backend stadig importerer/loader rent**

Run: `cd backend && node --check routes/api.js`
Expected: ingen output (syntaks-OK).

Run: `cd backend && node --input-type=module -e "import('./lib/raceBinding.js').then(m => console.log(Object.keys(m).join(',')))"`
Expected: `raceTimeWindow,windowsOverlap,findRiderBindingConflicts,loadTeamBindingContext`

- [ ] **Step 4: Kør den fulde backend-testsuite**

Run: `cd backend && node --test`
Expected: PASS (alle eksisterende tests + de nye binding-tests grønne; ingen regression).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(race): håndhæv rytter-binding i PUT /selection (selection_rider_bound)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Verify-local + push

**Files:** ingen (verifikation)

- [ ] **Step 1: Kør den delte lokale gate**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests + frontend-tests + frontend-build grønne. (Ingen frontend ændret i 0a, men gaten bekræfter intet er brudt.)

- [ ] **Step 2: Push branchen**

```bash
git push
```
Expected: branchen `worktree-feat+race-hub-redesign` opdateret på origin.

- [ ] **Step 3: Bemærk for senere faser**

Frontend-fejlkoden `selection_rider_bound` skal tilføjes til oversættelserne (`frontend/public/locales/{en,da}/races.json`) når Lag 1/2-UI bygges (Fase 1+). Backend returnerer koden allerede; UI viser den rå indtil da. Noteres her så det ikke tabes — IKKE en del af 0a's leverance.

---

## Self-Review

**Spec-coverage (mod 2026-06-23-race-hub-redesign-design.md):**
- Beslutning 1 (overlap, én rytter/ét løb, etapeløb binder hele vinduet) → Task 2-4. ✓
- Beslutning 7 (6/7/8 pr. kategori) → Task 1. ✓
- Mekanik-ændring 1 "binding-håndhævelse i selection" → Task 4. ✓ (autopick-siden af binding hører til Fase 0b-generatoren — uden for 0a.)
- Resten af Fase 0 (afmeld-state, generator, bund-ryttere) → bevidst uden for denne plan (0b/0c).

**Placeholder-scan:** Ingen TBD/TODO. Klasse→størrelse-tallene er markeret kalibrerbare men har konkrete startværdier (ikke placeholders). ✓

**Type-konsistens:** `raceTimeWindow` → `{start,end}` (epoch-ms) bruges konsistent i `windowsOverlap`, `findRiderBindingConflicts` og `loadTeamBindingContext`. `otherRaces`-formen `[{window, riderIds}]` matcher mellem loader (Task 3) og konflikt-funktion (Task 2). Fejlkode `selection_rider_bound` konsistent. ✓
