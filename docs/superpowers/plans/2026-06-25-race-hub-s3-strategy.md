# Race Hub S3 — Fase 2 Holdstrategi (Lag 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygge Holdstrategi-laget (rangordnet A-kæde, faste rolle-regler, kaptajn 1/2/3 pr. terræn, mål-løb) som et deterministisk præference-lag der fodrer den proaktive entry-generator, plus en `/races/strategy`-flade med live preview-diff.

**Architecture:** Strategi er rene præference-data der flyder ind i `autopickTeamSelection` via `assignTeamAcrossRaces`. `preference==null`/`strategy==null` giver byte-identisk nuværende adfærd (idempotens-garanti). To nye tabeller (service_role-write, eget-team-read). Begge generator-veje (bulk + regenerate) loader strategi via én delt loader. Frontend-side i `/races/strategy` med ren logik i `strategyLogic.js`.

**Tech Stack:** Node.js (backend, `node --test`), Express (`backend/routes/api.js`), Supabase/Postgres (RLS-migration), React + Vite + react-i18next (frontend), Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-06-25-race-hub-s3-strategy-design.md`

---

## File Structure

**Backend — create:**
- `backend/lib/raceTerrain.js` — `terrainBucket(profileType)` + `raceTerrainBucket(stages)` (pure)
- `backend/lib/raceTerrain.test.js`
- `backend/lib/raceStrategy.js` — `normalizeStrategy`, `loadTeamStrategy`, `loadStrategiesForTeams`, `bucketSuitabilities`, `diffAssignments` (pure + thin I/O)
- `backend/lib/raceStrategy.test.js`

**Backend — modify:**
- `backend/lib/raceAutopick.js` — `autopickTeamSelection` får `preference`-param
- `backend/lib/raceAutopick.test.js` (create if missing)
- `backend/lib/raceEntryGenerator.js` — `assignTeamAcrossRaces` får `strategy`-param; `runRaceEntryGenerator` loader strategier
- `backend/lib/raceEntryGenerator.test.js` — nye strategi+idempotens-tests
- `backend/routes/api.js` — regenerate loader strategi; 3 nye endpoints (GET/PUT/POST strategy)

**Database — create (EJER MERGER):**
- `database/2026-06-25-team-race-strategy.sql`

**Frontend — create:**
- `frontend/src/lib/strategyLogic.js` + `.test.js` — ranking-ops, auto-foreslå, diff-formatering
- `frontend/src/pages/StrategyPage.jsx`
- `frontend/src/components/racehub/strategy/AChainEditor.jsx`
- `frontend/src/components/racehub/strategy/RoleRulesEditor.jsx`
- `frontend/src/components/racehub/strategy/CaptainBoard.jsx`
- `frontend/src/components/racehub/strategy/TargetRacePicker.jsx`
- `frontend/src/components/racehub/strategy/PreviewDiff.jsx`

**Frontend — modify:**
- `frontend/src/App.jsx` — lazy import + `<Route path="races/strategy">`
- `frontend/src/components/racehub/RaceHubBoard.jsx` — link til strategi-fladen
- `frontend/public/locales/en/races.json` + `da/races.json` — strategi-keys + nye fejlkoder
- `frontend/public/locales/en/help.json` + `da/help.json` — Holdstrategi-hjælp
- `frontend/src/data/patchNotes.js` — patch-note
- `docs/FEATURE_STATUS.md`

---

## Phase A — Delt terræn + autopick-præference (pure)

### Task 1: terrainBucket + raceTerrainBucket

**Files:**
- Create: `backend/lib/raceTerrain.js`
- Test: `backend/lib/raceTerrain.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/lib/raceTerrain.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { terrainBucket, raceTerrainBucket, TERRAIN_BUCKETS } from "./raceTerrain.js";

test("terrainBucket: 9 profiltyper → 5 buckets (locks L3)", () => {
  assert.equal(terrainBucket("flat"), "flat");
  assert.equal(terrainBucket("rolling"), "flat");
  assert.equal(terrainBucket("hilly"), "hilly");
  assert.equal(terrainBucket("classic"), "hilly");
  assert.equal(terrainBucket("mountain"), "mountain");
  assert.equal(terrainBucket("high_mountain"), "mountain");
  assert.equal(terrainBucket("cobbles"), "cobbles");
  assert.equal(terrainBucket("itt"), "itt");
  assert.equal(terrainBucket("ttt"), "itt");
});

test("terrainBucket: ukendt/null → flat (defensiv default)", () => {
  assert.equal(terrainBucket("nonsense"), "flat");
  assert.equal(terrainBucket(null), "flat");
  assert.equal(terrainBucket(undefined), "flat");
});

test("TERRAIN_BUCKETS er de 5 forventede i stabil rækkefølge", () => {
  assert.deepEqual(TERRAIN_BUCKETS, ["flat", "hilly", "mountain", "cobbles", "itt"]);
});

test("raceTerrainBucket: endagsløb → dets profils bucket", () => {
  assert.equal(raceTerrainBucket([{ profile_type: "cobbles" }]), "cobbles");
});

test("raceTerrainBucket: etapeløb → dominerende bucket over GC-etaper (flade ekskluderes)", () => {
  // 3 flade + 2 bjerg → GC-etaper er de 2 bjerg → mountain.
  const stages = [
    { profile_type: "flat" }, { profile_type: "flat" }, { profile_type: "flat" },
    { profile_type: "mountain" }, { profile_type: "high_mountain" },
  ];
  assert.equal(raceTerrainBucket(stages), "mountain");
});

test("raceTerrainBucket: kun flade etaper → flat (fallback til alle)", () => {
  assert.equal(raceTerrainBucket([{ profile_type: "flat" }, { profile_type: "rolling" }]), "flat");
});

test("raceTerrainBucket: tom/ugyldig → flat", () => {
  assert.equal(raceTerrainBucket([]), "flat");
  assert.equal(raceTerrainBucket(null), "flat");
});

