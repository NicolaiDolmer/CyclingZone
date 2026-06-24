# Race Hub Fase 1 — Lag 1 trup-fordeling + delt bånd — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spilleren åbner `/races`, ser sine tidsoverlappende løb side om side, og fordeler sin 12-rytters trup på tværs af dem med binding/knaphed eksplicit — assistentens forslag som startpunkt, med afmeld/deltag og "auto-udfyld igen".

**Architecture:** Nyt aggregat-endpoint (`GET /api/races/distribution`) bygget på en ren lib (`raceDistribution.js`) der ejer kolonne-sæt + binding-map + season-dag-projektion. Saves går via det **eksisterende** `PUT /selection` pr. løb (guards bevares). To nye endpoints udfylder Fase 0-huller: afmeld-write (`race_withdrawals`) og spiller-scoped regenerate (genbruger den rene `assignTeamAcrossRaces`). Frontend: thin React-komponenter over en ren `raceHubLogic.js`.

**Tech Stack:** Node.js/Express + Supabase (backend), React + Vite + react-i18next (frontend), `node --test` (unit), Playwright (e2e).

**Design-SSOT:** [`docs/superpowers/specs/2026-06-24-race-hub-fase-1-trup-fordeling-design.md`](../specs/2026-06-24-race-hub-fase-1-trup-fordeling-design.md) + parent [`2026-06-23-race-hub-redesign-design.md`](../specs/2026-06-23-race-hub-redesign-design.md).

---

## File Structure

**Backend:**
- Create `backend/lib/raceDistribution.js` — pure: `buildColumnSet`, `buildBindingMap`, `seasonDayProjection`. Tynd I/O i loader.
- Create `backend/lib/raceDistribution.test.js` — `node --test`.
- Modify `backend/routes/api.js` — 3 nye routes (`GET /races/distribution`, `POST`/`DELETE /races/:raceId/withdrawal`, `POST /races/distribution/regenerate`); import nye libs.

**Frontend:**
- Create `frontend/src/lib/raceHubLogic.js` — pure: `computeColumnStatus`, `isRiderBound`, `boundRaceForRider`, `availableRiderIdsForRace`.
- Create `frontend/src/lib/raceHubLogic.test.js` — `node --test`.
- Create `frontend/src/components/racehub/RaceHubBoard.jsx` — orkestrator (fetch + state).
- Create `frontend/src/components/racehub/ContextBand.jsx` — scope-pills + sæson-tidslinje.
- Create `frontend/src/components/racehub/RaceColumn.jsx` — ét overlap-løb.
- Create `frontend/src/components/racehub/AvailableRidersPool.jsx` — trup-pulje + auto-udfyld.
- Create `frontend/src/components/racehub/AddRiderPopover.jsx` — "tilføj til hvilket løb".
- Modify `frontend/src/pages/RacesPage.jsx` — render `<RaceHubBoard/>` som default-tab-indhold (afløser "upcoming"-kolonnen; behold "completed" + resultat-panel).
- Modify `frontend/public/locales/en/races.json` + `da/races.json` — `racehub.*`-nøgler.
- Create `frontend/tests/e2e/race-distribution.spec.js` — logget-ind board via fixtures-mocks.

**Docs:**
- Modify `frontend/src/data/patchNotes.js` (eller `PatchNotesPage.jsx`-kilden), `frontend/public/locales/{en,da}/help.json`, `docs/NOW.md`, `docs/FEATURE_STATUS.md`.

---

## Task 1: Pure lib `raceDistribution.js` — kolonne-sæt + binding-map + season-dag

**Files:**
- Create: `backend/lib/raceDistribution.js`
- Test: `backend/lib/raceDistribution.test.js`

Genbruger `raceTimeWindow`, `windowsOverlap`, `teamInRacePool` fra `raceBinding.js`. Pure — ingen DB.

- [ ] **Step 1: Write the failing test**

```js
// backend/lib/raceDistribution.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildColumnSet, buildBindingMap } from "./raceDistribution.js";

const W = (h) => ({ start: Date.parse(`2026-07-04T${h}:00Z`), end: Date.parse(`2026-07-04T${h}:00Z`) });

test("buildColumnSet: kun egne-pulje scheduled-løb hvis vindue rammer dagen", () => {
  const races = [
    { id: "a", league_division_id: "p1", status: "scheduled", window: W("12") }, // egen pulje, i dag
    { id: "b", league_division_id: "p2", status: "scheduled", window: W("15") }, // fremmed pulje
    { id: "c", league_division_id: "p1", status: "completed", window: W("12") }, // afsluttet
    { id: "d", league_division_id: null, status: "scheduled", window: W("18") }, // pulje-løs (tilladt)
  ];
  const cols = buildColumnSet({ races, teamDivisionId: "p1", dayWindow: { start: W("00").start, end: Date.parse("2026-07-04T23:59:00Z") } });
  assert.deepEqual(cols.map((r) => r.id).sort(), ["a", "d"]);
});

test("buildBindingMap: rytter udtaget i ét kolonne-løb bindes i de overlappende", () => {
  const columns = [
    { id: "a", window: W("12"), riderIds: ["r1", "r2"] },
    { id: "b", window: W("12"), riderIds: ["r3"] }, // samme tid → overlap med a
    { id: "c", window: W("20"), riderIds: [] },     // senere → ingen overlap
  ];
  const map = buildBindingMap({ columns });
  assert.deepEqual(map["r1"], ["a"]); // r1 er i a, bundet ift. b
  assert.deepEqual(map["r3"], ["b"]);
  assert.equal(map["r9"], undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/lib/raceDistribution.test.js`
Expected: FAIL — "Cannot find module './raceDistribution.js'" / export undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/lib/raceDistribution.js
// Race Hub Fase 1: ren læse-logik for trup-fordeling-board'et. Kolonne-sæt
// (dagens egne-pulje overlap-løb), binding-map (hvilke kolonne-løb en rytter
// allerede er bundet i) og season-dag-projektion til tidslinjen. Pure — ingen DB.
import { windowsOverlap, teamInRacePool } from "./raceBinding.js";

// Løb der bliver kolonner: status scheduled, holdets egen pulje (eller pulje-løs),
// og tidsvindue overlapper den valgte dag. `races` = [{id, league_division_id, status, window}].
export function buildColumnSet({ races = [], teamDivisionId, dayWindow }) {
  if (!dayWindow) return [];
  return races.filter(
    (r) =>
      r.status === "scheduled" &&
      r.window &&
      teamInRacePool({ teamDivisionId, racePoolId: r.league_division_id }) &&
      windowsOverlap(r.window, dayWindow)
  );
}

// For hver rytter: de kolonne-løb han er udtaget i, der overlapper MINDST ét andet
// kolonne-løb (dvs. binder ham væk fra det andet). `columns` = [{id, window, riderIds}].
export function buildBindingMap({ columns = [] }) {
  const map = {};
  for (const col of columns) {
    const overlapsAnother = columns.some((o) => o.id !== col.id && windowsOverlap(col.window, o.window));
    if (!overlapsAnother) continue;
    for (const rid of col.riderIds || []) {
      if (!map[rid]) map[rid] = [];
      if (!map[rid].includes(col.id)) map[rid].push(col.id);
    }
  }
  return map;
}

// Tidslinje-projektion: 60 dage med dato-tekst + terræn-glyf-nøgle + om holdet har et løb.
// `dayProfiles` = Map<day, { dateText, terrain, hasMyRace }>. Manglende dag → tom standard.
export function seasonDayProjection({ totalDays = 60, currentDay, dayProfiles = new Map() }) {
  const days = [];
  for (let day = 1; day <= totalDays; day++) {
    const p = dayProfiles.get(day) || {};
    days.push({ day, dateText: p.dateText ?? null, terrain: p.terrain ?? null, hasMyRace: !!p.hasMyRace });
  }
  return { totalDays, currentDay: currentDay ?? null, days };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/lib/raceDistribution.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add terrain-glyph helper test + impl**

Tilføj i test-filen:

```js
import { dominantTerrain } from "./raceDistribution.js";

test("dominantTerrain: flertal vinder, lige → mixed", () => {
  assert.equal(dominantTerrain(["flat", "flat", "hills"]), "flat");
  assert.equal(dominantTerrain(["flat", "hills"]), "mixed");
  assert.equal(dominantTerrain([]), null);
});
```

Tilføj i `raceDistribution.js`:

```js
// Terræn-glyf for en dag: flertals-profil blandt dagens etaper; lige fordeling → "mixed".
export function dominantTerrain(profileTypes = []) {
  if (!profileTypes.length) return null;
  const counts = new Map();
  for (const t of profileTypes) counts.set(t, (counts.get(t) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return "mixed";
  return sorted[0][0];
}
```

- [ ] **Step 6: Run + commit**

Run: `node --test backend/lib/raceDistribution.test.js` → PASS (3 tests).

```bash
git add backend/lib/raceDistribution.js backend/lib/raceDistribution.test.js
git commit -m "feat(race-hub): pure distribution lib — column-set, binding-map, season-day"
```

---

## Task 2: `GET /api/races/distribution` endpoint

**Files:**
- Modify: `backend/routes/api.js` (import + ny route nær `/races/:raceId/selection`, ~linje 1445)

Tynd I/O der spejler `GET /selection`-mønstret (`requireAuth`, `req.team`, `isViewerBetaTester`, `isRaceEngineV2Enabled`). Genbruger `getSelectionContext`-rytterprojektionen pr. løb og de rene `raceDistribution`-funktioner.

- [ ] **Step 1: Import libs**

Tilføj ved de øvrige race-imports (efter `raceBinding.js`-importen, ~linje 126):

```js
import { buildColumnSet, buildBindingMap, seasonDayProjection, dominantTerrain } from "../lib/raceDistribution.js";
import { raceTimeWindow } from "../lib/raceBinding.js";
```

(`raceTimeWindow` er allerede eksporteret fra `raceBinding.js`; tilføj kun hvis ikke allerede importeret — tjek den eksisterende import-linje 126 og udvid den i stedet for en dublet.)

- [ ] **Step 2: Add the route**

Indsæt efter `GET /races/:raceId/selection`-handleren (efter linje 1445):

```js
// Race Hub Fase 1 — GET /api/races/distribution?day=N
// Aggregat-læsning til trup-fordeling-board'et: dagens egne-pulje overlap-løb som
// kolonner + holdets trup + binding-map + sæson-tidslinje. Saves går stadig via
// PUT /races/:raceId/selection (guards bevares). flag OFF → enabled:false.
router.get("/races/distribution", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
    if (!enabled) return res.json({ enabled: false });

    const { data: season } = await supabase
      .from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
    if (!season) return res.json({ enabled: true, season: null, columns: [], timeline: null });

    // Alle holdets-pulje + pulje-løse scheduled-løb i sæsonen, med tidsvinduer.
    const { data: races } = await supabase
      .from("races")
      .select("id, name, race_type, race_class, stages, status, league_division_id, pool_race:pool_race_id(date_text)")
      .eq("season_id", season.id);
    const raceIds = (races || []).map((r) => r.id);
    const { data: schedRows } = await supabase
      .from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", raceIds.slice(0, 1000));
    const schedByRace = new Map();
    for (const s of schedRows || []) {
      if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
      schedByRace.get(s.race_id).push(s);
    }
    const withWindow = (races || []).map((r) => ({ ...r, window: raceTimeWindow(schedByRace.get(r.id)) }));

    // Valgt dag → dag-vindue (CET-døgn). day mangler → i dag.
    const dayParam = Number.parseInt(req.query.day, 10);
    const { dayWindow, currentDay, totalDays } = resolveSeasonDay({ season, schedRows, dayParam });

    const cols = buildColumnSet({ races: withWindow, teamDivisionId: req.team.league_division_id, dayWindow });

    // Pr. kolonne: udtagelses-kontekst (genbrug getSelectionContext) + afmeld-state.
    const { data: withdrawals } = await supabase
      .from("race_withdrawals").select("race_id").eq("team_id", req.team.id);
    const withdrawnSet = new Set((withdrawals || []).map((w) => w.race_id));
    const columns = [];
    for (const race of cols) {
      const ctx = await getSelectionContext({ supabase, race, teamId: req.team.id });
      columns.push({
        id: race.id, name: race.name, race_class: race.race_class, race_type: race.race_type,
        stages: race.stages, status: race.status, window: race.window,
        size: ctx.size, riders: ctx.riders, selection: ctx.selection,
        withdrawn: withdrawnSet.has(race.id),
        counts: { selected: ctx.selection?.rider_ids?.length ?? 0, target: ctx.size.max },
      });
    }

    const bindingMap = buildBindingMap({
      columns: columns.map((c) => ({ id: c.id, window: c.window, riderIds: c.selection?.rider_ids || [] })),
    });

    // Tidslinje: terræn-glyf pr. dag (dominerende profil) + om holdet har løb.
    const timeline = await buildTimeline({ supabase, season, races: withWindow, schedByRace, teamDivisionId: req.team.league_division_id, currentDay, totalDays });

    res.json({ enabled: true, season: { id: season.id, number: season.number }, currentDay, columns, bindingMap, timeline });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Add the two private helpers**

Lige under routen (samme fil), to lokale helpers. `resolveSeasonDay` mapper sæson-start + day-param til et CET-døgnvindue; `buildTimeline` bygger `seasonDayProjection`-input. Hold dem simple og deterministiske:

```js
// Sæson-dag → CET-døgnvindue. day 1 = sæsonens første race-dag (tidligste scheduled_at).
function resolveSeasonDay({ season, schedRows, dayParam }) {
  const times = (schedRows || []).map((s) => Date.parse(s.scheduled_at)).filter(Number.isFinite);
  const firstMs = times.length ? Math.min(...times) : Date.parse(season.start_date || "2026-01-01");
  const DAY = 86_400_000;
  const lastMs = times.length ? Math.max(...times) : firstMs;
  const totalDays = Math.max(1, Math.round((lastMs - firstMs) / DAY) + 1);
  const today = Math.floor((Date.now() - firstMs) / DAY) + 1;
  const currentDay = Math.min(Math.max(today, 1), totalDays);
  const day = Number.isFinite(dayParam) ? Math.min(Math.max(dayParam, 1), totalDays) : currentDay;
  const start = firstMs + (day - 1) * DAY;
  return { dayWindow: { start, end: start + DAY - 1 }, currentDay, totalDays };
}

async function buildTimeline({ supabase, races, schedByRace, teamDivisionId, currentDay, totalDays }) {
  const raceIds = races.map((r) => r.id);
  const { data: profiles } = await supabase
    .from("race_stage_profiles").select("race_id, profile_type").in("race_id", raceIds.slice(0, 1000));
  const profByRace = new Map();
  for (const p of profiles || []) {
    if (!profByRace.has(p.race_id)) profByRace.set(p.race_id, []);
    profByRace.get(p.race_id).push(p.profile_type);
  }
  const firstMs = Math.min(...races.flatMap((r) => (schedByRace.get(r.id) || []).map((s) => Date.parse(s.scheduled_at))).filter(Number.isFinite));
  const DAY = 86_400_000;
  const dayProfiles = new Map();
  for (const r of races) {
    const mine = teamInRacePool({ teamDivisionId, racePoolId: r.league_division_id });
    for (const s of schedByRace.get(r.id) || []) {
      const day = Math.floor((Date.parse(s.scheduled_at) - firstMs) / DAY) + 1;
      const prev = dayProfiles.get(day) || { terrainTypes: [], hasMyRace: false };
      prev.terrainTypes.push(...(profByRace.get(r.id) || []));
      if (mine) prev.hasMyRace = true;
      prev.dateText = r.pool_race?.date_text ?? prev.dateText ?? null;
      dayProfiles.set(day, prev);
    }
  }
  const projected = new Map();
  for (const [day, v] of dayProfiles) projected.set(day, { dateText: v.dateText, terrain: dominantTerrain(v.terrainTypes), hasMyRace: v.hasMyRace });
  return seasonDayProjection({ totalDays, currentDay, dayProfiles: projected });
}
```

(`teamInRacePool` er allerede importeret fra `raceBinding.js` ved linje 126.)

- [ ] **Step 4: Smoke-verify lokalt**

Start backend (`npm --prefix backend run dev` eller eksisterende script), kald som logget-ind hold. Forventet: `{ enabled: true, columns: [...], bindingMap: {...}, timeline: {...} }`. Hvis race-engine-flag OFF i lokal DB → `{ enabled: false }` (forventet; UI skjuler board'et).

- [ ] **Step 5: Run backend test suite + commit**

Run: `node --test backend/lib/` (rør ikke ved eksisterende — bekræft grøn).

```bash
git add backend/routes/api.js
git commit -m "feat(race-hub): GET /races/distribution aggregate read endpoint"
```

---

## Task 3: Afmeld/deltag endpoints `POST`/`DELETE /api/races/:raceId/withdrawal`

**Files:**
- Modify: `backend/routes/api.js` (efter `PUT /selection`, ~linje 1505)

- [ ] **Step 1: Add POST (afmeld)**

```js
// Race Hub Fase 1 — POST /api/races/:raceId/withdrawal (afmeld). Frivillig deltagelse:
// holdet trækker sig fra løbet (auto-no-show ved afvikling). Pulje-guard + scheduled-guard.
router.post("/races/:raceId/withdrawal", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
    if (!enabled) return res.status(409).json({ error: "selection_flag_disabled" });
    const { data: race, error } = await supabase
      .from("races").select("id, status, league_division_id").eq("id", req.params.raceId).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!race) return res.status(404).json({ error: "race_not_found" });
    if (race.status !== "scheduled") return res.status(409).json({ error: "selection_race_not_open" });
    if (!teamInRacePool({ teamDivisionId: req.team.league_division_id, racePoolId: race.league_division_id })) {
      return res.status(409).json({ error: "selection_wrong_pool" });
    }
    const { error: upErr } = await supabase
      .from("race_withdrawals").upsert({ race_id: race.id, team_id: req.team.id }, { onConflict: "race_id,team_id" });
    if (upErr) return res.status(500).json({ error: upErr.message });
    res.json({ ok: true, withdrawn: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add DELETE (gen-deltag)**

```js
// DELETE /api/races/:raceId/withdrawal — gen-deltag (fjern afmelding).
router.delete("/races/:raceId/withdrawal", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const { error: delErr } = await supabase
      .from("race_withdrawals").delete().eq("race_id", req.params.raceId).eq("team_id", req.team.id);
    if (delErr) return res.status(500).json({ error: delErr.message });
    res.json({ ok: true, withdrawn: false });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify + commit**

Lokal smoke: POST → `{ withdrawn: true }`, GET /distribution viser `withdrawn:true` på løbet, DELETE → `{ withdrawn: false }`.

```bash
git add backend/routes/api.js
git commit -m "feat(race-hub): POST/DELETE race withdrawal endpoints (afmeld/deltag)"
```

---

## Task 4: Spiller-scoped regenerate `POST /api/races/distribution/regenerate`

**Files:**
- Modify: `backend/routes/api.js`
- Test: `backend/lib/raceDistribution.test.js` (tilføj locked-windows-assembly-test)

Genbruger den rene `assignTeamAcrossRaces`. Bygger en lille pure helper `lockedWindowsFromManualEntries` i `raceDistribution.js` så assembly er testbar.

- [ ] **Step 1: Write failing test for the pure helper**

Tilføj i `raceDistribution.test.js`:

```js
import { lockedWindowsFromManualEntries } from "./raceDistribution.js";

test("lockedWindowsFromManualEntries: kun manuelle entries (is_auto_filled=false), grupperet pr. løb", () => {
  const entries = [
    { race_id: "x", rider_id: "r1", is_auto_filled: false },
    { race_id: "x", rider_id: "r2", is_auto_filled: false },
    { race_id: "y", rider_id: "r3", is_auto_filled: true },  // auto → ignoreres
  ];
  const windowByRace = new Map([["x", { start: 1, end: 2 }], ["y", { start: 3, end: 4 }]]);
  const locks = lockedWindowsFromManualEntries({ entries, windowByRace, excludeRaceIds: new Set() });
  assert.equal(locks.length, 1);
  assert.deepEqual(locks[0].window, { start: 1, end: 2 });
  assert.deepEqual(locks[0].riderIds.sort(), ["r1", "r2"]);
});

test("lockedWindowsFromManualEntries: excludeRaceIds (de synlige løb) udelades", () => {
  const entries = [{ race_id: "x", rider_id: "r1", is_auto_filled: false }];
  const windowByRace = new Map([["x", { start: 1, end: 2 }]]);
  const locks = lockedWindowsFromManualEntries({ entries, windowByRace, excludeRaceIds: new Set(["x"]) });
  assert.equal(locks.length, 0);
});
```

- [ ] **Step 2: Run → fails**

Run: `node --test backend/lib/raceDistribution.test.js`
Expected: FAIL — `lockedWindowsFromManualEntries` ikke eksporteret.

- [ ] **Step 3: Implement helper in `raceDistribution.js`**

```js
// Manuelle entries (is_auto_filled=false) i ANDRE løb end de synlige → lockedWindows til
// assignTeamAcrossRaces, så regenerering af de synlige løb ikke dobbeltbooker en rytter
// holdet bevidst har forpligtet et overlappende sted. `excludeRaceIds` = de løb der regenereres.
export function lockedWindowsFromManualEntries({ entries = [], windowByRace, excludeRaceIds = new Set() }) {
  const ridersByRace = new Map();
  for (const e of entries) {
    if (e.is_auto_filled !== false) continue;
    if (excludeRaceIds.has(e.race_id)) continue;
    if (!ridersByRace.has(e.race_id)) ridersByRace.set(e.race_id, []);
    ridersByRace.get(e.race_id).push(e.rider_id);
  }
  const locks = [];
  for (const [raceId, riderIds] of ridersByRace) {
    const window = windowByRace.get(raceId);
    if (window) locks.push({ window, riderIds });
  }
  return locks;
}
```

- [ ] **Step 4: Run → passes**

Run: `node --test backend/lib/raceDistribution.test.js` → PASS.

- [ ] **Step 5: Add the route (reuse `assignTeamAcrossRaces`)**

Importér øverst: `import { assignTeamAcrossRaces } from "../lib/raceEntryGenerator.js";` + `import { autopickTeamSelection, selectionSizeForRace } from "../lib/raceAutopick.js";` (tjek for eksisterende imports; udvid i stedet for dublet) + `import { ABILITY_KEYS } from "../lib/raceSimulator.js";` + `import { saveSelection } from "../lib/raceSelection.js";` (allerede importeret) + `import { lockedWindowsFromManualEntries } from "../lib/raceDistribution.js";`.

```js
// Race Hub Fase 1 — POST /api/races/distribution/regenerate?day=N
// "Auto-udfyld igen" for holdet, scoped til dagens overlap-løb. Genbruger den rene
// binding-bevidste assignTeamAcrossRaces; manuelle entries i andre løb låses så de
// ikke dobbeltbookes. Skriver picks som is_auto_filled=true.
router.post("/races/distribution/regenerate", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
    if (!enabled) return res.status(409).json({ error: "selection_flag_disabled" });

    const { data: season } = await supabase.from("seasons").select("id, start_date").eq("status", "active").maybeSingle();
    if (!season) return res.status(409).json({ error: "no_active_season" });

    // Dagens kolonne-løb (gentag distributionens kolonne-udvælgelse).
    const { data: races } = await supabase
      .from("races").select("id, race_class, race_type, stages, status, league_division_id").eq("season_id", season.id);
    const raceIds = (races || []).map((r) => r.id);
    const { data: schedRows } = await supabase.from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", raceIds.slice(0, 1000));
    const schedByRace = new Map();
    for (const s of schedRows || []) { (schedByRace.get(s.race_id) || schedByRace.set(s.race_id, []).get(s.race_id)).push(s); }
    const windowByRace = new Map(raceIds.map((id) => [id, raceTimeWindow(schedByRace.get(id))]));
    const withWindow = (races || []).map((r) => ({ ...r, window: windowByRace.get(r.id) }));
    const { dayWindow } = resolveSeasonDay({ season, schedRows, dayParam: Number.parseInt(req.query.day, 10) });
    const cols = buildColumnSet({ races: withWindow, teamDivisionId: req.team.league_division_id, dayWindow })
      .filter((r) => r.status === "scheduled");
    if (!cols.length) return res.json({ ok: true, regenerated: 0 });

    // Afmeldte løb springes over.
    const { data: wRows } = await supabase.from("race_withdrawals").select("race_id").eq("team_id", req.team.id);
    const withdrawn = new Set((wRows || []).map((w) => w.race_id));
    const target = cols.filter((r) => !withdrawn.has(r.id));
    if (!target.length) return res.json({ ok: true, regenerated: 0 });

    // Holdets trup (abilities + fatigue).
    const { data: teamRiders } = await supabase.from("riders")
      .select("id").eq("team_id", req.team.id).eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false");
    const riderIds = (teamRiders || []).map((r) => r.id);
    const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
    const [{ data: abilities }, { data: conditions }] = await Promise.all([
      supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderIds),
      supabase.from("rider_condition").select("rider_id, fatigue").in("rider_id", riderIds),
    ]);
    const abById = new Map((abilities || []).map((a) => [a.rider_id, a]));
    const fatById = new Map((conditions || []).map((c) => [c.rider_id, c.fatigue]));
    const riders = riderIds.map((id) => ({ rider_id: id, abilities: abById.get(id), fatigue: fatById.get(id) ?? 0 })).filter((r) => r.abilities);

    // Etapeprofiler pr. mål-løb (autopick scorer på dem).
    const { data: profs } = await supabase.from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, demand_vector").in("race_id", target.map((r) => r.id));
    const stagesByRace = new Map();
    for (const p of profs || []) { (stagesByRace.get(p.race_id) || stagesByRace.set(p.race_id, []).get(p.race_id)).push(p); }
    for (const arr of stagesByRace.values()) arr.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

    // Lås manuelle entries i ANDRE løb (binding-bevidsthed).
    const { data: allEntries } = await supabase.from("race_entries")
      .select("race_id, rider_id, is_auto_filled").eq("team_id", req.team.id);
    const lockedWindows = lockedWindowsFromManualEntries({
      entries: allEntries || [], windowByRace, excludeRaceIds: new Set(target.map((r) => r.id)),
    });

    const assignRaces = target.map((r) => ({
      race_id: r.id, window: windowByRace.get(r.id), stages: stagesByRace.get(r.id) || [],
      sizeRule: selectionSizeForRace(r),
    }));
    const picksByRace = assignTeamAcrossRaces({ riders, races: assignRaces, lockedWindows });

    let regenerated = 0;
    for (const race of target) {
      const picks = picksByRace[race.id] || [];
      const captainId = picks.find((p) => p.race_role === "captain")?.rider_id ?? picks[0]?.rider_id ?? null;
      if (!picks.length || !captainId) continue;
      await saveSelectionAuto({ supabase, race, teamId: req.team.id, picks });
      regenerated++;
    }
    res.json({ ok: true, regenerated });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// Skriv assistent-picks (is_auto_filled=true) — delete-then-insert pr. løb.
async function saveSelectionAuto({ supabase, race, teamId, picks }) {
  await supabase.from("race_entries").delete().eq("race_id", race.id).eq("team_id", teamId);
  const rows = picks.map((p) => ({ race_id: race.id, rider_id: p.rider_id, team_id: teamId, race_role: p.race_role, is_auto_filled: true }));
  if (rows.length) await supabase.from("race_entries").insert(rows);
}
```

- [ ] **Step 6: Verify + commit**

Lokal smoke: manuelt rod et løb, kald regenerate?day=N → entries nulstilles til assistent-pick (`is_auto_filled=true`), GET /distribution viser nye picks. Manuelle entries i ikke-synlige overlappende løb forbliver urørt.

```bash
git add backend/routes/api.js backend/lib/raceDistribution.js backend/lib/raceDistribution.test.js
git commit -m "feat(race-hub): player-scoped regenerate endpoint (auto-udfyld igen)"
```

---

## Task 5: Pure frontend lib `raceHubLogic.js`

**Files:**
- Create: `frontend/src/lib/raceHubLogic.js`
- Test: `frontend/src/lib/raceHubLogic.test.js`

- [ ] **Step 1: Write failing test**

```js
// frontend/src/lib/raceHubLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeColumnStatus, isRiderBound, availableRiderIds } from "./raceHubLogic.js";

test("computeColumnStatus: full / understaffed / withdrawn", () => {
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 5, target: 7, withdrawn: false }), { kind: "understaffed", selected: 5, target: 7 });
  assert.deepEqual(computeColumnStatus({ selected: 0, target: 8, withdrawn: true }), { kind: "withdrawn", selected: 0, target: 8 });
});