test("raceTerrainBucket: tie brydes stabilt efter TERRAIN_BUCKETS-index", () => {
  // 1 hilly (GC) + 1 mountain (GC) → tie; hilly har lavere index → hilly.
  assert.equal(raceTerrainBucket([{ profile_type: "hilly" }, { profile_type: "mountain" }]), "hilly");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceTerrain.test.js`
Expected: FAIL — `Cannot find module './raceTerrain.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// backend/lib/raceTerrain.js
// Race Hub S3: terræn-buckets. De 9 stage-profiltyper (race_stage_profiles CHECK)
// mappes til 5 strategi-buckets som kaptajn-prioriteter er rangordnet pr. (L3).
// Pure — ingen DB. Genbruges senere i S4/S5 (terræn-DNA, rolle-hints).

export const TERRAIN_BUCKETS = Object.freeze(["flat", "hilly", "mountain", "cobbles", "itt"]);

const PROFILE_TO_BUCKET = Object.freeze({
  flat: "flat", rolling: "flat",
  hilly: "hilly", classic: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  cobbles: "cobbles",
  itt: "itt", ttt: "itt",
});

// Ukendt/null → "flat" (defensiv: et løb uden kendt profil behandles som fladt).
export function terrainBucket(profileType) {
  return PROFILE_TO_BUCKET[profileType] ?? "flat";
}

const FLAT_PROFILES = new Set(["flat", "rolling"]);

// Ét løbs repræsentative bucket = dominerende bucket over GC-etaperne (ikke-flade
// hvis nogen findes, ellers alle — spejler raceAutopick.gcStages). Tie → laveste
// TERRAIN_BUCKETS-index (stabil/deterministisk). Tom → "flat".
export function raceTerrainBucket(stages) {
  if (!stages?.length) return "flat";
  const nonFlat = stages.filter((s) => !FLAT_PROFILES.has(s.profile_type));
  const relevant = nonFlat.length ? nonFlat : stages;
  const counts = new Map();
  for (const s of relevant) {
    const b = terrainBucket(s.profile_type);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  let best = "flat";
  let bestCount = -1;
  for (const b of TERRAIN_BUCKETS) {
    const c = counts.get(b) || 0;
    if (c > bestCount) { best = b; bestCount = c; }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test lib/raceTerrain.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceTerrain.js backend/lib/raceTerrain.test.js
git commit -F .git-commit-msg.tmp   # message: "feat(race-hub): terrainBucket — 9 profiltyper → 5 strategi-buckets (S3)"
```

---

### Task 2: autopickTeamSelection — preference-param

**Files:**
- Modify: `backend/lib/raceAutopick.js:54-97`
- Test: `backend/lib/raceAutopick.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// backend/lib/raceAutopick.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { autopickTeamSelection } from "./raceAutopick.js";

const ab = (v, over = {}) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
  flat: v, tempo: v, durability: v, aggression: v, descending: v, ...over,
});
const flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const mtn = { profile_type: "mountain", demand_vector: { climbing: 0.9, endurance: 0.1, randomness: 0.5 } };
// r0 stærkest → r5 svagest.
const riders = Array.from({ length: 6 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 10), fatigue: 0 }));
const size = { min: 3, max: 3 };

test("preference=null ≡ ingen preference (idempotens)", () => {
  const a = autopickTeamSelection({ riders, stages: [flat], sizeRule: size });
  const b = autopickTeamSelection({ riders, stages: [flat], sizeRule: size, preference: null });
  assert.deepEqual(a, b);
});

test("mål-løb: A-kæde sorteres FØRST (rang), uanset score (Fork A)", () => {
  // r4,r5 er svagest, men A-kæde-rang 0,1 → de skal med på mål-løbet.
  const preference = { aChain: ["r5", "r4"], captains: [], roleRules: {}, isTargetRace: true };
  const picks = autopickTeamSelection({ riders, stages: [flat], sizeRule: size, preference });
  const ids = picks.map((p) => p.rider_id);
  assert.ok(ids.includes("r5") && ids.includes("r4"), "A-kæde-ryttere udtaget på mål-løb");
});

test("ikke-mål-løb: A-kæde giver INGEN boost (score-rækkefølge uændret)", () => {
  const preference = { aChain: ["r5", "r4"], captains: [], roleRules: {}, isTargetRace: false };
  const withPref = autopickTeamSelection({ riders, stages: [flat], sizeRule: size, preference });
  const noPref = autopickTeamSelection({ riders, stages: [flat], sizeRule: size });
  assert.deepEqual(withPref, noPref, "ikke-mål-løb uændret af A-kæde");
});

test("rolle-regel always_captain vinder over score-baseret kaptajn", () => {
  const preference = { aChain: [], captains: [], roleRules: { r2: "always_captain" }, isTargetRace: false };
  const picks = autopickTeamSelection({ riders, stages: [mtn], sizeRule: size, preference });
  // r2 er udtaget (top-3 på score) og skal være kaptajn pga. fast regel.
  const captain = picks.find((p) => p.race_role === "captain");
  assert.equal(captain?.rider_id, "r2");
});

test("kaptajn-prioritet pr. terræn: første i listen der er udtaget bliver kaptajn", () => {
  // r9 ikke i trup → springes; r1 er i top-3 → kaptajn.
  const preference = { aChain: [], captains: ["r9", "r1"], roleRules: {}, isTargetRace: false };
  const picks = autopickTeamSelection({ riders, stages: [mtn], sizeRule: size, preference });
  assert.equal(picks.find((p) => p.race_role === "captain")?.rider_id, "r1");
});

test("kaptajn-fallback: ingen regel/prioritet matcher → GC-kaptajn (uændret)", () => {
  const preference = { aChain: [], captains: ["r9"], roleRules: {}, isTargetRace: false };
  const withPref = autopickTeamSelection({ riders, stages: [mtn], sizeRule: size, preference });
  const noPref = autopickTeamSelection({ riders, stages: [mtn], sizeRule: size });
  assert.equal(
    withPref.find((p) => p.race_role === "captain")?.rider_id,
    noPref.find((p) => p.race_role === "captain")?.rider_id
  );
});

test("always_sprint_captain_if_present: udtaget + ikke kaptajn → sprint_captain", () => {
  const preference = { aChain: [], captains: ["r0"], roleRules: { r1: "always_sprint_captain_if_present" }, isTargetRace: false };
  const picks = autopickTeamSelection({ riders, stages: [flat], sizeRule: size, preference });
  assert.equal(picks.find((p) => p.race_role === "sprint_captain")?.rider_id, "r1");
});

test("stale A-kæde-id (ikke i trup) ignoreres tavst", () => {
  const preference = { aChain: ["ghost", "r0"], captains: [], roleRules: {}, isTargetRace: true };
  const picks = autopickTeamSelection({ riders, stages: [flat], sizeRule: size, preference });
  assert.ok(!picks.some((p) => p.rider_id === "ghost"));
  assert.ok(picks.some((p) => p.rider_id === "r0"));
});

test("determinisme: to kørsler med samme input giver identisk output", () => {
  const preference = { aChain: ["r3", "r1"], captains: ["r1"], roleRules: { r2: "always_captain" }, isTargetRace: true };
  const a = autopickTeamSelection({ riders, stages: [mtn], sizeRule: size, preference });
  const b = autopickTeamSelection({ riders, stages: [mtn], sizeRule: size, preference });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceAutopick.test.js`
Expected: FAIL — preference ignoreres (always_captain-test fejler bl.a.)

- [ ] **Step 3: Write minimal implementation**

Modify `backend/lib/raceAutopick.js`. Add helper imports/usage and the preference branches. Replace the body of `autopickTeamSelection` (lines 54-97) with:

```js
export function autopickTeamSelection({ riders = [], stages = [], sizeRule, preference = null }) {
  const rule = sizeRule || SELECTION_SIZE.default;

  const scored = riders
    .filter((r) => r?.rider_id && r.abilities)
    .map((r) => {
      const raw = Number(r.fatigue);
      const clampedFatigue = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) / 100 : 0;
      const freshness = 1 - clampedFatigue * AUTOPICK_FATIGUE_DAMPING;
      return { rider_id: r.rider_id, abilities: r.abilities, score: suitabilityScore(r.abilities, stages) * freshness };
    })
    .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)));

  // S3 præference-lag: ved mål-løb sorteres A-kæden FØRST (rang→score→rider_id).
  // preference==null ELLER ikke-mål-løb/ingen A-kæde → uændret score-rækkefølge.
  let ordered = scored;
  if (preference?.isTargetRace && preference.aChain?.length) {
    const rank = new Map(preference.aChain.map((id, i) => [id, i]));
    ordered = [...scored].sort((a, b) => {
      const ra = rank.has(a.rider_id) ? rank.get(a.rider_id) : Infinity;
      const rb = rank.has(b.rider_id) ? rank.get(b.rider_id) : Infinity;
      if (ra !== rb) return ra - rb;                       // A-kæde-rang først (kun for A-kæde-medlemmer)
      return b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id));
    });
  }

  const picked = ordered.slice(0, Math.min(rule.max, ordered.length));
  if (!picked.length) return [];
  const pickedIds = new Set(picked.map((p) => p.rider_id));

  const captainId = resolveCaptain({ picked, pickedIds, stages, preference });
  const sprintCaptainId = resolveSprintCaptain({ picked, pickedIds, stages, captainId, preference });

  return picked.map((p) => ({
    rider_id: p.rider_id,
    race_role: p.rider_id === captainId ? "captain"
      : p.rider_id === sprintCaptainId ? "sprint_captain"
      : "helper",
  }));
}

// A-kæde-rang som tiebreak blandt lige kandidater (lavere index = højere prioritet).
function aChainRank(id, preference) {
  const i = preference?.aChain?.indexOf(id);
  return i == null || i < 0 ? Infinity : i;
}

// Kaptajn-præcedens (L6): fast regel > terræn-prioritet > GC-fallback.
function resolveCaptain({ picked, pickedIds, stages, preference }) {
  if (preference) {
    const forced = picked
      .filter((p) => preference.roleRules?.[p.rider_id] === "always_captain")
      .sort((a, b) => aChainRank(a.rider_id, preference) - aChainRank(b.rider_id, preference)
        || String(a.rider_id).localeCompare(String(b.rider_id)));
    if (forced.length) return forced[0].rider_id;
    for (const id of preference.captains || []) if (pickedIds.has(id)) return id;
  }
  const gcStagesToUse = gcStages(stages);
  return [...picked].sort((a, b) =>
    suitabilityScore(b.abilities, gcStagesToUse) - suitabilityScore(a.abilities, gcStagesToUse) ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  )[0].rider_id;
}

function resolveSprintCaptain({ picked, pickedIds, stages, captainId, preference }) {
  if (preference) {
    const forced = picked
      .filter((p) => p.rider_id !== captainId
        && preference.roleRules?.[p.rider_id] === "always_sprint_captain_if_present")
      .sort((a, b) => aChainRank(a.rider_id, preference) - aChainRank(b.rider_id, preference)
        || String(a.rider_id).localeCompare(String(b.rider_id)));
    if (forced.length) return forced[0].rider_id;
  }
  if (stages.some((s) => FLAT_PROFILES.has(s.profile_type)) && picked.length > 1) {
    const bestSprint = [...picked].sort((a, b) =>
      (Number(b.abilities?.sprint) || 0) - (Number(a.abilities?.sprint) || 0) ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )[0];
    if (bestSprint.rider_id !== captainId) return bestSprint.rider_id;
  }
  return null;
}
```

> NOTE: behold de eksisterende top-level konstanter (`AUTOPICK_FATIGUE_DAMPING`, `FLAT_PROFILES`, `gcStages`, `suitabilityScore`). De refereres nu også fra de nye helpers — ingen ændring nødvendig, de er allerede modul-scope.

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test lib/raceAutopick.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceAutopick.js backend/lib/raceAutopick.test.js
git commit -m "feat(race-hub): autopick præference-lag (A-kæde + rolle-regler + kaptajn-prioritet) (S3)"
```

---

### Task 3: assignTeamAcrossRaces — strategy-param

**Files:**
- Modify: `backend/lib/raceEntryGenerator.js:23-53`
- Test: `backend/lib/raceEntryGenerator.test.js` (append)

- [ ] **Step 1: Write the failing test (append to existing file)**