test("isRiderBound: rytter bundet i et ANDET kolonne-løb end det aktuelle", () => {
  const bindingMap = { r1: ["a"], r2: ["b"] };
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "b" }), true);  // r1 er i a, bundet ift. b
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "a" }), false); // r1 ER a's egen
  assert.equal(isRiderBound({ bindingMap, riderId: "r9", forRaceId: "b" }), false);
});

test("availableRiderIds: trup minus allerede-udtagne minus bundne", () => {
  const roster = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
  const out = availableRiderIds({ roster, selectedIds: ["r1"], bindingMap: { r2: ["x"] }, forRaceId: "b" });
  assert.deepEqual(out, ["r3"]); // r1 udtaget, r2 bundet i x
});
```

- [ ] **Step 2: Run → fails**

Run: `cd frontend && node --test src/lib/raceHubLogic.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// frontend/src/lib/raceHubLogic.js
// Race Hub Fase 1: rene UI-helpers til trup-fordeling-board'et. Holder komponenterne
// thin + giver node --test-dækning. Ingen React, ingen I/O.

// Status-chip for en kolonne. withdrawn vinder; ellers full vs understaffed mod target.
export function computeColumnStatus({ selected, target, withdrawn }) {
  if (withdrawn) return { kind: "withdrawn", selected, target };
  if (selected >= target) return { kind: "full", selected, target };
  return { kind: "understaffed", selected, target };
}

// Er rytteren bundet væk fra `forRaceId` (udtaget i et ANDET overlappende kolonne-løb)?
export function isRiderBound({ bindingMap, riderId, forRaceId }) {
  const races = bindingMap?.[riderId];
  if (!races || !races.length) return false;
  return races.some((id) => id !== forRaceId);
}

// Ledige ryttere til at tilføje til `forRaceId`: i truppen, ikke allerede udtaget her,
// ikke bundet i et overlappende løb.
export function availableRiderIds({ roster = [], selectedIds = [], bindingMap = {}, forRaceId }) {
  const selected = new Set(selectedIds);
  return roster
    .map((r) => r.id)
    .filter((id) => !selected.has(id) && !isRiderBound({ bindingMap, riderId: id, forRaceId }));
}
```

- [ ] **Step 4: Run → passes + commit**

Run: `cd frontend && node --test src/lib/raceHubLogic.test.js` → PASS (3 tests).

```bash
git add frontend/src/lib/raceHubLogic.js frontend/src/lib/raceHubLogic.test.js
git commit -m "feat(race-hub): pure frontend logic — column status, binding, available riders"
```

---

## Task 6: i18n-nøgler (`racehub.*`)

**Files:**
- Modify: `frontend/public/locales/en/races.json`
- Modify: `frontend/public/locales/da/races.json`

- [ ] **Step 1: Add EN keys**

Tilføj et `racehub`-objekt i `en/races.json` (EN-først):

```json
"racehub": {
  "scope": { "mine": "My races", "division": "My division", "others": "Other divisions", "soon": "Coming soon" },
  "timeline": { "dayOf": "Day {{day}} of {{total}}", "youAreHere": "you are here", "prev": "Previous day", "next": "Next day" },
  "heading": "Squad distribution",
  "overlap": "{{count}} overlapping race today",
  "overlap_other": "{{count}} overlapping races today",
  "status": { "full": "{{selected}} / {{target}} selected", "understaffed": "{{selected}} / {{target}} · understaffed", "withdrawn": "Withdrawn" },
  "pool": { "title": "Available riders · {{count}}-squad", "autofill": "Auto-fill again", "bound": "Already racing in an overlapping race" },
  "column": { "add": "Add from available", "withdraw": "Withdraw", "reenter": "Re-enter" },
  "popover": { "title": "Add to which race?", "none": "No race available for this rider today" },
  "empty": "No races to plan for this day.",
  "regenerateWarn": "This resets your manual picks on today's races to the assistant's suggestion. Continue?"
}
```

- [ ] **Step 2: Add DA keys**

Samme struktur i `da/races.json` (DA-under):

```json
"racehub": {
  "scope": { "mine": "Mine løb", "division": "Min division", "others": "Andre divisioner", "soon": "Kommer snart" },
  "timeline": { "dayOf": "Dag {{day}} af {{total}}", "youAreHere": "du er her", "prev": "Forrige dag", "next": "Næste dag" },
  "heading": "Trup-fordeling",
  "overlap": "{{count}} overlappende løb i dag",
  "overlap_other": "{{count}} overlappende løb i dag",
  "status": { "full": "{{selected}} / {{target}} valgt", "understaffed": "{{selected}} / {{target}} · underbemandet", "withdrawn": "Afmeldt" },
  "pool": { "title": "Ledige ryttere · {{count}}-trup", "autofill": "Auto-udfyld igen", "bound": "Kører allerede et overlappende løb" },
  "column": { "add": "Tilføj fra ledige", "withdraw": "Afmeld", "reenter": "Deltag igen" },
  "popover": { "title": "Tilføj til hvilket løb?", "none": "Intet løb tilgængeligt for denne rytter i dag" },
  "empty": "Ingen løb at planlægge denne dag.",
  "regenerateWarn": "Dette nulstiller dine manuelle valg på dagens løb til assistentens forslag. Fortsæt?"
}
```

- [ ] **Step 3: Verify JSON + commit**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('public/locales/en/races.json')); JSON.parse(require('fs').readFileSync('public/locales/da/races.json')); console.log('ok')"`
Expected: `ok`