```js
// ── S3 strategi-lag ───────────────────────────────────────────────────────────
import { raceTerrainBucket } from "./raceTerrain.js"; // (allerede top af fil hvis ikke: tilføj her)

test("assignTeamAcrossRaces: strategy=null ≡ ingen strategy (idempotens)", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 300, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const a = assignTeamAcrossRaces({ riders, races });
  const b = assignTeamAcrossRaces({ riders, races, strategy: null });
  assert.deepEqual(a, b);
});

test("assignTeamAcrossRaces: tom strategi ≡ null-adfærd", () => {
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const empty = { aChain: [], captainPriorities: {}, roleRules: {}, targetRaceIds: new Set() };
  assert.deepEqual(assignTeamAcrossRaces({ riders, races, strategy: empty }), assignTeamAcrossRaces({ riders, races }));
});

test("assignTeamAcrossRaces: mål-løb får A-kæde-ryttere (selv svage)", () => {
  // r9 er svagest af de 10; A-kæde-rang 0 + mål-løb → med på A.
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const strategy = { aChain: ["r9", "r8"], captainPriorities: {}, roleRules: {}, targetRaceIds: new Set(["A"]) };
  const out = assignTeamAcrossRaces({ riders, races, strategy });
  const ids = out.A.map((e) => e.rider_id);
  assert.ok(ids.includes("r9") && ids.includes("r8"), "A-kæde på mål-løb");
});

test("assignTeamAcrossRaces: kaptajn-prioritet bruger løbets terræn-bucket", () => {
  const mtn = { profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.5 } };
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [mtn], sizeRule: { min: 6, max: 6 } }];
  // captainPriorities pr. bucket: mountain → r3 først.
  const strategy = { aChain: [], captainPriorities: { mountain: ["r3"] }, roleRules: {}, targetRaceIds: new Set() };
  const out = assignTeamAcrossRaces({ riders, races, strategy });
  assert.equal(out.A.find((e) => e.race_role === "captain")?.rider_id, "r3");
  assert.equal(raceTerrainBucket(races[0].stages), "mountain"); // sanity
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: FAIL — `strategy` ignoreres

- [ ] **Step 3: Write minimal implementation**

In `backend/lib/raceEntryGenerator.js`, add import at top (after existing imports):

```js
import { raceTerrainBucket } from "./raceTerrain.js";
```

Replace `assignTeamAcrossRaces` (lines 23-53) signature + per-race call:

```js
export function assignTeamAcrossRaces({ riders = [], races = [], lockedWindows = [], strategy = null }) {
  const ordered = [...races].sort(
    (a, b) => (a.window?.start ?? 0) - (b.window?.start ?? 0) || String(a.race_id).localeCompare(String(b.race_id))
  );
  const busy = new Map();
  for (const lock of lockedWindows) {
    if (!lock?.window) continue;
    for (const rid of lock.riderIds || []) {
      if (!busy.has(rid)) busy.set(rid, []);
      busy.get(rid).push(lock.window);
    }
  }
  const out = {};

  for (const race of ordered) {
    const available = riders.filter((r) => {
      const windows = busy.get(r.rider_id) || [];
      return !windows.some((w) => windowsOverlap(w, race.window));
    });
    // S3: udled per-race preference fra team-niveau strategi. null → uændret autopick.
    const preference = strategy
      ? {
          aChain: strategy.aChain || [],
          captains: strategy.captainPriorities?.[raceTerrainBucket(race.stages)] || [],
          roleRules: strategy.roleRules || {},
          isTargetRace: !!strategy.targetRaceIds?.has(race.race_id),
        }
      : null;
    const picks = autopickTeamSelection({ riders: available, stages: race.stages, sizeRule: race.sizeRule, preference });
    out[race.race_id] = picks;
    for (const p of picks) {
      if (!busy.has(p.rider_id)) busy.set(p.rider_id, []);
      busy.get(p.rider_id).push(race.window);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js lib/raceAutopick.test.js lib/raceTerrain.test.js`
Expected: PASS (all — inkl. de eksisterende generator-tests, som beviser strategy=null-idempotens i praksis)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceEntryGenerator.js backend/lib/raceEntryGenerator.test.js
git commit -m "feat(race-hub): assignTeamAcrossRaces fører strategi til autopick (strategy=null ≡ uændret) (S3)"
```

---

## Phase B — Persistens + loaders

### Task 4: Migration — strategi-tabeller (EJER MERGER)

**Files:**
- Create: `database/2026-06-25-team-race-strategy.sql`

- [ ] **Step 1: Write the migration** (kopiér spec §3 ordret)

```sql
-- Race Hub S3 (Fase 2 Holdstrategi): stående præferencer der fodrer den proaktive
-- entry-generator. RLS-mønster spejler scouting-l1 (eget-team-read, service_role-write).
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.team_race_strategy (
  team_id            UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  a_chain            JSONB NOT NULL DEFAULT '[]'::jsonb,
  captain_priorities JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_race_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_rider_role_rules (
  team_id   UUID NOT NULL REFERENCES public.teams(id)  ON DELETE CASCADE,
  rider_id  UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  role_rule TEXT NOT NULL CHECK (role_rule IN ('always_captain','always_sprint_captain_if_present')),
  PRIMARY KEY (team_id, rider_id)
);
CREATE INDEX IF NOT EXISTS idx_team_rider_role_rules_team ON public.team_rider_role_rules(team_id);

ALTER TABLE public.team_race_strategy    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_rider_role_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_race_strategy_select_own" ON public.team_race_strategy;
CREATE POLICY "team_race_strategy_select_own" ON public.team_race_strategy
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "team_rider_role_rules_select_own" ON public.team_rider_role_rules;
CREATE POLICY "team_rider_role_rules_select_own" ON public.team_rider_role_rules
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

GRANT SELECT ON public.team_race_strategy    TO authenticated;
GRANT SELECT ON public.team_rider_role_rules TO authenticated;

COMMENT ON TABLE public.team_race_strategy IS
  'Race Hub S3: holdets stående strategi (A-kæde, kaptajn-prioriteter pr. terræn-bucket, mål-løb). Fodrer raceEntryGenerator. Read=eget team, write=service_role.';
COMMENT ON TABLE public.team_rider_role_rules IS
  'Race Hub S3: faste rolle-regler pr. rytter (always_captain / always_sprint_captain_if_present). Read=eget team, write=service_role.';
```

- [ ] **Step 2: Lint SQL (verificér syntaks lokalt — ingen prod-apply)**

Run: `cd backend && node -e "const fs=require('fs');const s=fs.readFileSync('../database/2026-06-25-team-race-strategy.sql','utf8');if(!/CREATE TABLE IF NOT EXISTS public.team_race_strategy/.test(s))throw new Error('mangler tabel');console.log('SQL ok, '+s.length+' tegn')"`
Expected: `SQL ok, ...`

- [ ] **Step 3: Commit** (markér tydeligt at ejer merger)

```bash
git add database/2026-06-25-team-race-strategy.sql
git commit -m "feat(db): team_race_strategy + team_rider_role_rules — Race Hub S3 (ejer merger)"
```

---

### Task 5: raceStrategy.js — normalisering + loaders

**Files:**
- Create: `backend/lib/raceStrategy.js`
- Test: `backend/lib/raceStrategy.test.js`

- [ ] **Step 1: Write the failing test (normalisering + diff — de pure dele)**

```js
// backend/lib/raceStrategy.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStrategy, diffAssignments } from "./raceStrategy.js";

const roster = new Set(["r0", "r1", "r2", "r3"]);

test("normalizeStrategy: filtrerer stale ids (ikke i roster) tavst", () => {
  const raw = {
    a_chain: ["r0", "ghost", "r2"],
    captain_priorities: { mountain: ["r1", "ghost"], flat: ["r3"] },
    target_race_ids: ["raceA", "raceB"],
  };
  const rules = [{ rider_id: "r1", role_rule: "always_captain" }, { rider_id: "ghost", role_rule: "always_captain" }];
  const s = normalizeStrategy({ row: raw, ruleRows: rules, rosterIds: roster });
  assert.deepEqual(s.aChain, ["r0", "r2"]);
  assert.deepEqual(s.captainPriorities.mountain, ["r1"]);
  assert.deepEqual(s.captainPriorities.flat, ["r3"]);
  assert.deepEqual(s.roleRules, { r1: "always_captain" }); // ghost droppet
  assert.ok(s.targetRaceIds instanceof Set);
  assert.ok(s.targetRaceIds.has("raceA"));
});

test("normalizeStrategy: tom/manglende row → tom strategi (ikke null)", () => {
  const s = normalizeStrategy({ row: null, ruleRows: [], rosterIds: roster });
  assert.deepEqual(s.aChain, []);
  assert.deepEqual(s.captainPriorities, {});
  assert.deepEqual(s.roleRules, {});
  assert.equal(s.targetRaceIds.size, 0);
});

test("normalizeStrategy: dedup beholder første forekomst, bevarer rang", () => {
  const s = normalizeStrategy({ row: { a_chain: ["r0", "r0", "r1"] }, ruleRows: [], rosterIds: roster });
  assert.deepEqual(s.aChain, ["r0", "r1"]);
});

test("diffAssignments: added/removed/captain-skift pr. løb", () => {
  const current = { A: [{ rider_id: "r0", race_role: "captain" }, { rider_id: "r1", race_role: "helper" }] };
  const proposed = { A: [{ rider_id: "r0", race_role: "helper" }, { rider_id: "r2", race_role: "captain" }] };
  const d = diffAssignments({ current, proposed });
  assert.deepEqual(d.A.added, ["r2"]);
  assert.deepEqual(d.A.removed, ["r1"]);
  assert.deepEqual(d.A.captainChange, { from: "r0", to: "r2" });
});

test("diffAssignments: identiske → ingen ændring", () => {
  const same = { A: [{ rider_id: "r0", race_role: "captain" }] };
  const d = diffAssignments({ current: same, proposed: same });
  assert.deepEqual(d.A.added, []);
  assert.deepEqual(d.A.removed, []);
  assert.equal(d.A.captainChange, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceStrategy.test.js`
Expected: FAIL — module mangler

- [ ] **Step 3: Write implementation**

```js
// backend/lib/raceStrategy.js
// Race Hub S3: load + normalisér holdets strategi til generator-kernens form.
// Pure normalisering (testbar) + thin Supabase-I/O (loaders). Stale ids filtreres
// tavst mod holdets faktiske roster (L8). Skriv sker via api.js-endpoint (service_role).

import { TERRAIN_BUCKETS } from "./raceTerrain.js";
import { ABILITY_KEYS, terrainScore } from "./raceSimulator.js";

const VALID_RULES = new Set(["always_captain", "always_sprint_captain_if_present"]);

function dedupeInRoster(ids, rosterIds) {
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (rosterIds.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

// Pure: rå DB-rækker → { aChain, captainPriorities, roleRules, targetRaceIds:Set }.
export function normalizeStrategy({ row, ruleRows = [], rosterIds }) {
  const aChain = dedupeInRoster(row?.a_chain, rosterIds);
  const captainPriorities = {};
  const rawCap = row?.captain_priorities || {};
  for (const bucket of TERRAIN_BUCKETS) {
    const list = dedupeInRoster(rawCap[bucket], rosterIds);
    if (list.length) captainPriorities[bucket] = list;
  }
  const roleRules = {};
  for (const r of ruleRows || []) {
    if (rosterIds.has(r.rider_id) && VALID_RULES.has(r.role_rule)) roleRules[r.rider_id] = r.role_rule;
  }
  const targetRaceIds = new Set(Array.isArray(row?.target_race_ids) ? row.target_race_ids : []);
  return { aChain, captainPriorities, roleRules, targetRaceIds };
}

// Pure: diff to assignment-maps (race_id → [{rider_id, race_role}]).
export function diffAssignments({ current = {}, proposed = {} }) {
  const out = {};
  const raceIds = new Set([...Object.keys(current), ...Object.keys(proposed)]);
  for (const raceId of raceIds) {
    const cur = current[raceId] || [];
    const pro = proposed[raceId] || [];
    const curIds = new Set(cur.map((e) => e.rider_id));
    const proIds = new Set(pro.map((e) => e.rider_id));
    const added = pro.filter((e) => !curIds.has(e.rider_id)).map((e) => e.rider_id);
    const removed = cur.filter((e) => !proIds.has(e.rider_id)).map((e) => e.rider_id);
    const curCap = cur.find((e) => e.race_role === "captain")?.rider_id ?? null;
    const proCap = pro.find((e) => e.race_role === "captain")?.rider_id ?? null;
    out[raceId] = {
      added, removed,
      captainChange: curCap !== proCap ? { from: curCap, to: proCap } : null,
    };
  }
  return out;
}

// Thin I/O: load én holds strategi, normaliseret mod holdets ryttere.
export async function loadTeamStrategy({ supabase, teamId, rosterIds }) {
  const [{ data: row }, { data: rules }] = await Promise.all([
    supabase.from("team_race_strategy").select("a_chain, captain_priorities, target_race_ids").eq("team_id", teamId).maybeSingle(),
    supabase.from("team_rider_role_rules").select("rider_id, role_rule").eq("team_id", teamId),
  ]);
  return normalizeStrategy({ row, ruleRows: rules || [], rosterIds });
}

// Thin I/O: load mange holds strategier (bulk-generator). rosterByTeam: Map<teamId, Set<riderId>>.
// Returnerer Map<teamId, strategy|null> — null hvis holdet hverken har strategi-row eller regler
// (→ uændret generator-adfærd / idempotens).
export async function loadStrategiesForTeams({ supabase, teamIds, rosterByTeam, selectInChunks }) {
  const out = new Map();
  if (!teamIds.length) return out;
  const [{ data: rows }, { data: rules }] = await Promise.all([
    selectInChunks({ supabase, table: "team_race_strategy", columns: "team_id, a_chain, captain_priorities, target_race_ids", inColumn: "team_id", ids: teamIds }),
    selectInChunks({ supabase, table: "team_rider_role_rules", columns: "team_id, rider_id, role_rule", inColumn: "team_id", ids: teamIds }),
  ]);
  const rowByTeam = new Map((rows || []).map((r) => [r.team_id, r]));
  const rulesByTeam = new Map();
  for (const r of rules || []) {
    if (!rulesByTeam.has(r.team_id)) rulesByTeam.set(r.team_id, []);
    rulesByTeam.get(r.team_id).push(r);
  }
  for (const teamId of teamIds) {
    const row = rowByTeam.get(teamId);
    const ruleRows = rulesByTeam.get(teamId) || [];
    if (!row && !ruleRows.length) { out.set(teamId, null); continue; } // ingen strategi → null
    out.set(teamId, normalizeStrategy({ row, ruleRows, rosterIds: rosterByTeam.get(teamId) || new Set() }));
  }
  return out;
}

// Per-bucket gennemsnits-demand-vector fra sæsonens stage-profiler → per-rytter suitability
// pr. bucket (0-100). Til kaptajn-board + auto-foreslå. buckets uden løb → udeladt (UI: "—").
export function bucketSuitabilities({ stageProfiles = [], riders = [] }) {
  const sums = new Map();   // bucket → { vec:{}, n }
  for (const p of stageProfiles) {
    const bucket = p.bucket; // forventer at kalderen har mappet profile_type → bucket
    if (!bucket) continue;
    if (!sums.has(bucket)) sums.set(bucket, { vec: {}, n: 0 });
    const agg = sums.get(bucket);
    agg.n += 1;
    for (const [k, v] of Object.entries(p.demand_vector || {})) agg.vec[k] = (agg.vec[k] || 0) + Number(v || 0);
  }
  const avgByBucket = new Map();
  for (const [bucket, { vec, n }] of sums) {
    const avg = {};
    for (const [k, v] of Object.entries(vec)) avg[k] = v / n;
    avgByBucket.set(bucket, avg);
  }
  const out = {}; // rider_id → { bucket: 0-100 }
  for (const r of riders) {
    out[r.rider_id] = {};
    for (const [bucket, avg] of avgByBucket) {
      out[r.rider_id][bucket] = Math.round(terrainScore(r.abilities || {}, avg) * 100);
    }
  }
  return out;
}
```

> NOTE: `ABILITY_KEYS` importeres for fremtidig brug/paritet med generatoren; hvis lint klager over ubrugt, fjern importen — kun `terrainScore` bruges her.

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test lib/raceStrategy.test.js`
Expected: PASS

- [ ] **Step 5: Add bucketSuitabilities test + commit**

Append test:
```js
import { bucketSuitabilities } from "./raceStrategy.js";
test("bucketSuitabilities: stærk klatrer scorer højere på mountain end svag", () => {
  const profiles = [{ bucket: "mountain", demand_vector: { climbing: 1.0 } }];
  const riders = [
    { rider_id: "strong", abilities: { climbing: 90 } },
    { rider_id: "weak", abilities: { climbing: 20 } },
  ];
  const s = bucketSuitabilities({ stageProfiles: profiles, riders });
  assert.ok(s.strong.mountain > s.weak.mountain);
});
```
Run: `cd backend && node --test lib/raceStrategy.test.js` → PASS
```bash
git add backend/lib/raceStrategy.js backend/lib/raceStrategy.test.js
git commit -m "feat(race-hub): raceStrategy loaders + normalisering + diff + bucket-suitability (S3)"
```

---

## Phase C — Generator-integration

### Task 6: runRaceEntryGenerator loader strategier

**Files:**
- Modify: `backend/lib/raceEntryGenerator.js` (step 8/9-området + import)
- Test: `backend/lib/raceEntryGenerator.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
test("runRaceEntryGenerator: holdets A-kæde-mål-løb prioriterer kerne-ryttere", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8); // t1-r0 stærkest … t1-r7 svagest
  // A-kæde: svageste rytter som rang 0 + A er mål-løb → han SKAL udtages.
  state.team_race_strategy = [{ team_id: "t1", a_chain: ["t1-r7"], captain_priorities: {}, target_race_ids: ["A"] }];
  state.team_rider_role_rules = [];

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });
  const aIds = state.race_entries.filter((e) => e.race_id === "A").map((e) => e.rider_id);
  assert.ok(aIds.includes("t1-r7"), "A-kæde-rytter på mål-løb trods lav score");
});