```bash
git add frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git commit -m "feat(race-hub): i18n keys for distribution board (en+da)"
```

---

## Task 7: `ContextBand.jsx` (scope-pills + sæson-tidslinje)

**Files:**
- Create: `frontend/src/components/racehub/ContextBand.jsx`

- [ ] **Step 1: Implement component**

Scope-pills (kun "mine" aktiv; "division"/"others" deaktiveret m. "soon"-titel) + tidslinje (segmenter pr. dag, "du er her"-markør i guld, klik → `onDayChange`). Skriver intet til URL selv — `RaceHubBoard` ejer URL-params og sender `day`/`scope` + callbacks ned.

```jsx
import { useTranslation } from "react-i18next";

export default function ContextBand({ scope, day, timeline, onScopeChange, onDayChange }) {
  const { t } = useTranslation("races");
  const total = timeline?.totalDays ?? 60;
  const days = timeline?.days ?? [];
  const scopes = [
    { key: "mine", enabled: true },
    { key: "division", enabled: false },
    { key: "others", enabled: false },
  ];
  return (
    <div className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3 mb-4">
      <div className="flex gap-2 mb-3" role="tablist" aria-label={t("racehub.heading")}>
        {scopes.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={!s.enabled}
            title={s.enabled ? undefined : t("racehub.scope.soon")}
            onClick={() => s.enabled && onScopeChange(s.key)}
            className={`text-xs uppercase tracking-wide px-3 py-1.5 rounded-full border transition-colors ${
              scope === s.key
                ? "bg-cz-accent text-cz-on-accent border-cz-accent"
                : s.enabled
                ? "border-cz-border text-cz-2 hover:bg-cz-card"
                : "border-cz-border text-cz-3 opacity-50 cursor-not-allowed"
            }`}
          >
            {t(`racehub.scope.${s.key}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("racehub.timeline.prev")} disabled={day <= 1}
          onClick={() => onDayChange(day - 1)} className="text-cz-3 hover:text-cz-1 disabled:opacity-30">‹</button>
        <div className="flex gap-px flex-1" role="group" aria-label={t("racehub.timeline.dayOf", { day, total })}>
          {days.map((d) => (
            <button
              key={d.day}
              type="button"
              title={d.dateText || `Day ${d.day}`}
              aria-current={d.day === day ? "true" : undefined}
              onClick={() => onDayChange(d.day)}
              className={`flex-1 h-4 rounded-sm transition-colors ${
                d.day === day ? "bg-cz-accent" : d.hasMyRace ? "bg-cz-card hover:bg-cz-elevated" : "bg-cz-card/40 hover:bg-cz-card"
              }`}
            />
          ))}
        </div>
        <button type="button" aria-label={t("racehub.timeline.next")} disabled={day >= total}
          onClick={() => onDayChange(day + 1)} className="text-cz-3 hover:text-cz-1 disabled:opacity-30">›</button>
      </div>
      <div className="flex justify-end mt-1.5">
        <span className="text-xs text-cz-accent-t font-medium">{t("racehub.timeline.dayOf", { day, total })} — {t("racehub.timeline.youAreHere")}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/racehub/ContextBand.jsx
git commit -m "feat(race-hub): ContextBand — scope pills + season timeline"
```

---

## Task 8: `RaceColumn.jsx` + `AddRiderPopover.jsx`

**Files:**
- Create: `frontend/src/components/racehub/RaceColumn.jsx`
- Create: `frontend/src/components/racehub/AddRiderPopover.jsx`

- [ ] **Step 1: AddRiderPopover**

Liste af dagens kolonne-løb hvor rytteren IKKE er bundet (genbruger `isRiderBound`). Vælg → `onPick(raceId)`.

```jsx
import { useTranslation } from "react-i18next";
import { isRiderBound } from "../../lib/raceHubLogic.js";

export default function AddRiderPopover({ rider, columns, bindingMap, onPick, onClose }) {
  const { t } = useTranslation("races");
  const targets = columns.filter(
    (c) => !c.withdrawn && !isRiderBound({ bindingMap, riderId: rider.id, forRaceId: c.id }) &&
      !(c.selection?.rider_ids || []).includes(rider.id)
  );
  return (
    <div className="absolute z-dropdown mt-1 bg-cz-elevated border border-cz-border rounded-cz shadow-cz p-2 min-w-[200px]">
      <p className="text-xs text-cz-3 px-2 py-1">{t("racehub.popover.title")}</p>
      {targets.length === 0 && <p className="text-xs text-cz-3 px-2 py-1.5">{t("racehub.popover.none")}</p>}
      {targets.map((c) => (
        <button key={c.id} type="button" onClick={() => { onPick(c.id); onClose(); }}
          className="block w-full text-left text-sm text-cz-1 px-2 py-1.5 rounded hover:bg-cz-subtle">
          {c.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: RaceColumn**

Header (navn/klasse/type/tid/terræn) + status-chip (`computeColumnStatus`) + udtagne ryttere (rolle-tag + friskhed, tap → fjern) + "+ tilføj" + afmeld/deltag.

```jsx
import { useTranslation } from "react-i18next";
import { computeColumnStatus } from "../../lib/raceHubLogic.js";

const STATUS_CLASS = {
  full: "bg-cz-success-bg text-cz-success border-cz-success/30",
  understaffed: "bg-cz-warning-bg text-cz-warning border-cz-warning/40",
  withdrawn: "bg-cz-subtle text-cz-3 border-cz-border",
};

export default function RaceColumn({ column, onRemoveRider, onAddClick, onToggleWithdraw, busy }) {
  const { t } = useTranslation("races");
  const selectedIds = column.selection?.rider_ids || [];
  const ridersById = new Map(column.riders.map((r) => [r.id, r]));
  const roleOf = (id) => {
    const s = column.selection;
    if (!s) return null;
    if (id === s.captain_id) return "captain";
    if (id === s.sprint_captain_id) return "sprintCaptain";
    if (id === s.hunter_id) return "hunter";
    return null;
  };
  const status = computeColumnStatus({ selected: column.counts.selected, target: column.counts.target, withdrawn: column.withdrawn });
  return (
    <div className="border border-cz-border rounded-cz bg-cz-card flex flex-col">
      <div className="p-3 border-b border-cz-border">
        <p className="text-sm font-semibold text-cz-1">{column.name}</p>
        <p className="text-[11px] text-cz-3 mt-0.5">
          {column.race_type === "stage_race" ? t("raceType.stages", { count: column.stages }) : t("raceType.oneDay")} · {t(`classOption.${column.race_class}`)}
        </p>
        <span className={`inline-block mt-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASS[status.kind]}`}>
          {t(`racehub.status.${status.kind}`, { selected: status.selected, target: status.target })}
        </span>
      </div>
      {!column.withdrawn && (
        <div className="py-1 flex-1">
          {selectedIds.map((id) => {
            const r = ridersById.get(id);
            if (!r) return null;
            const role = roleOf(id);
            return (
              <button key={id} type="button" onClick={() => onRemoveRider(column.id, id)} disabled={busy}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-cz-subtle disabled:opacity-50">
                <span className="text-xs text-cz-1">
                  {r.name}
                  {role && <span className="text-[9px] uppercase text-cz-accent-t border border-cz-accent/40 px-1.5 py-px rounded ml-1.5">{t(`selection.${role}`)}</span>}
                </span>
                <span className={`text-[11px] font-mono ${r.fatigue > 50 ? "text-cz-warning" : "text-cz-3"}`}>{r.form ?? "—"}</span>
              </button>
            );
          })}
          {selectedIds.length === 0 && <p className="text-xs text-cz-3 px-3 py-2">{t("racehub.status.understaffed", { selected: 0, target: column.counts.target })}</p>}
        </div>
      )}
      <div className="p-2 border-t border-cz-border flex items-center justify-between">
        {!column.withdrawn && (
          <button type="button" onClick={() => onAddClick(column.id)} disabled={busy}
            className="text-xs text-cz-accent-t hover:underline disabled:opacity-50">+ {t("racehub.column.add")}</button>
        )}
        <button type="button" onClick={() => onToggleWithdraw(column.id, !column.withdrawn)} disabled={busy}
          className="text-xs text-cz-3 hover:text-cz-1 disabled:opacity-50 ml-auto">
          {column.withdrawn ? t("racehub.column.reenter") : t("racehub.column.withdraw")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/racehub/RaceColumn.jsx frontend/src/components/racehub/AddRiderPopover.jsx
git commit -m "feat(race-hub): RaceColumn + AddRiderPopover"
```

---

## Task 9: `AvailableRidersPool.jsx`

**Files:**
- Create: `frontend/src/components/racehub/AvailableRidersPool.jsx`

- [ ] **Step 1: Implement**

12-truppen som chips. Bundne ryttere (i et hvilket-som-helst kolonne-løb) grånet + lås. Klik en ledig chip → åbn `AddRiderPopover` for den rytter. "Auto-udfyld igen"-knap.

```jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddRiderPopover from "./AddRiderPopover.jsx";

export default function AvailableRidersPool({ roster, columns, bindingMap, onAddRiderToRace, onRegenerate, busy }) {
  const { t } = useTranslation("races");
  const [openRiderId, setOpenRiderId] = useState(null);
  const selectedAnywhere = new Set(columns.flatMap((c) => c.selection?.rider_ids || []));
  const isBound = (id) => Array.isArray(bindingMap?.[id]) && bindingMap[id].length > 0;
  return (
    <div className="border border-cz-border rounded-cz bg-cz-subtle">
      <div className="px-3 py-2 border-b border-cz-border flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-cz-2">{t("racehub.pool.title", { count: roster.length })}</span>
        <button type="button" onClick={onRegenerate} disabled={busy}
          className="text-xs text-cz-accent-t hover:underline disabled:opacity-50">{t("racehub.pool.autofill")}</button>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {roster.map((r) => {
          const placed = selectedAnywhere.has(r.id);
          const bound = isBound(r.id) && !placed;
          if (placed) return null;
          return (
            <div key={r.id} className="relative">
              <button type="button" disabled={bound || busy}
                title={bound ? t("racehub.pool.bound") : undefined}
                onClick={() => setOpenRiderId(openRiderId === r.id ? null : r.id)}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  bound ? "border-dashed border-cz-border text-cz-3 opacity-50 cursor-not-allowed" : "border-cz-border bg-cz-card text-cz-1 hover:border-cz-accent/40"
                }`}>
                {bound && <span aria-hidden="true">🔒 </span>}{r.name} <span className="font-mono text-cz-3">{r.form ?? "—"}</span>
              </button>
              {openRiderId === r.id && !bound && (
                <AddRiderPopover rider={r} columns={columns} bindingMap={bindingMap}
                  onPick={(raceId) => onAddRiderToRace(raceId, r.id)} onClose={() => setOpenRiderId(null)} />
              )}
            </div>
          );
        })}
      </div>
      <p className="px-3 pb-2 text-[10px] text-cz-3">{t("racehub.pool.bound")}</p>
    </div>
  );
}
```

> **Anti-AI-slop note:** lås-glyffen ovenfor er en emoji-placeholder. Erstat med et inline-SVG-lås-ikon (matcher kodebasens ikon-mønster — se `frontend/src/components/*Icon*`/Flag-mønstret) FØR commit; ingen emoji-ikoner i player-facing UI (memory: anti-ai-slop).

- [ ] **Step 2: Replace emoji with SVG lock icon, then commit**

Find kodebasens ikon-konvention (`Grep "function .*Icon" frontend/src/components`) og brug et inline-SVG-lås-ikon i stedet for `🔒`.

```bash
git add frontend/src/components/racehub/AvailableRidersPool.jsx
git commit -m "feat(race-hub): AvailableRidersPool with binding grayout + auto-fill"
```

---

## Task 10: `RaceHubBoard.jsx` orkestrator + mount i RacesPage

**Files:**
- Create: `frontend/src/components/racehub/RaceHubBoard.jsx`
- Modify: `frontend/src/pages/RacesPage.jsx`

- [ ] **Step 1: Implement RaceHubBoard**

Fetch `GET /api/races/distribution?day=N`, hold state, ejer URL-params (`day`, `scope` via `useSearchParams`). Saves via `PUT /selection` (genbrug `authHeaders`-mønstret fra `RaceSelectionPanel.jsx`). Add/remove rider → byg ny rider_ids-liste + PUT → refetch. Afmeld → POST/DELETE withdrawal → refetch. Auto-udfyld → confirm (hvis manuelle valg) → POST regenerate → refetch.

```jsx
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSession } from "../../lib/supabase";
import ContextBand from "./ContextBand.jsx";
import RaceColumn from "./RaceColumn.jsx";
import AvailableRidersPool from "./AvailableRidersPool.jsx";
import { Spinner, EmptyState, FlagIcon } from "../ui";

const API = import.meta.env.VITE_API_URL;
async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

export default function RaceHubBoard() {
  const { t } = useTranslation("races");
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") || "mine";
  const dayParam = Number.parseInt(params.get("day"), 10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (day) => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    const qs = Number.isFinite(day) ? `?day=${day}` : "";
    const res = await fetch(`${API}/api/races/distribution${qs}`, { headers });
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(Number.isFinite(dayParam) ? dayParam : undefined); }, [load, dayParam]);

  if (loading) return <div className="flex justify-center py-10"><Spinner size={20} /></div>;
  if (!data?.enabled) return null; // flag OFF → board skjult (kalender-faner viser stadig)
  const day = Number.isFinite(dayParam) ? dayParam : data.currentDay;
  const columns = data.columns || [];
  const roster = columns[0]?.riders || [];

  const setDay = (d) => { params.set("day", String(d)); setParams(params, { replace: true }); };
  const setScope = (s) => { params.set("scope", s); setParams(params, { replace: true }); };

  async function putSelection(column, riderIds) {
    const headers = await authHeaders();
    if (!headers) return;
    const sel = column.selection || {};
    const body = {
      rider_ids: riderIds,
      captain_id: riderIds.includes(sel.captain_id) ? sel.captain_id : riderIds[0] ?? null,
      sprint_captain_id: riderIds.includes(sel.sprint_captain_id) ? sel.sprint_captain_id : null,
      hunter_id: riderIds.includes(sel.hunter_id) ? sel.hunter_id : null,
    };
    setBusy(true);
    await fetch(`${API}/api/races/${column.id}/selection`, { method: "PUT", headers, body: JSON.stringify(body) });
    await load(day);
    setBusy(false);
  }
  const addRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId); if (!col) return;
    putSelection(col, [...(col.selection?.rider_ids || []), riderId]);
  };
  const removeRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId); if (!col) return;
    putSelection(col, (col.selection?.rider_ids || []).filter((id) => id !== riderId));
  };
  async function toggleWithdraw(raceId, withdraw) {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true);
    await fetch(`${API}/api/races/${raceId}/withdrawal`, { method: withdraw ? "POST" : "DELETE", headers });
    await load(day); setBusy(false);
  }
  async function regenerate() {
    const hasManual = columns.some((c) => c.selection && c.selection.is_auto_filled === false);
    if (hasManual && !window.confirm(t("racehub.regenerateWarn"))) return;
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true);
    await fetch(`${API}/api/races/distribution/regenerate?day=${day}`, { method: "POST", headers });
    await load(day); setBusy(false);
  }

  return (
    <div>
      <ContextBand scope={scope} day={day} timeline={data.timeline} onScopeChange={setScope} onDayChange={setDay} />
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-bold text-cz-1">{t("racehub.heading")}</h2>
        <span className="text-xs text-cz-3">{t("racehub.overlap", { count: columns.length })}</span>
      </div>
      {columns.length === 0 ? (
        <EmptyState icon={<FlagIcon size={24} />} title={t("racehub.empty")} />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {columns.map((c) => (
              <RaceColumn key={c.id} column={c} busy={busy}
                onRemoveRider={removeRider} onAddClick={() => {}} onToggleWithdraw={toggleWithdraw} />
            ))}
          </div>
          <AvailableRidersPool roster={roster} columns={columns} bindingMap={data.bindingMap || {}}
            onAddRiderToRace={addRider} onRegenerate={regenerate} busy={busy} />
        </>
      )}
    </div>
  );
}
```

> Note: `onAddClick` på kolonnen er en no-op her — tilføjelse sker fra puljen via popover (klik-modellen). "+ tilføj fra ledige" i kolonnen scroller/fremhæver puljen; implementér som `document.getElementById`-scroll eller drop knappen hvis den dublerer puljen. Afklar i review; behold puljen som primær add-vej.

- [ ] **Step 2: Mount in RacesPage**

I `RacesPage.jsx`: importér `RaceHubBoard`, og i `calendar`-tabben render `<RaceHubBoard/>` ØVERST (afløser "upcoming"-sektionen i venstre kolonne; behold "completed"-listen + resultat-panelet). Konkret: erstat `racesByStatus.upcoming`-blokken (linje ~250-288) med `<RaceHubBoard />`; behold completed-blokken.

- [ ] **Step 3: Verify build + lint**

Run: `cd frontend && node --test src/lib/*.test.js && npm run build && npm run lint`
Expected: tests PASS, build OK, lint clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/racehub/RaceHubBoard.jsx frontend/src/pages/RacesPage.jsx
git commit -m "feat(race-hub): RaceHubBoard orchestrator mounted on /races"
```

---

## Task 11: Playwright e2e + snapshot refresh

**Files:**
- Create: `frontend/tests/e2e/race-distribution.spec.js`
- Modify: snapshots (genereres) hvis core-smoke rører board'et

Følg mock-mønstret i `frontend/tests/e2e/race-selection.spec.js` + `frontend/tests/e2e/fixtures.js` (mocker hele Supabase + backend-fetch). Mock `**/api/races/distribution**` → en fixture med 2 overlappende løb, 12-trup, en binding-map-post.

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from "@playwright/test";
import { setupMockedSession } from "./fixtures.js"; // brug det navn fixtures.js faktisk eksporterer

test("squad distribution board shows overlapping races + bound rider locked", async ({ page }) => {
  await setupMockedSession(page, {
    routes: {
      "**/api/races/distribution**": {
        enabled: true, currentDay: 24, season: { id: "s1", number: 1 },
        timeline: { totalDays: 60, currentDay: 24, days: Array.from({ length: 60 }, (_, i) => ({ day: i + 1, dateText: null, terrain: "flat", hasMyRace: i === 23 })) },
        columns: [
          { id: "a", name: "Hamburger Klassiker", race_class: "ProSeries", race_type: "single", stages: 1, status: "scheduled", window: { start: 1, end: 1 }, size: { min: 6, max: 6 }, withdrawn: false, counts: { selected: 1, target: 6 }, riders: [{ id: "r1", name: "M. Dolan", form: 4, fatigue: 10 }, { id: "r2", name: "A. Ruiz", form: 3, fatigue: 5 }], selection: { rider_ids: ["r1"], captain_id: "r1", is_auto_filled: true } },
          { id: "b", name: "La Corsa", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 7, status: "scheduled", window: { start: 1, end: 1 }, size: { min: 8, max: 8 }, withdrawn: false, counts: { selected: 0, target: 8 }, riders: [{ id: "r1", name: "M. Dolan", form: 4, fatigue: 10 }, { id: "r2", name: "A. Ruiz", form: 3, fatigue: 5 }], selection: null },
        ],
        bindingMap: { r1: ["a"] },
      },
    },
  });
  await page.goto("/races");
  await expect(page.getByText("Hamburger Klassiker")).toBeVisible();
  await expect(page.getByText("La Corsa")).toBeVisible();
  // r1 er bundet i a → vises låst i puljen (ikke klikbar for b)
  await expect(page.getByText("M. Dolan").last()).toBeVisible();
});
```