test("runRaceEntryGenerator: hold UDEN strategi-row → uændret (strategy=null)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  state.team_race_strategy = [];
  state.team_rider_role_rules = [];

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });
  const aIds = state.race_entries.filter((e) => e.race_id === "A").map((e) => e.rider_id).sort();
  // Class2 = 6 ryttere; uden strategi = top-6 på score = t1-r0..t1-r5.
  assert.deepEqual(aIds, ["t1-r0", "t1-r1", "t1-r2", "t1-r3", "t1-r4", "t1-r5"]);
});
```

Also update `emptyState()` to include the new tables:
```js
// i emptyState(): tilføj
    team_race_strategy: [], team_rider_role_rules: [],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: FAIL — strategi ikke loadet (A-kæde-test fejler)

- [ ] **Step 3: Write implementation**

Add import at top of `raceEntryGenerator.js`:
```js
import { loadStrategiesForTeams } from "./raceStrategy.js";
```

In `runRaceEntryGenerator`, after step 8 builds `ridersByTeam` (and before step 9's loop), build roster sets + load strategies:
```js
  // S3: load strategier for egnede hold. rosterByTeam = holdets ryttere (til stale-filter).
  const rosterByTeam = new Map();
  for (const [teamId, list] of ridersByTeam) rosterByTeam.set(teamId, new Set(list.map((r) => r.rider_id)));
  const strategyByTeam = await loadStrategiesForTeams({
    supabase, teamIds: eligibleTeamIds, rosterByTeam, selectInChunks,
  });
```

In step 9's per-team loop, pass strategy to the kernel:
```js
      const assignment = assignTeamAcrossRaces({
        riders: ridersByTeam.get(team.id) || [],
        races: teamRaces,
        lockedWindows,
        strategy: strategyByTeam.get(team.id) ?? null,
      });
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: PASS (alle — inkl. de eksisterende idempotens/binding-tests, som nu også beviser at strategy-loading ikke ændrer null-hold)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceEntryGenerator.js backend/lib/raceEntryGenerator.test.js
git commit -m "feat(race-hub): runRaceEntryGenerator loader + anvender holdstrategier (S3)"
```

---

### Task 7: regenerate-endpoint loader holdets strategi

**Files:**
- Modify: `backend/routes/api.js:1737-1836` (regenerate-handleren)

- [ ] **Step 1: Add import** (top of api.js, near line 285)

```js
import { loadTeamStrategy } from "../lib/raceStrategy.js";
```

- [ ] **Step 2: Load strategi + pass den** — i regenerate-handleren, efter `riders` er bygget (linje ~1792), tilføj:

```js
    // S3: holdets strategi som deterministisk præference-lag. Ingen row → null (uændret).
    const strategy = await loadTeamStrategy({
      supabase, teamId: req.team.id, rosterIds: new Set(teamRiderIds),
    });
```

Og opdatér `assignTeamAcrossRaces`-kaldet (linje ~1813):
```js
    const picksByRace = assignTeamAcrossRaces({ riders, races: assignRaces, lockedWindows, strategy });
```

- [ ] **Step 3: Verify backend boots + existing tests green**

Run: `cd backend && node --check routes/api.js && node --test lib/`
Expected: ingen syntaksfejl; alle lib-tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(race-hub): regenerate-endpoint anvender holdstrategi (S3)"
```

---

## Phase D — API-endpoints

### Task 8: GET /api/races/strategy

**Files:**
- Modify: `backend/routes/api.js` (efter regenerate-handleren, ~linje 1836)

- [ ] **Step 1: Implement endpoint**

```js
// Race Hub S3 — GET /api/races/strategy
// Holdets strategi + roster + suitability pr. terræn-bucket + kommende løb (til mål-løb).
router.get("/races/strategy", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
    if (!enabled) return res.json({ enabled: false });

    // Roster (løbs-berettigede ryttere) + abilities.
    const { data: riders } = await supabase
      .from("riders").select("id, firstname, lastname, primary_type, secondary_type, overall")
      .eq("team_id", req.team.id).eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false");
    const rosterIds = new Set((riders || []).map((r) => r.id));
    const riderIdList = [...rosterIds];
    const abilityCols = ["rider_id", ...RACE_SIM_ABILITY_KEYS].join(", ");
    const { data: abilities } = riderIdList.length
      ? await supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderIdList)
      : { data: [] };
    const abById = new Map((abilities || []).map((a) => [a.rider_id, a]));

    // Strategi (normaliseret mod roster).
    const strategy = await loadTeamStrategy({ supabase, teamId: req.team.id, rosterIds });

    // Sæsonens stage-profiler → bucket-suitability pr. rytter.
    const { data: season } = await supabase.from("seasons").select("id, start_date").eq("status", "active").maybeSingle();
    let suitabilities = {};
    let upcoming = [];
    if (season) {
      const { data: races } = await supabase
        .from("races").select("id, name, race_class, stages, stages_completed, status, league_division_id")
        .eq("season_id", season.id);
      const myRaces = (races || []).filter((r) =>
        teamInRacePool({ teamDivisionId: req.team.league_division_id, racePoolId: r.league_division_id }));
      const raceIds = myRaces.map((r) => r.id);
      const { data: profs } = raceIds.length
        ? await supabase.from("race_stage_profiles").select("race_id, profile_type, demand_vector").in("race_id", raceIds.slice(0, 1000))
        : { data: [] };
      const stageProfiles = (profs || []).map((p) => ({ bucket: terrainBucket(p.profile_type), demand_vector: p.demand_vector }));
      suitabilities = bucketSuitabilities({
        stageProfiles,
        riders: riderIdList.map((id) => ({ rider_id: id, abilities: abById.get(id) })).filter((r) => r.abilities),
      });
      // Kommende løb til mål-løb-markering: scheduled, ikke afsluttet, egen pulje.
      const profsByRace = new Map();
      for (const p of profs || []) {
        if (!profsByRace.has(p.race_id)) profsByRace.set(p.race_id, []);
        profsByRace.get(p.race_id).push(p);
      }
      upcoming = myRaces
        .filter((r) => deriveRaceStatus(r.status, r.stages_completed ?? 0, r.stages) !== "completed")
        .map((r) => ({
          id: r.id, name: r.name, race_class: r.race_class,
          status: deriveRaceStatus(r.status, r.stages_completed ?? 0, r.stages),
          bucket: raceTerrainBucket(profsByRace.get(r.id) || []),
          is_target: strategy.targetRaceIds.has(r.id),
        }));
    }

    res.json({
      enabled: true,
      roster: (riders || []).map((r) => ({
        id: r.id, name: [r.firstname, r.lastname].filter(Boolean).join(" "),
        primaryType: r.primary_type ?? null, secondaryType: r.secondary_type ?? null,
        overall: r.overall ?? null,
        suitabilities: suitabilities[r.id] || {},
      })),
      a_chain: strategy.aChain,
      captain_priorities: strategy.captainPriorities,
      role_rules: strategy.roleRules,
      target_race_ids: [...strategy.targetRaceIds],
      upcoming,
    });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add imports** (top of api.js): tilføj til raceTerrain + raceStrategy import-linjer:
```js
import { terrainBucket, raceTerrainBucket } from "../lib/raceTerrain.js";
import { loadTeamStrategy, bucketSuitabilities } from "../lib/raceStrategy.js";
```
(Behold den loadTeamStrategy-import fra Task 7 — slå sammen til én linje.)

- [ ] **Step 3: Verify boots**

Run: `cd backend && node --check routes/api.js`
Expected: ingen fejl

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(race-hub): GET /races/strategy (roster + bucket-suitability + kommende løb) (S3)"
```

---

### Task 9: PUT /api/races/strategy

**Files:**
- Modify: `backend/routes/api.js` (efter GET strategy)

- [ ] **Step 1: Implement endpoint**

```js
// Race Hub S3 — PUT /api/races/strategy. Gemmer strategi (upsert) + erstatter rolle-regler.
// Skriver IKKE entries (preview/regenerate er separate handlinger). Ukendte rider/race-ids
// droppes tavst mod holdets roster + sæsonens løb (robust mod roster/kalender-ændringer).
router.put("/races/strategy", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
    if (!enabled) return res.status(409).json({ error: "selection_flag_disabled" });

    const body = req.body || {};
    const aChainIn = body.a_chain, capIn = body.captain_priorities, targetIn = body.target_race_ids, rulesIn = body.role_rules;
    if (aChainIn != null && !Array.isArray(aChainIn)) return res.status(400).json({ error: "strategy_invalid_body" });
    if (targetIn != null && !Array.isArray(targetIn)) return res.status(400).json({ error: "strategy_invalid_body" });
    if (capIn != null && (typeof capIn !== "object" || Array.isArray(capIn))) return res.status(400).json({ error: "strategy_invalid_body" });
    if (rulesIn != null && (typeof rulesIn !== "object" || Array.isArray(rulesIn))) return res.status(400).json({ error: "strategy_invalid_body" });

    // Roster + sæson-løb til stale-filter.
    const { data: riders } = await supabase
      .from("riders").select("id").eq("team_id", req.team.id).eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false");
    const rosterIds = new Set((riders || []).map((r) => r.id));
    const { data: season } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
    let raceIds = new Set();
    if (season) {
      const { data: races } = await supabase.from("races").select("id, league_division_id").eq("season_id", season.id);
      raceIds = new Set((races || [])
        .filter((r) => teamInRacePool({ teamDivisionId: req.team.league_division_id, racePoolId: r.league_division_id }))
        .map((r) => r.id));
    }
    const filterRoster = (arr) => (Array.isArray(arr) ? arr : []).filter((id) => rosterIds.has(id));
    const aChain = filterRoster(aChainIn);
    const captain_priorities = {};
    for (const [bucket, list] of Object.entries(capIn || {})) captain_priorities[bucket] = filterRoster(list);
    const target_race_ids = (Array.isArray(targetIn) ? targetIn : []).filter((id) => raceIds.has(id));

    const VALID = new Set(["always_captain", "always_sprint_captain_if_present"]);
    const ruleRows = Object.entries(rulesIn || {})
      .filter(([rid, rule]) => rosterIds.has(rid) && VALID.has(rule))
      .map(([rider_id, role_rule]) => ({ team_id: req.team.id, rider_id, role_rule }));

    const { error: upErr } = await supabase.from("team_race_strategy").upsert(
      { team_id: req.team.id, a_chain: aChain, captain_priorities, target_race_ids, updated_at: new Date().toISOString() },
      { onConflict: "team_id" });
    if (upErr) return res.status(500).json({ error: upErr.message });

    const { error: delErr } = await supabase.from("team_rider_role_rules").delete().eq("team_id", req.team.id);
    if (delErr) return res.status(500).json({ error: delErr.message });
    if (ruleRows.length) {
      const { error: insErr } = await supabase.from("team_rider_role_rules").insert(ruleRows);
      if (insErr) return res.status(500).json({ error: insErr.message });
    }
    res.json({ ok: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Verify boots + commit**

Run: `cd backend && node --check routes/api.js`
```bash
git add backend/routes/api.js
git commit -m "feat(race-hub): PUT /races/strategy (gem strategi + rolle-regler, stale-filter) (S3)"
```

---

### Task 10: POST /api/races/strategy/preview

**Files:**
- Modify: `backend/routes/api.js` (efter PUT strategy)

- [ ] **Step 1: Implement endpoint** — genbruger generator-kernen + `diffAssignments`.

```js
// Race Hub S3 — POST /api/races/strategy/preview. Live preview-diff: kør generatoren
// mod holdets kommende, ikke-startede, ikke-manuelle løb under den FORESLÅEDE strategi
// (i body, samme form som PUT) og differ mod nuværende entries. Skriver intet.
router.post("/races/strategy/preview", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
    if (!enabled) return res.status(409).json({ error: "selection_flag_disabled" });

    const { data: season } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
    if (!season) return res.json({ ok: true, diff: {} });

    const { data: races } = await supabase
      .from("races").select("id, race_class, race_type, stages, stages_completed, status, league_division_id").eq("season_id", season.id);
    const myRaces = (races || []).filter((r) =>
      r.status === "scheduled" &&
      teamInRacePool({ teamDivisionId: req.team.league_division_id, racePoolId: r.league_division_id }));
    const raceIds = myRaces.map((r) => r.id);
    if (!raceIds.length) return res.json({ ok: true, diff: {} });

    const schedRows = await fetchAllScheduleRows(supabase, raceIds);
    const schedByRace = new Map();
    for (const s of schedRows || []) {
      if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
      schedByRace.get(s.race_id).push(s);
    }
    const bindingWindowByRace = new Map(raceIds.map((id) => [id, raceBindingWindow(schedByRace.get(id))]));

    // Roster + abilities + fatigue.
    const { data: riders } = await supabase
      .from("riders").select("id").eq("team_id", req.team.id).eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false");
    const teamRiderIds = (riders || []).map((r) => r.id);
    const abilityCols = ["rider_id", ...RACE_SIM_ABILITY_KEYS].join(", ");
    const [{ data: abilities }, { data: conditions }, { data: allEntries }] = await Promise.all([
      supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", teamRiderIds),
      supabase.from("rider_condition").select("rider_id, fatigue").in("rider_id", teamRiderIds),
      supabase.from("race_entries").select("race_id, rider_id, race_role, is_auto_filled").eq("team_id", req.team.id),
    ]);
    const abById = new Map((abilities || []).map((a) => [a.rider_id, a]));
    const fatById = new Map((conditions || []).map((c) => [c.rider_id, c.fatigue]));
    const riderObjs = teamRiderIds.map((id) => ({ rider_id: id, abilities: abById.get(id), fatigue: fatById.get(id) ?? 0 })).filter((r) => r.abilities);

    // Stage-profiler.
    const { data: profs } = await supabase.from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, demand_vector").in("race_id", raceIds.slice(0, 1000));
    const stagesByRace = new Map();
    for (const p of profs || []) {
      if (!stagesByRace.has(p.race_id)) stagesByRace.set(p.race_id, []);
      stagesByRace.get(p.race_id).push(p);
    }
    for (const arr of stagesByRace.values()) arr.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

    // Target = kommende, ikke-startede, ikke-manuelle løb. Manuelle/startede → lockedWindows.
    const manualRaceIds = new Set((allEntries || []).filter((e) => e.is_auto_filled === false).map((e) => e.race_id));
    const target = myRaces.filter((r) => (r.stages_completed ?? 0) === 0 && !manualRaceIds.has(r.id) && bindingWindowByRace.get(r.id));
    const lockedWindows = lockedWindowsFromEntries({
      entries: allEntries || [], windowByRace: bindingWindowByRace, excludeRaceIds: new Set(target.map((r) => r.id)),
    });

    // Normalisér foreslået strategi mod roster + sæson-løb (genbrug filtre fra PUT — her inline).
    const rosterIds = new Set(teamRiderIds);
    const filterRoster = (arr) => (Array.isArray(arr) ? arr : []).filter((id) => rosterIds.has(id));
    const capIn = req.body?.captain_priorities || {};
    const captainPriorities = {};
    for (const [b, list] of Object.entries(capIn)) captainPriorities[b] = filterRoster(list);
    const proposedStrategy = {
      aChain: filterRoster(req.body?.a_chain),
      captainPriorities,
      roleRules: Object.fromEntries(Object.entries(req.body?.role_rules || {}).filter(([rid]) => rosterIds.has(rid))),
      targetRaceIds: new Set((Array.isArray(req.body?.target_race_ids) ? req.body.target_race_ids : []).filter((id) => raceIds.includes(id))),
    };

    const assignRaces = target.map((r) => ({
      race_id: r.id, window: bindingWindowByRace.get(r.id), stages: stagesByRace.get(r.id) || [],
      sizeRule: selectionSizeForRace(r),
    }));
    const proposed = assignTeamAcrossRaces({ riders: riderObjs, races: assignRaces, lockedWindows, strategy: proposedStrategy });

    // Nuværende entries (kun target-løb) → diff-input.
    const current = {};
    for (const e of allEntries || []) {
      if (!target.find((r) => r.id === e.race_id)) continue;
      if (!current[e.race_id]) current[e.race_id] = [];
      current[e.race_id].push({ rider_id: e.rider_id, race_role: e.race_role });
    }
    const diff = diffAssignments({ current, proposed });
    res.json({ ok: true, diff });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add `diffAssignments` to the raceStrategy import** (slå sammen med eksisterende import-linje):
```js
import { loadTeamStrategy, bucketSuitabilities, diffAssignments } from "../lib/raceStrategy.js";
```

- [ ] **Step 3: Verify boots + run all backend lib tests**

Run: `cd backend && node --check routes/api.js && node --test lib/`
Expected: ingen syntaksfejl; alle tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(race-hub): POST /races/strategy/preview (live diff via generator-kerne) (S3)"
```

---

## Phase E — Frontend

### Task 11: strategyLogic.js — pure helpers

**Files:**
- Create: `frontend/src/lib/strategyLogic.js` + `.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/strategyLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveInList, toggleInList, autoSuggestCaptains, summarizeDiff, TERRAIN_BUCKETS } from "./strategyLogic.js";

test("moveInList: flyt op/ned, clamp ved ender", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 0, -1), ["a", "b", "c"]); // clamp top
  assert.deepEqual(moveInList(["a", "b", "c"], 2, 1), ["a", "b", "c"]);  // clamp bund
});

test("toggleInList: tilføj hvis fraværende, fjern hvis til stede", () => {
  assert.deepEqual(toggleInList(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleInList(["a", "b"], "a"), ["b"]);
});

test("autoSuggestCaptains: top-3 efter bucket-suitability, deterministisk tiebreak", () => {
  const roster = [
    { id: "r1", suitabilities: { mountain: 50 } },
    { id: "r2", suitabilities: { mountain: 90 } },
    { id: "r3", suitabilities: { mountain: 70 } },
    { id: "r4", suitabilities: { mountain: 70 } },
  ];
  assert.deepEqual(autoSuggestCaptains(roster, "mountain"), ["r2", "r3", "r4"]); // 90,70,70(tiebreak id)
});

test("autoSuggestCaptains: bucket uden data → tom liste", () => {
  assert.deepEqual(autoSuggestCaptains([{ id: "r1", suitabilities: {} }], "itt"), []);
});

test("summarizeDiff: tæller løb med ændringer", () => {
  const diff = {
    A: { added: ["r2"], removed: ["r1"], captainChange: null },
    B: { added: [], removed: [], captainChange: { from: "r0", to: "r3" } },
    C: { added: [], removed: [], captainChange: null },
  };
  assert.deepEqual(summarizeDiff(diff), { changedRaces: 2, totalAdded: 1, totalRemoved: 1, captainChanges: 1 });
});

test("TERRAIN_BUCKETS matcher backend", () => {
  assert.deepEqual(TERRAIN_BUCKETS, ["flat", "hilly", "mountain", "cobbles", "itt"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/strategyLogic.test.js`
Expected: FAIL — module mangler

- [ ] **Step 3: Write implementation**

```js
// frontend/src/lib/strategyLogic.js
// Race Hub S3: rene UI-helpers til Holdstrategi-fladen. Ingen React, ingen I/O.

export const TERRAIN_BUCKETS = ["flat", "hilly", "mountain", "cobbles", "itt"];

// Flyt element i `dir` (-1 op, +1 ned) med clamp; returnerer ny liste.
export function moveInList(list, index, dir) {
  const next = [...list];
  const j = index + dir;
  if (j < 0 || j >= next.length) return next;
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

// Toggle medlemskab i en liste (bevarer rækkefølge ved tilføj-til-sidst).
export function toggleInList(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// Top-3 kaptajn-kandidater for en bucket efter suitability (desc), tiebreak id (asc).
// Ryttere uden suitability-tal for bucketen udelades.
export function autoSuggestCaptains(roster, bucket) {
  return [...roster]
    .filter((r) => Number.isFinite(r.suitabilities?.[bucket]))
    .sort((a, b) => (b.suitabilities[bucket] - a.suitabilities[bucket]) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 3)
    .map((r) => r.id);
}

// Aggregér preview-diff til overskrifts-tal.
export function summarizeDiff(diff = {}) {
  let changedRaces = 0, totalAdded = 0, totalRemoved = 0, captainChanges = 0;
  for (const d of Object.values(diff)) {
    const changed = d.added.length || d.removed.length || d.captainChange;
    if (changed) changedRaces += 1;
    totalAdded += d.added.length;
    totalRemoved += d.removed.length;
    if (d.captainChange) captainChanges += 1;
  }
  return { changedRaces, totalAdded, totalRemoved, captainChanges };
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && node --test src/lib/strategyLogic.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/strategyLogic.js frontend/src/lib/strategyLogic.test.js
git commit -m "feat(race-hub): strategyLogic pure helpers (ranking, auto-foreslå, diff) (S3)"
```

---

### Task 12: i18n — races.json strategi-keys (en+da)

**Files:**
- Modify: `frontend/public/locales/en/races.json`, `frontend/public/locales/da/races.json`

- [ ] **Step 1: Add `strategy` block + new selection error codes** (EN — DA samme struktur, oversat)

I `en/races.json`, tilføj under `racehub`-søskende-niveau (top-level i filen) en `strategy`-nøgle:
```json
"strategy": {
  "title": "Team strategy",
  "subtitle": "Standing preferences your assistant uses to build every lineup.",
  "back": "Back to squad board",
  "aChain": { "title": "A-chain", "help": "Your core riders, ranked. They get priority for your target races.", "add": "Add rider", "empty": "No core riders yet. Add the riders you build around." },
  "roleRules": { "title": "Fixed roles", "none": "No fixed role", "always_captain": "Always captain", "always_sprint_captain_if_present": "Always sprint captain (if selected)" },
  "captains": { "title": "Captains by terrain", "help": "Ranked captain candidates per terrain. The assistant picks the highest-ranked selected rider.", "suggest": "Auto-suggest", "rank": "Captain {n}" },
  "buckets": { "flat": "Flat", "hilly": "Hills", "mountain": "Mountains", "cobbles": "Cobbles", "itt": "Time trial" },
  "targets": { "title": "Target races", "help": "Mark the races that matter most. Your A-chain is prioritized here.", "marked": "Target", "empty": "No upcoming races." },
  "preview": { "title": "How your strategy changes selections", "run": "Preview changes", "none": "No changes to upcoming auto-filled races.", "summary": "{changedRaces} races change · +{totalAdded}/−{totalRemoved} riders · {captainChanges} captain changes", "added": "In", "removed": "Out", "captain": "Captain → {name}" },
  "save": "Save strategy", "saved": "Strategy saved", "regenerate": "Regenerate suggestions", "open": "Team strategy"
}
```

Tilføj nye fejlkoder under `selection.errors`:
```json
"strategy_invalid_body": "Could not save strategy — invalid data.",
"strategy_flag_disabled": "Race hub is not enabled."
```

DA-ækvivalent (oversæt; behold nøgler). Eksempel-værdier:
- `title`: "Holdstrategi", `subtitle`: "Stående præferencer din assistent bruger til at bygge hver opstilling.", `aChain.title`: "A-kæde", osv.

- [ ] **Step 2: Verify JSON parses + i18n-paritet (en/da har samme nøgler)**

Run:
```bash
cd frontend && node -e "const en=require('./public/locales/en/races.json'),da=require('./public/locales/da/races.json');const keys=o=>Object.keys(o).flatMap(k=>typeof o[k]==='object'&&o[k]?keys(o[k]).map(s=>k+'.'+s):[k]);const a=new Set(keys(en)),b=new Set(keys(da));const miss=[...a].filter(k=>!b.has(k)).concat([...b].filter(k=>!a.has(k)));if(miss.length)throw new Error('i18n drift: '+miss.join(', '));console.log('i18n paritet ok')"
```
Expected: `i18n paritet ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git commit -m "i18n(race-hub): Holdstrategi-keys + nye fejlkoder (en+da) (S3)"
```

---

### Task 13: StrategyPage + subkomponenter

**Files:**
- Create: `frontend/src/pages/StrategyPage.jsx` + 5 komponenter i `frontend/src/components/racehub/strategy/`

> **Design-krav (memory):** editorial navy/guld/Bebas, INGEN AI-slop (ingen rounded-2xl/glow/emoji-ikoner/gradient-blobs). Genbrug `FitBar` til suitability, `Spinner`/`EmptyState` fra `../ui`, `deriveRaceStatus`-chip-mønster. Mobil-først grid. Følg `RaceHubBoard.jsx`'s auth/fetch-mønster (`authHeaders()`, `VITE_API_URL`).

- [ ] **Step 1: StrategyPage.jsx** — orkestrator: fetch `GET /races/strategy`, hold lokal redigerbar state, `PUT` ved gem, `POST /preview` ved "Preview changes", "Regenerate" kalder `/distribution/regenerate?mode=missing`. Struktur (skriv fuldt; mønster fra RaceHubBoard):

```jsx
// frontend/src/pages/StrategyPage.jsx
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSession } from "../lib/supabase";
import { Spinner, EmptyState } from "../components/ui";
import AChainEditor from "../components/racehub/strategy/AChainEditor.jsx";
import RoleRulesEditor from "../components/racehub/strategy/RoleRulesEditor.jsx";
import CaptainBoard from "../components/racehub/strategy/CaptainBoard.jsx";
import TargetRacePicker from "../components/racehub/strategy/TargetRacePicker.jsx";
import PreviewDiff from "../components/racehub/strategy/PreviewDiff.jsx";

const API = import.meta.env.VITE_API_URL;
async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

export default function StrategyPage() {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // { aChain, captainPriorities, roleRules, targetRaceIds }
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    const res = await fetch(`${API}/api/races/strategy`, { headers });
    if (res.ok) {
      const j = await res.json();
      setData(j);
      if (j.enabled) setDraft({
        aChain: j.a_chain || [], captainPriorities: j.captain_priorities || {},
        roleRules: j.role_rules || {}, targetRaceIds: j.target_race_ids || [],
      });
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-10"><Spinner size={20} /></div>;
  if (!data?.enabled) return null;
  if (!data.roster?.length) return <EmptyState title={t("strategy.aChain.empty")} />;

  const payload = () => ({
    a_chain: draft.aChain, captain_priorities: draft.captainPriorities,
    role_rules: draft.roleRules, target_race_ids: draft.targetRaceIds,
  });
  const runPreview = async () => {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true);
    const res = await fetch(`${API}/api/races/strategy/preview`, { method: "POST", headers, body: JSON.stringify(payload()) });
    if (res.ok) setPreview((await res.json()).diff || {});
    setBusy(false);
  };
  const save = async () => {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true); setSaved(false);
    const res = await fetch(`${API}/api/races/strategy`, { method: "PUT", headers, body: JSON.stringify(payload()) });
    if (res.ok) setSaved(true);
    setBusy(false);
  };
  const regenerate = async () => {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true);
    await fetch(`${API}/api/races/distribution/regenerate?mode=missing`, { method: "POST", headers });
    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-3 py-4" data-testid="strategy-page">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display text-2xl text-cz-1">{t("strategy.title")}</h1>
        <Link to="/races" className="text-xs text-cz-accent hover:underline">{t("strategy.back")}</Link>
      </div>
      <p className="text-sm text-cz-3 mb-5">{t("strategy.subtitle")}</p>

      <AChainEditor roster={data.roster} value={draft.aChain} onChange={(aChain) => setDraft({ ...draft, aChain })} />
      <RoleRulesEditor roster={data.roster} value={draft.roleRules} onChange={(roleRules) => setDraft({ ...draft, roleRules })} />
      <CaptainBoard roster={data.roster} value={draft.captainPriorities} onChange={(captainPriorities) => setDraft({ ...draft, captainPriorities })} />
      <TargetRacePicker upcoming={data.upcoming || []} value={draft.targetRaceIds} onChange={(targetRaceIds) => setDraft({ ...draft, targetRaceIds })} />

      <div className="flex flex-wrap items-center gap-2 mt-6 border-t border-cz-border pt-4">
        <button type="button" onClick={runPreview} disabled={busy} className="cz-btn-secondary text-sm">{t("strategy.preview.run")}</button>
        <button type="button" onClick={save} disabled={busy} className="cz-btn-primary text-sm">{t("strategy.save")}</button>
        <button type="button" onClick={regenerate} disabled={busy} className="cz-btn-secondary text-sm">{t("strategy.regenerate")}</button>
        {saved && <span className="text-xs text-cz-accent">{t("strategy.saved")}</span>}
      </div>
      {preview && <PreviewDiff diff={preview} roster={data.roster} />}
    </div>
  );
}
```

> NOTE: verificér de faktiske button-utility-klasser (`cz-btn-primary`/`-secondary`) findes — ellers brug eksisterende knap-mønster fra `RaceHubBoard`/`ui`. Tjek `frontend/src/components/ui` for kanoniske knapper FØR du skriver klasser.

- [ ] **Step 2: AChainEditor.jsx** — rangordnet liste med op/ned/fjern (`moveInList`/`toggleInList`) + "tilføj fra roster"-vælger. Vis navn + type + overall.

- [ ] **Step 3: RoleRulesEditor.jsx** — pr. rytter en `<select>` med 3 valg (none/always_captain/always_sprint_captain_if_present); skriv til `roleRules`-map (fjern nøgle ved "none").

- [ ] **Step 4: CaptainBoard.jsx** — 5 terræn-grupper (`TERRAIN_BUCKETS`), hver rangordnet liste (max 3) + `FitBar` mod `roster[].suitabilities[bucket]` + "Auto-foreslå"-knap (`autoSuggestCaptains`).

- [ ] **Step 5: TargetRacePicker.jsx** — `upcoming`-liste med checkbox (`toggleInList`), `deriveRaceStatus`-chip + terræn-bucket-label.

- [ ] **Step 6: PreviewDiff.jsx** — render diff: pr. løb med ændring vis added (grøn "In"), removed (rød "Out"), captainChange; overskrift fra `summarizeDiff`.

- [ ] **Step 7: Verify build**

Run: `cd frontend && npm run build`
Expected: build OK, ingen ESM/import-fejl

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/StrategyPage.jsx frontend/src/components/racehub/strategy/
git commit -m "feat(race-hub): Holdstrategi-flade (A-kæde, roller, kaptajn-board, mål-løb, preview) (S3)"
```

---

### Task 14: Route + link

**Files:**
- Modify: `frontend/src/App.jsx`, `frontend/src/components/racehub/RaceHubBoard.jsx`

- [ ] **Step 1: Add lazy import** (App.jsx, nær linje 56):
```jsx
const StrategyPage = lazy(() => import("./pages/StrategyPage"));
```

- [ ] **Step 2: Add route** (App.jsx, lige FØR `races/:raceId`, linje ~188):
```jsx
            <Route path="races/strategy" element={<StrategyPage />} />
```

- [ ] **Step 3: Add link from board** (RaceHubBoard.jsx — i heading-rækken, linje ~159-162) tilføj en `<Link to="/races/strategy">{t("strategy.open")}</Link>` (import `Link` fra react-router-dom).

- [ ] **Step 4: Verify build + commit**

Run: `cd frontend && npm run build`
```bash
git add frontend/src/App.jsx frontend/src/components/racehub/RaceHubBoard.jsx
git commit -m "feat(race-hub): rute /races/strategy + link fra board (S3)"
```

---

## Phase F — Docs + verifikation

### Task 15: Patch notes + help.json + FEATURE_STATUS

**Files:**
- Modify: `frontend/src/data/patchNotes.js`, `frontend/public/locales/{en,da}/help.json`, `docs/FEATURE_STATUS.md`

- [ ] **Step 1: Patch note** — tilføj ny version-blok øverst i `patchNotes.js` (mønster fra eksisterende; en+da body). Indhold: "Team strategy — set a ranked A-chain, fixed roles, captains per terrain, and target races; the assistant uses them to build your lineups. Preview how it changes selections before saving."

- [ ] **Step 2: help.json (en+da)** — læs eksisterende race-hub-sektion (`sections`), tilføj en `strategy`-undersektion med titel + tekst der forklarer de 4 byggeklodser + at det fodrer assistenten. Tilføj 1 FAQ-entry ("How do I make the assistant pick my best riders for big races?").

- [ ] **Step 3: FEATURE_STATUS.md** — tilføj Lag 0 Holdstrategi-flade + 3 endpoints + 2 tabeller under race-hub-afsnittet.

- [ ] **Step 4: Verify help.json paritet + patchNotes-test**

Run: `cd frontend && node --test src/lib/patchNotes.test.js src/lib/patchNotes.data.test.js && node -e "require('./public/locales/en/help.json');require('./public/locales/da/help.json');console.log('help json ok')"`
Expected: PASS + `help json ok`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data/patchNotes.js frontend/public/locales/en/help.json frontend/public/locales/da/help.json docs/FEATURE_STATUS.md
git commit -m "docs(race-hub): patch notes + help + FEATURE_STATUS for Holdstrategi (S3)"
```

---

### Task 16: Fuldt CI-gate-sæt + Playwright

- [ ] **Step 1: Full local gate**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests + frontend-tests + frontend-build alle grønne

- [ ] **Step 2: Lint + i18n-leak + tone + warning-budget**

Run: `cd frontend && npm run lint` (+ projektets i18n-leak/tone/warning-budget-scripts hvis separate — se CLAUDE.md pkt. 4)
Expected: ingen fejl

- [ ] **Step 3: Playwright core-smoke (alle 3 projekter) + snapshot-refresh hvis visuel diff**

Run: `cd frontend && npx playwright test core-smoke.spec.js`
Hvis nye snapshots/visuel diff: `npx playwright test core-smoke --update-snapshots` (win32, alle 3) → commit PNG'erne.

- [ ] **Step 4: Logget-ind Playwright-verifikation af /races/strategy** (fixtures-mock) — skriv en lille spec der mocker `/api/races/strategy` og asserterer at fladen renderer A-kæde + kaptajn-board; tag umasket screenshot som bevis.

- [ ] **Step 5: Commit (snapshots/test hvis nye)**

```bash
git add frontend/tests frontend/**/__screenshots__ 2>/dev/null; git commit -m "test(race-hub): Holdstrategi playwright-verify + snapshots (S3)" || echo "intet at committe"
```

---

### Task 17: Adversariel idempotens-verifikation (ultracode-workflow) + PR

- [ ] **Step 1:** Kør ultracode-workflow: (a) blast-radius af generator-integrationen (alle kaldssteder af `assignTeamAcrossRaces`/`autopickTeamSelection`/`runRaceEntryGenerator`), (b) uafhængig refutation af `strategy=null ≡ uændret` mod en prod-lignende fixture. Se hovedsessionens Workflow-kald.

- [ ] **Step 2:** Push branch + opret PR med fuld Brugerverifikation-sektion (`- [ ]`-tjekliste). Markér tydeligt: **indeholder `database/*.sql` → EJER MERGER** (auto-applies i prod). Refs race-hub epic / S3.

- [ ] **Step 3:** Efter ejer-merge: markér issue `claude:todo`→`claude:done`; opdatér `docs/NOW.md` (Next action → S4 eller S7; Working agent → Ingen aktiv session).

---

## Self-Review (udført)

**Spec-dækning:** L1-L8 + §3 (migration T4) + §4 (terrainBucket T1) + §5 (autopick T2 / assign T3) + §6 (generator T6/T7) + §7 (endpoints T8/T9/T10) + §8 (frontend T11-14) + §9 (genbrug — refereret i T2/T11) + §10 (idempotens-tests T2/T3/T6) + §11 (out of scope, ingen task) + §12 (proces T15-17). Alle dækket.

**Placeholder-scan:** Ingen TBD/TODO. UI-subkomponenter (T13 step 2-6) er beskrevet med eksakt ansvar + hvilke pure helpers de bruger; orkestratoren (step 1) har fuld kode. Mekaniske i18n/help/patch-tasks har konkret indhold + paritets-verifikation.

**Type-konsistens:** `preference`-objektets felter (`aChain`, `captains`, `roleRules`, `isTargetRace`) er identiske i T2 (autopick) og T3 (assign udleder dem). `strategy`-objektet (`aChain`, `captainPriorities`, `roleRules`, `targetRaceIds:Set`) konsistent i T3/T5/T6. `diffAssignments`-output (`added`/`removed`/`captainChange`) konsistent i T5 (backend) og T11 (`summarizeDiff`). `TERRAIN_BUCKETS` ens i raceTerrain.js + strategyLogic.js (verificeret i T1+T11-tests).