(Tilpas `setupMockedSession`-signaturen til fixtures.js's faktiske API — læs filen først.)

- [ ] **Step 2: Run e2e**

Run: `cd frontend && npx playwright test race-distribution.spec.js`
Expected: PASS. Hvis core-smoke-snapshots ændrer sig (board nu på /races): `npx playwright test core-smoke --update-snapshots` (alle 3 projekter, win32) + commit PNG'erne.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/e2e/race-distribution.spec.js frontend/tests/e2e/__snapshots__ 2>/dev/null || git add frontend/tests/e2e/race-distribution.spec.js
git commit -m "test(race-hub): e2e for distribution board + snapshot refresh"
```

---

## Task 12: Patch notes + help + close-out docs

**Files:**
- Modify: patch-notes-kilden (`frontend/src/data/patchNotes.js` eller `PatchNotesPage.jsx` — tjek hvilken er kilden)
- Modify: `frontend/public/locales/en/help.json` + `da/help.json`
- Modify: `docs/NOW.md`, `docs/FEATURE_STATUS.md`

- [ ] **Step 1: Patch note**

Tilføj en patch-note (EN-først, DA-under, ingen em-dash): ny "Squad distribution" / "Trup-fordeling"-flade på Løb-siden — se og fordel din trup på tværs af overlappende løb, afmeld løb du springer over, lad assistenten udfylde igen. Refs #1802.

- [ ] **Step 2: Help/FAQ**

Ny `help.json`-post (en+da): hvordan trup-fordeling + overlap virker (én rytter/ét løb, afmeld, auto-udfyld).

- [ ] **Step 3: NOW.md + FEATURE_STATUS.md**

NOW.md 🎯 Next action → "Fase 2 (Lag 0 Holdstrategi)". FEATURE_STATUS.md: Race Hub Fase 1 = shipped.

- [ ] **Step 4: Full CI-gate + commit**

Run: `pwsh -File scripts/verify-local.ps1` + `cd frontend && npm run lint` + i18n-leak/tone/warning-budget-checks.

```bash
git add -A
git commit -m "docs(race-hub): patch notes + help + close-out for Fase 1 distribution board"
```

---

## Self-Review (udført ved plan-skrivning)

- **Spec-dækning:** §4 routing → Task 10; §5 komponenter → Task 7-10; §6.1 aggregat → Task 1-2; §6.2 afmeld → Task 3; §6.3 regenerate → Task 4; §7 i18n → Task 6; §8 test → Task 1/5/11; patch/help → Task 12. Scope-pills deaktiveret (division/others) → Task 7. ✓
- **Bug-folding:** #1802 leveres af board'et (per-race PUT, ingen overskrivning) → Task 10. #1800/#1801 eksplicit ude. ✓
- **Type-konsistens:** `bindingMap` = `{rider_id: [race_id]}` overalt (Task 1, 5, 8-10); `column.counts {selected,target}` (Task 2, 5, 8); `selection {rider_ids, captain_id, ...}` (Task 2, 8, 10). ✓
- **Kendte løse ender (afklares i review/eksekvering):** (a) `onAddClick`-kolonneknap er no-op — add sker via pulje-popover; overvej at droppe knappen. (b) Lås-ikon = SVG, ikke emoji (Task 9 note). (c) fixtures.js's eksakte export-navn læses før e2e (Task 11). (d) PostgREST 1000-cap: aggregat-endpointet bruger `.slice(0,1000)` på raceIds — sæson har < 1000 løb (verificeret: ~89 løb), så cap rammes ikke; hvis sæson-løb > 1000 senere, paginer (memory: postgrest-1000-cap).
