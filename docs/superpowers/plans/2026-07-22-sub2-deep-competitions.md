# Sub-2: Dybe konkurrencer (passage-lag) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passage-ordener ved stigningstoppe/mellemsprints der uddeler Tour-ægte KOM-/grøn-point + bonussekunder, oven på den frosne motor — persisteret SSOT-korrekt og synligt på etapesiden.

**Architecture:** Nyt rent modul `racePassages.js` efterbehandler `simulateStage`-output (dedikerede rng-strømme — motorens sekvenser er bit-identiske). Aggregater på `race_results`-etaperækker (null = legacy), detalje i ny `race_stage_passages`-tabel. Klassementer akkumulerer fra de persisterede kolonner med legacy-fallback. Data-gated: ingen rutedata → præcis dagens adfærd.

**Tech Stack:** Node ESM (`node --test`), Supabase/Postgres (idempotent .sql-migration, applies post-merge per #2642), React/Vite frontend med direkte Supabase-reads, i18n en+da.

**Spec:** `docs/superpowers/specs/2026-07-22-sub2-deep-competitions-design.md` (ejer-godkendt 22/7). **Issue:** #2770. **Branch:** `feat/2770-deep-competitions` (worktree). **Deadline:** merged + kalibreret før S2-cutover ~27/7.

**Ejer-låst (tunes IKKE):** pointskalaerne §4 i spec. **Tunbart mod scorecard:** kontest-vægt, waypoint-noise, catch-interval.

---

### Task 1: Migration — kolonner, tabel, RLS, RPC

**Files:**
- Create: `database/2026-07-22-race-passages.sql`
- Læs først: `backend/lib/stageResultRpc.js` + find den eksisterende `apply_stage_result`-funktions-SQL i `database/` (grep `apply_stage_result`) — RPC'en indsætter race_results-rækker server-side og skal kende de nye kolonner.

- [ ] **Step 1: Skriv migrationen** (idempotent; tilpas `apply_stage_result`-delen til den FAKTISKE eksisterende funktionskrop — kopier den nuværende krop og tilføj kun de tre kolonner i INSERT-listen):

```sql
-- Sub-2 (#2770): passage-lag — aggregat-kolonner + passage-detalje-tabel.
ALTER TABLE race_results
  ADD COLUMN IF NOT EXISTS sprint_points  integer,
  ADD COLUMN IF NOT EXISTS kom_points     integer,
  ADD COLUMN IF NOT EXISTS bonus_seconds  integer;

CREATE TABLE IF NOT EXISTS race_stage_passages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL DEFAULT 1,
  waypoint_kind text NOT NULL CHECK (waypoint_kind IN ('kom','sprint','finish')),
  waypoint_index integer NOT NULL,
  waypoint_name text,
  waypoint_km numeric,
  climb_category text,
  rider_id uuid,
  rider_name text,
  team_id uuid,
  passage_rank integer NOT NULL,
  points integer NOT NULL DEFAULT 0,
  bonus_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_race_stage_passages_race
  ON race_stage_passages (race_id, stage_number);

ALTER TABLE race_stage_passages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "race_stage_passages_public_read" ON race_stage_passages;
CREATE POLICY "race_stage_passages_public_read" ON race_stage_passages
  FOR SELECT USING (true);
-- Ingen insert/update/delete-policies: kun service_role skriver.

-- apply_stage_result: CREATE OR REPLACE med de 3 nye kolonner i INSERT
-- (kopiér den EKSISTERENDE funktionskrop fra seneste migration og udvid
-- kolonnelisten + jsonb-udpakningen med sprint_points, kom_points, bonus_seconds).
```

- [ ] **Step 2: Verificér idempotens ved gennemlæsning** (dobbelt-kørsel må ikke fejle: IF NOT EXISTS overalt, DROP POLICY IF EXISTS før CREATE POLICY, CREATE OR REPLACE FUNCTION).
- [ ] **Step 3: Commit** — `git add database/2026-07-22-race-passages.sql && git commit -m "feat(db): #2770 passage-kolonner + race_stage_passages (migration, applies post-merge)"`

**VIGTIGT:** Migrationen applies IKKE nu — den committes og Claude applier post-merge (#2642-rammer). Ingen `apply_migration`-kald under implementering.

---

### Task 2: `racePassages.js` — skalaer + kontrakt (TDD)

**Files:**
- Create: `backend/lib/racePassages.js`
- Test: `backend/lib/racePassages.test.js`

- [ ] **Step 1: Skriv failing tests for skalaer + tom-kontrakt:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GREEN_FINISH_SCALES, INTERMEDIATE_SPRINT_SCALE, KOM_SCALES,
  FINISH_BONUS_SECONDS, INTERMEDIATE_BONUS_SECONDS, computePassages,
} from "./racePassages.js";

test("Tour-skalaer er ejer-låste værdier", () => {
  assert.deepEqual(GREEN_FINISH_SCALES.flat, [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(GREEN_FINISH_SCALES.rolling, [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(GREEN_FINISH_SCALES.mountain, [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(INTERMEDIATE_SPRINT_SCALE, [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(KOM_SCALES.HC, [20, 15, 12, 10, 8, 6, 4, 2]);
  assert.deepEqual(KOM_SCALES["1"], [10, 8, 6, 4, 2, 1]);
  assert.deepEqual(KOM_SCALES["4"], [1]);
  assert.deepEqual(FINISH_BONUS_SECONDS, [10, 6, 4]);
  assert.deepEqual(INTERMEDIATE_BONUS_SECONDS, [3, 2, 1]);
});

test("ingen rutedata → tomt resultat (data-gating)", () => {
  const out = computePassages({
    ranked: [{ rider_id: "a", rank: 1, components: { breakaway: 0 } }],
    stageProfile: { profile_type: "flat", stage_number: 1 }, // ingen climbs/sprints/distance_km
    entrants: [{ rider_id: "a", abilities: {} }],
    seed: 42, isStageRace: true,
  });
  assert.deepEqual(out.passages, []);
  assert.equal(out.perRider.size, 0);
});

test("endagsløb → tomt resultat", () => {
  const out = computePassages({
    ranked: [{ rider_id: "a", rank: 1, components: { breakaway: 0 } }],
    stageProfile: { profile_type: "classic", distance_km: 240, climbs: [], sprints: [{ name: "Finish", km: 240, kind: "finish" }], sectors: [] },
    entrants: [{ rider_id: "a", abilities: {} }],
    seed: 42, isStageRace: false,
  });
  assert.deepEqual(out.passages, []);
});
```

- [ ] **Step 2: Kør** `node --test --import ./test-setup.js lib/racePassages.test.js` (fra `backend/`). Expected: FAIL (modul findes ikke).
- [ ] **Step 3: Implementér skalaer + skelet:**

```js
// backend/lib/racePassages.js
// Sub-2 (#2770): passage-lag — ren efterbehandling af simulateStage-output.
// Dedikerede rng-strømme (stableSeed-afledte) → motorens main-rng/noise-sekvens
// er bit-identisk. Ingen DB, ingen Math.random/Date.
import { makeRng, gaussian } from "./fictionalRiderGenerator.js";
import { stableSeed, deriveBreakawayStatus } from "./raceSimulator.js";

// Ejer-låste Tour-skalaer (spec §4, 22/7) — tunes ALDRIG mod scorecard.
export const GREEN_FINISH_SCALES = Object.freeze({
  flat:          Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  cobbles:       Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  rolling:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  hilly:         Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  classic:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  mountain:      Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  high_mountain: Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  itt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  ttt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
});
export const INTERMEDIATE_SPRINT_SCALE = Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
export const KOM_SCALES = Object.freeze({
  HC:  Object.freeze([20, 15, 12, 10, 8, 6, 4, 2]),
  "1": Object.freeze([10, 8, 6, 4, 2, 1]),
  "2": Object.freeze([5, 3, 2, 1]),
  "3": Object.freeze([2, 1]),
  "4": Object.freeze([1]),
});
export const FINISH_BONUS_SECONDS = Object.freeze([10, 6, 4]);
export const INTERMEDIATE_BONUS_SECONDS = Object.freeze([3, 2, 1]);
// Tunbare (scorecard, Task 8):
export const SPRINT_CAPTAIN_CONTEST_MULTIPLIER = 1.15;
export const WAYPOINT_NOISE_SD = 0.03;
export const CATCH_KM_RANGE = Object.freeze([0.55, 0.92]); // andel af distance

export function computePassages({ ranked = [], stageProfile = {}, entrants = [], seed, isStageRace }) {
  const empty = { passages: [], perRider: new Map() };
  if (!isStageRace) return empty;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const sprints = Array.isArray(stageProfile.sprints) ? stageProfile.sprints : [];
  const distance = Number(stageProfile.distance_km);
  // Data-gating: uden rute (ingen distance og ingen waypoints) → legacy.
  if (!Number.isFinite(distance) && climbs.length === 0 && sprints.length === 0) return empty;
  // ... (Task 3-4 fylder ud)
  return empty;
}
```

- [ ] **Step 4: Kør testene igen.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat: #2770 racePassages skalaer + kontrakt`

---

### Task 3: Udbruds-tilstand + waypoint-score (TDD)

**Files:**
- Modify: `backend/lib/racePassages.js`
- Test: `backend/lib/racePassages.test.js`

- [ ] **Step 1: Failing tests — udbruddet fører før catch-punktet; determinisme:**

```js
// Hjælper til testene: 6 ryttere, 2 escapees (b holder hjem, e indhentes).
// components.breakaway > 0 = escapee; e slutter bag ikke-escapees = caught.
function fixture() {
  const ranked = [
    { rider_id: "b", rank: 1, components: { breakaway: 0.2 } },  // escapee, vandt → holdt hjem
    { rider_id: "a", rank: 2, components: { breakaway: 0 } },
    { rider_id: "c", rank: 3, components: { breakaway: 0 } },
    { rider_id: "d", rank: 4, components: { breakaway: 0 } },
    { rider_id: "e", rank: 5, components: { breakaway: 0.1 } },  // escapee, indhentet
    { rider_id: "f", rank: 6, components: { breakaway: 0 } },
  ];
  const entrants = ["a", "b", "c", "d", "e", "f"].map((id) => ({
    rider_id: id, team_id: `t${id}`,
    abilities: { climbing: 60, sprint: 60, punch: 50, acceleration: 50, positioning: 50, endurance: 50 },
  }));
  const stageProfile = {
    stage_number: 3, profile_type: "mountain", finale_type: "descent", distance_km: 170,
    climbs: [
      { name: "Col A", category: "2", crest_km: 60, length_km: 8, avg_gradient: 6, summit_finish: false },
      { name: "Col B", category: "1", crest_km: 150, length_km: 12, avg_gradient: 7.5, summit_finish: false },
    ],
    sprints: [
      { name: "Intermediate Sprint", km: 85, kind: "intermediate" },
      { name: "Finish", km: 170, kind: "finish" },
    ],
    sectors: [],
  };
  return { ranked, entrants, stageProfile };
}

test("escapees passerer først ved tidligt waypoint (km 60 < catch)", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  const komA = out.passages.find((p) => p.kind === "kom" && p.index === 0);
  const first2 = komA.results.slice(0, 2).map((r) => r.rider_id).sort();
  assert.deepEqual(first2, ["b", "e"]); // begge escapees foran feltet ved km 60
  assert.equal(komA.results[0].points, 5); // cat 2-skala: 5/3/2/1
});

test("overlevende escapee fører ved ALLE waypoints; indhentet kun før catch_km", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  for (const p of out.passages.filter((x) => x.kind !== "finish")) {
    assert.equal(p.results[0] && ["b", "e"].includes(p.results[0].rider_id), true);
    // b (survived) er ALTID i front-gruppen:
    const bRank = p.results.find((r) => r.rider_id === "b")?.passage_rank;
    assert.ok(bRank <= 2);
  }
});

test("determinisme: samme input+seed → deep-equal; andet seed → (typisk) andet resultat", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const a = computePassages({ ranked, entrants, stageProfile, seed: 999, isStageRace: true });
  const b = computePassages({ ranked, entrants, stageProfile, seed: 999, isStageRace: true });
  assert.deepEqual(a.passages, b.passages);
});

test("mål-waypoint bruger motorens rangorden — genberegnes ALDRIG", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  const finish = out.passages.find((p) => p.kind === "finish");
  assert.deepEqual(finish.results.map((r) => r.rider_id).slice(0, 3), ["b", "a", "c"]);
  assert.equal(finish.results[0].points, 20); // mountain-målskala
  assert.equal(finish.results[0].bonus_seconds, 10);
  assert.equal(finish.results[1].bonus_seconds, 6);
});

test("mellemsprint giver 20/17/15-point + 3/2/1 bonus", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  const s = out.passages.find((p) => p.kind === "sprint");
  assert.equal(s.results[0].points, 20);
  assert.equal(s.results[0].bonus_seconds, 3);
  assert.equal(s.results[3]?.bonus_seconds ?? 0, 0);
});
```

- [ ] **Step 2: Kør — Expected: FAIL** (computePassages returnerer tomt).
- [ ] **Step 3: Implementér kernen:**

```js
const KOM_BLEND_BIG = { climbing: 0.75, endurance: 0.25 };            // HC/1/2
const KOM_BLEND_SMALL = { climbing: 0.5, punch: 0.35, acceleration: 0.15 }; // 3/4
const SPRINT_BLEND = { sprint: 0.6, acceleration: 0.25, positioning: 0.15 };

function blendScore(abilities, blend) {
  let s = 0;
  for (const [k, w] of Object.entries(blend)) s += ((Number(abilities?.[k]) || 0) / 99) * w;
  return s;
}
function scaleFor(kind, climbCategory, profileType, summitFinish) {
  if (kind === "kom") {
    const base = KOM_SCALES[climbCategory] || [];
    if (summitFinish && (climbCategory === "HC" || climbCategory === "1")) return base.map((p) => p * 2);
    return base;
  }
  if (kind === "sprint") return INTERMEDIATE_SPRINT_SCALE;
  return GREEN_FINISH_SCALES[profileType] || GREEN_FINISH_SCALES.mountain;
}

export function computePassages({ ranked = [], stageProfile = {}, entrants = [], seed, isStageRace }) {
  const empty = { passages: [], perRider: new Map() };
  if (!isStageRace || !ranked.length) return empty;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const sprints = Array.isArray(stageProfile.sprints) ? stageProfile.sprints : [];
  const distance = Number(stageProfile.distance_km);
  if (!Number.isFinite(distance) && climbs.length === 0 && sprints.length === 0) return empty;

  const abilitiesById = new Map(entrants.map((e) => [e.rider_id, e.abilities || {}]));
  const roleById = new Map(entrants.map((e) => [e.rider_id, e.race_role || null]));
  const rankById = new Map(ranked.map((r) => [r.rider_id, r.rank]));
  const bwStatus = deriveBreakawayStatus(ranked);

  // Catch-punkt: dedikeret strøm — indhentede escapees er i front FØR dette km.
  const catchRng = makeRng(stableSeed(`${seed}:catch`));
  const dist = Number.isFinite(distance) ? distance : 200;
  const catchKm = dist * (CATCH_KM_RANGE[0] + (CATCH_KM_RANGE[1] - CATCH_KM_RANGE[0]) * catchRng());

  const inFront = (riderId, km) => {
    const st = bwStatus.get(riderId);
    if (!st?.in_breakaway) return false;
    return st.breakaway_caught ? km < catchKm : true;
  };

  // Waypoint-liste: climbs (kom) + intermediate sprints, sorteret på km; mål til sidst.
  const waypoints = [
    ...climbs.map((c, i) => ({ kind: "kom", index: i, name: c.name, km: c.crest_km, category: c.category, summit_finish: !!c.summit_finish })),
    ...sprints.filter((s) => s.kind === "intermediate").map((s, i) => ({ kind: "sprint", index: i, name: s.name, km: s.km })),
  ].sort((a, b) => a.km - b.km || (a.kind === "kom" ? -1 : 1));
  waypoints.push({ kind: "finish", index: 0, name: "Finish", km: dist });

  const passages = [];
  const perRider = new Map();
  const bump = (riderId, field, v) => {
    if (!v) return;
    if (!perRider.has(riderId)) perRider.set(riderId, { kom_points: 0, sprint_points: 0, bonus_seconds: 0 });
    perRider.get(riderId)[field] += v;
  };

  for (const wp of waypoints) {
    const scale = scaleFor(wp.kind, wp.category, stageProfile.profile_type, wp.summit_finish);
    if (!scale.length) continue;
    let order;
    if (wp.kind === "finish" || wp.summit_finish) {
      // Målorden ER motorens rangering (summit-finish: toppen = stregen).
      order = [...ranked].sort((a, b) => a.rank - b.rank).map((r) => r.rider_id);
    } else {
      const rng = makeRng(stableSeed(`${seed}:wp:${wp.kind}:${wp.index}`));
      const blend = wp.kind === "kom"
        ? (wp.category === "3" || wp.category === "4" ? KOM_BLEND_SMALL : KOM_BLEND_BIG)
        : SPRINT_BLEND;
      // Stabil rider_id-orden for rng-forbrug → determinisme uafhængig af input-orden.
      const scored = [...ranked]
        .sort((a, b) => String(a.rider_id).localeCompare(String(b.rider_id)))
        .map((r) => {
          let s = blendScore(abilitiesById.get(r.rider_id), blend) + gaussian(rng, 0, WAYPOINT_NOISE_SD);
          if (wp.kind === "sprint" && roleById.get(r.rider_id) === "sprint_captain") s *= SPRINT_CAPTAIN_CONTEST_MULTIPLIER;
          return { rider_id: r.rider_id, s, front: inFront(r.rider_id, wp.km) ? 1 : 0 };
        });
      scored.sort((a, b) => b.front - a.front || b.s - a.s || String(a.rider_id).localeCompare(String(b.rider_id)));
      order = scored.map((x) => x.rider_id);
    }
    const results = [];
    for (let i = 0; i < order.length && i < Math.max(scale.length, 3); i++) {
      const points = scale[i] || 0;
      let bonus = 0;
      if (wp.kind === "sprint") bonus = INTERMEDIATE_BONUS_SECONDS[i] || 0;
      if (wp.kind === "finish" && stageProfile.profile_type !== "itt" && stageProfile.profile_type !== "ttt") {
        bonus = FINISH_BONUS_SECONDS[i] || 0;
      }
      if (!points && !bonus) continue;
      results.push({ rider_id: order[i], passage_rank: i + 1, points, bonus_seconds: bonus });
      bump(order[i], wp.kind === "kom" ? "kom_points" : "sprint_points", points);
      bump(order[i], "bonus_seconds", bonus);
    }
    passages.push({ kind: wp.kind, index: wp.index, name: wp.name, km: wp.km, category: wp.category ?? null, results });
  }
  return { passages, perRider };
}
```

**NB (summit-finish + kom_points):** summit-finish-waypointet er et `kom`-waypoint (dobbelt point via `scaleFor`) — mål-waypointet (`finish`) giver grøn-point separat. Begge kører målordenen.

- [ ] **Step 4: Kør alle racePassages-tests. Expected: PASS.** Juster KUN implementering (ikke skala-tests).
- [ ] **Step 5: Ekstra kant-tests (skriv + kør):** summit-finish giver dobbelt HC-point (40 for 1.-passage); rytter uden abilities crasher ikke; `ranked` med 3 ryttere (mindre end skala) uddeler kun 3.
- [ ] **Step 6: Commit** — `feat: #2770 passage-kerne (udbruds-tilstand + waypoint-score)`

---

### Task 4: Klassements-akkumulering læser nye kolonner (TDD)

**Files:**
- Modify: `backend/lib/raceClassifications.js` (accumulateStageRows, ~linje 98-121)
- Test: `backend/lib/raceClassifications.test.js`

- [ ] **Step 1: Failing tests:**

```js
test("accumulateStageRows: nye kolonner driver point/kom/bonus", () => {
  const rows = [
    { stage_number: 1, rider_id: "a", rank: 1, finish_time: "+0:00", sprint_points: 50, kom_points: 0, bonus_seconds: 13 },
    { stage_number: 1, rider_id: "b", rank: 2, finish_time: "+0:10", sprint_points: 30, kom_points: 5, bonus_seconds: 6 },
  ];
  const acc = accumulateStageRows({ stageRows: rows, profileTypeByStage: new Map([[1, "flat"]]) });
  assert.equal(acc.pointsComp.get("a"), 50);
  assert.equal(acc.komComp.get("b"), 5);
  assert.equal(acc.cumTime.get("a"), -13); // 0 gap − 13 bonus
  assert.equal(acc.cumTime.get("b"), 4);   // 10 − 6
});

test("accumulateStageRows: null-kolonner → legacy-adfærd (classPointsForRank + CLIMB_PROFILES)", () => {
  const rows = [
    { stage_number: 1, rider_id: "a", rank: 1, finish_time: "+0:00", sprint_points: null, kom_points: null, bonus_seconds: null },
  ];
  const acc = accumulateStageRows({ stageRows: rows, profileTypeByStage: new Map([[1, "mountain"]]) });
  assert.equal(acc.pointsComp.get("a"), 25); // legacy classPointsForRank(1)
  assert.equal(acc.komComp.get("a"), 25);    // legacy: mountain ∈ CLIMB_PROFILES
  assert.equal(acc.cumTime.get("a"), 0);
});
```

- [ ] **Step 2: Kør → FAIL.**
- [ ] **Step 3: Implementér i `accumulateStageRows`-løkken** (erstat de tre `add(...)`-linjer for points/kom; cumTime-linjen udvides):

```js
    const hasPassageCols = r.sprint_points != null || r.kom_points != null || r.bonus_seconds != null;
    add(cumTime, r.rider_id, parseGapSeconds(r.finish_time) - (Number(r.bonus_seconds) || 0));
    add(posSum, r.rider_id, Number(r.rank) || 0);
    if (hasPassageCols) {
      add(pointsComp, r.rider_id, Number(r.sprint_points) || 0);
      add(komComp, r.rider_id, Number(r.kom_points) || 0);
    } else {
      add(pointsComp, r.rider_id, classPointsForRank(r.rank));
      if (CLIMB_PROFILES.has(profileTypeByStage.get(stageNo))) {
        add(komComp, r.rider_id, classPointsForRank(r.rank));
      }
    }
```

- [ ] **Step 4: Kør raceClassifications-tests → PASS.** Kør OGSÅ hele backend-suiten (`npm test` i `backend/`) — eksisterende tests må ikke knække (rækker uden kolonnerne har `undefined` → legacy-sti).
- [ ] **Step 5: Commit** — `feat: #2770 klassements-akkumulering fra passage-kolonner m. legacy-fallback`

---

### Task 5: raceRunner-integration (begge stier) + persistens (TDD)

**Files:**
- Modify: `backend/lib/raceRunner.js` — `loadStageProfiles` (~440-448), `buildRaceResults` (~182-421), `buildStageRowsAccumulated` (~1272-1417), `loadPriorStageRows` (~1223-1237), `makeResultRowPushers` (~116-155), `simulateRace` (~1034-1215), `simulateStageByIndex` (~1439-1814)
- Test: `backend/lib/raceRunnerPassages.test.js` (NY)

- [ ] **Step 1: Failing tests (mønster fra raceRunner.test.js — rene builds, ingen DB):**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRaceResults } from "./raceRunner.js";
// Byg et 2-etapers stage_race-fixture med rutedata på etaperne (climbs/sprints/
// distance_km som i racePassages.test.js-fixturen) + 6 entrants med abilities.
// Genbrug gerne hjælpere fra raceRunner.test.js (kopier lokalt — ikke import af interne).

test("stage-rækker bærer sprint_points/kom_points/bonus_seconds når rutedata findes", () => {
  const { resultRows } = buildRaceResults({ race, stages, entrants, v3: false });
  const stageRows = resultRows.filter((r) => r.result_type === "stage" && r.stage_number === 1);
  assert.ok(stageRows.every((r) => r.sprint_points != null && r.kom_points != null && r.bonus_seconds != null));
  const winner = stageRows.find((r) => r.rank === 1);
  assert.ok(winner.bonus_seconds >= 10); // 10 mål-bonus (+ evt. mellemsprint)
});

test("passageRows returneres og matcher perRider-aggregaterne", () => {
  const { resultRows, passageRows } = buildRaceResults({ race, stages, entrants, v3: false });
  assert.ok(passageRows.length > 0);
  const agg = new Map();
  for (const p of passageRows.filter((x) => x.stage_number === 1)) {
    const cur = agg.get(p.rider_id) || 0;
    agg.set(p.rider_id, cur + p.bonus_seconds);
  }
  const stageRows = resultRows.filter((r) => r.result_type === "stage" && r.stage_number === 1);
  for (const r of stageRows) assert.equal(r.bonus_seconds, agg.get(r.rider_id) || 0);
});

test("motorens rangering er BIT-IDENTISK med/uden passage-lag (deep-equal på ranked-ordenen)", () => {
  // Kør buildRaceResults på fixture MED rutedata og på klon UDEN rutedata
  // (samme seeds): stage-rækkernes (rider_id, rank, finish_time) skal være ens.
  const withRoutes = buildRaceResults({ race, stages, entrants, v3: false });
  const bare = buildRaceResults({ race, stages: stagesUdenRuteFelter, entrants, v3: false });
  const key = (rows) => rows.filter((r) => r.result_type === "stage").map((r) => `${r.stage_number}:${r.rank}:${r.rider_id}:${r.finish_time}`);
  assert.deepEqual(key(withRoutes.resultRows), key(bare.resultRows));
});

test("uden rutedata: kolonner er null (legacy) og passageRows tom", () => {
  const { resultRows, passageRows } = buildRaceResults({ race, stages: stagesUdenRuteFelter, entrants, v3: false });
  assert.deepEqual(passageRows, []);
  const s = resultRows.find((r) => r.result_type === "stage");
  assert.equal(s.sprint_points ?? null, null);
});

test("GC afspejler bonussekunder (vinder af tæt løb m. bonus)", () => {
  // Fixture hvor to ryttere ender tids-lige på gaps, men #2 har flere bonussekunder
  // → #2 skal stå øverst i gc-result_type-rækkerne.
});
```

- [ ] **Step 2: Kør → FAIL.**
- [ ] **Step 3: Implementér — præcise ændringer:**

1. `loadStageProfiles` SELECT udvides: `"stage_number, profile_type, finale_type, demand_vector, distance_km, elevation_gain_m, climbs, sprints, sectors"`.
2. `makeResultRowPushers` → `pushIndiv` får optionelle felter `sprint_points = null, kom_points = null, bonus_seconds = null` og lægger dem på rækken.
3. `buildRaceResults`: efter `simulateStage` (linje ~299) + `deriveBreakawayStatus`:
```js
      const passage = computePassages({ ranked, stageProfile: stage, entrants: simEntrants, seed: stageSeed, isStageRace });
      const pr = (riderId) => passage.perRider.get(riderId) || null;
```
   - Stage-række-push (~383-385): spread `...(pr(r.rider_id) ? { sprint_points: pr(r.rider_id).sprint_points, kom_points: pr(r.rider_id).kom_points, bonus_seconds: pr(r.rider_id).bonus_seconds } : {})` — VIGTIGT: når passage-laget er aktivt for etapen skal rækker for ryttere UDEN passage-point bære `0`-værdier (ikke null): brug `passage.passages.length > 0` som etape-niveau-gate.
   - In-memory-akkumulering (~341-342): når `passage.passages.length > 0` → `add(pointsComp, r.rider_id, agg.sprint_points)` / `add(komComp, r.rider_id, agg.kom_points)` i stedet for `classPointsForRank`; cumTime-akkumuleringen trækker `agg.bonus_seconds` fra.
   - Saml `passageRows` (map af passage.passages → tabelrækker med race_id/stage_number/rider_name/team_id fra `byId`); returnér `{ resultRows, passageRows, runs, ... }`.
4. `buildStageRowsAccumulated` (~1319-1349): samme mønster (single stage). `loadPriorStageRows`-SELECT udvides med `, sprint_points, kom_points, bonus_seconds` (akkumuleringen i raceClassifications håndterer resten — Task 4).
5. Persistens:
   - `simulateRace`: efter `applyRaceResults` (~1111-1120) → `persistPassages(supabase, race.id, stagesInRun, passageRows)`: `delete().eq("race_id", ...).in("stage_number", ...)` + insert (chunked à 500). Mønster: kopier `persistIncidents`.
   - `simulateStageByIndex`: efter `applyStageResultAtomic` (~1643-1649), sammen med `persistRuns`/`persistIncidents` (~1668-1677): samme `persistPassages` for dagens etape.
6. `simulateStage`-kaldets `stageProfile` er nu det FULDE profil-objekt inkl. rutefelter — motoren ignorerer dem (ingen læsning i Sub-2) → bit-identisk pr. konstruktion.

- [ ] **Step 4: Kør nye tests + HELE backend-suiten → PASS.** Særligt: `raceRunner.test.js`-result_type-allowlisten (linje 15-18) må ikke knække — passage-detaljen er i EGEN tabel, ingen nye result_types.
- [ ] **Step 5: Verificér RPC-kontrakten:** læs `backend/lib/stageResultRpc.js` — hvis `apply_stage_result` enumererer kolonner i sin jsonb-udpakning, SKAL Task 1-migrationen indeholde den opdaterede funktionskrop. Skriv en kommentar i migrationen der matcher det fundne.
- [ ] **Step 6: Commit** — `feat: #2770 passage-lag koblet i raceRunner (begge stier) + persistens`

---

### Task 6: Frontend — passage-liste på etapesiden (en+da)

**Files:**
- Modify: `frontend/src/pages/RaceDetailPage.jsx` (loadAll ~161-250; stage-tab-rendering)
- Create: `frontend/src/lib/raceStagePassages.js` + `frontend/src/lib/raceStagePassages.test.js`
- Modify: `frontend/public/locales/en/races.json` + `frontend/public/locales/da/races.json`

- [ ] **Step 1: Failing unit-test for grupperings-lib:**

```js
// frontend/src/lib/raceStagePassages.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPassagesForStage } from "./raceStagePassages.js";

test("grupperer passage-rækker pr. waypoint i km-orden, finish sidst", () => {
  const rows = [
    { stage_number: 2, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 85, rider_id: "a", rider_name: "A", passage_rank: 1, points: 20, bonus_seconds: 3 },
    { stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col A", waypoint_km: 60, climb_category: "2", rider_id: "b", rider_name: "B", passage_rank: 1, points: 5, bonus_seconds: 0 },
    { stage_number: 1, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "X", waypoint_km: 50, rider_id: "c", rider_name: "C", passage_rank: 1, points: 2, bonus_seconds: 0 },
  ];
  const groups = groupPassagesForStage(rows, 2);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].waypoint_name, "Col A"); // km 60 før km 85
  assert.equal(groups[0].results[0].rider_name, "B");
});
```

- [ ] **Step 2: Kør (`npm test` i `frontend/`) → FAIL. Implementér `groupPassagesForStage(rows, stageNumber)`** (filter på stage, group på `${kind}:${index}`, sortér på km med finish sidst, results på passage_rank). → PASS.
- [ ] **Step 3: Fetch + render:** i `loadAll` tilføj parallel Supabase-query `from("race_stage_passages").select("*").eq("race_id", raceId).order("stage_number").order("waypoint_km")` (via `fetchAllRows`-hjælperen som race_results). Render i stage-fanen (under stage-resultattabellen, kun når grupper findes): pr. waypoint en kompakt blok — titel `"{name} ({category}) — km {km}"` for kom / `"{name} — km {km}"` for sprint, dernæst top-3 linjer `"1. {rider_name} {points}p [+{bonus}s]"`. Følg eksisterende styling-mønstre i filen (ingen nye design-elementer, anti-slop).
- [ ] **Step 4: i18n-keys** i `races.json` (en FØRST, da under — nøjagtig samme nøglestruktur i begge filer), fx:
```json
"detail": { "passages": {
  "title": "Intermediate results",
  "kom": "KOM",
  "sprint": "Intermediate sprint",
  "points": "{{count}} pts",
  "bonus": "+{{count}}s"
} }
```
  (da: "Mellemresultater", "Bjergspurt", "Mellemsprint", "{{count}} point", "+{{count}}s".)
- [ ] **Step 5: Kør frontend-pre-flight:** `npm run lint` + `node --test` + build i `frontend/` (jf. CLAUDE.md pkt. 4 — lint er OBLIGATORISK før push). Mock-baseret Playwright: udvid `frontend/tests/e2e/race-detail.spec.js` med `**/rest/v1/race_stage_passages?**`-intercept (tom liste + liste med 2 waypoints; assert renderede navne). Kør `npx playwright test race-detail.spec.js`.
- [ ] **Step 6: Commit** — `feat: #2770 passage-liste paa etapesiden (en+da)`

---

### Task 7: Patch notes + help (en+da)

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (prepend version "7.40" — tjek at 7.40 ikke allerede er taget; ellers næste)
- Modify: `frontend/public/locales/en/help.json` + `frontend/public/locales/da/help.json`

- [ ] **Step 1: Patch note** (category "new", audience "player", topic "Races", refs [2770]): EN-titel "Deep race competitions: KOM, sprints and bonus seconds", body forklarer kort: kategoriserede stigninger giver KOM-point (Tour-skalaer, dobbelt ved summit-finish), mellemsprints giver grøn-point + 3/2/1 bonus, etapemål giver 10/6/4 bonus til GC — fra sæson 2. DA-oversættelse under.
- [ ] **Step 2: Help-sektion:** udvid den eksisterende race-/konkurrence-sektion i `help.json` (find den relevante `sections.*`) med et blok-afsnit om trøje-konkurrencerne og bonussekunder (en+da, samme nøgler). Kør `node scripts/i18n-check-keys.mjs`.
- [ ] **Step 3: Kør `node --test` i frontend (PatchNotesPage/HelpPage-tests) + commit** — `docs: #2770 patch notes 7.40 + help (en+da)`

---

### Task 8: Konkurrence-scorecard i harnesset (gate FØR ship)

**Files:**
- Create: `backend/scripts/raceCompetitionScorecard.js`
- Test: `backend/lib/racePassages.test.js` (bånd-hjælpere testes via modul); scriptet selv er runner.

- [ ] **Step 1: Skriv scriptet.** Struktur (genbrug mønstre fra `simulateSeasonDryRun.js`):
  - Population: `generateFictionalRiders` synthetic pyramid (samme som dry-run, `--count=800` default) ELLER `--population=<snapshot>`.
  - Simulér `--gts=12` 21-etapers GT'er pr. seed (`--seeds=2026,7,42`): byg stages via `generateRaceStageProfiles` på et syntetisk GT-race-objekt (giver ÆGTE rutedata via pass 2), fordel entrants som dry-run'ens GT-sektion, kør `buildRaceResults`, aggregér passage/klassements-output.
  - Arketype-klassifikation af vindere: genbrug dry-run'ens arketype-heuristik (sprinter = højeste `sprint`-percentil osv. — kopiér funktionen, eller importér hvis eksporteret).
  - Målinger + bånd (spec §8):
    - `greenWinnerSprinterShare ≥ 0.60` (GT'er med ≥8 flat/rolling-etaper)
    - `komBreakawayPointShare ∈ [0.25, 0.60]` (andel af KOM-point på ikke-summit bjergetaper vundet af ryttere med `in_breakaway=true` den dag)
    - `komWinnerClimberShare ≥ 0.70`
    - `bonusGcFlipShare ≤ 0.15` (GC-vinder ændret ift. samme kørsel uden bonus-fradrag — beregn begge akkumuleringer fra samme rækker)
    - `bonusTop3MarginMedianDelta ≤ 45` (sekunder)
  - `--enforce` → `process.exitCode = 1` ved brud; ellers rapport. Print scorecard-tabel pr. seed + samlet.
- [ ] **Step 2: Tilføj npm-script** i `backend/package.json`: `"race:competitions": "node scripts/raceCompetitionScorecard.js --seeds=2026,7,42 --enforce"`.
- [ ] **Step 3: Kør scriptet.** Ved bånd-brud: tun KUN `SPRINT_CAPTAIN_CONTEST_MULTIPLIER`, `WAYPOINT_NOISE_SD`, `CATCH_KM_RANGE` (skalaerne er ejer-låste). Dokumentér tuning-iterationer i en `KALIBRERINGS-LOG`-kommentar øverst i scriptet (samme konvention som simulateSeasonDryRun.js).
- [ ] **Step 4: Kør `npm run race:gate`** (skal være grønt — motoren er urørt; dette BEVISER det).
- [ ] **Step 5: Commit** — `feat: #2770 konkurrence-scorecard (race:competitions) + kalibrering`

---

### Task 9: Verifikation + PR

- [ ] **Step 1: Fuld lokal verifikation:** `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + frontend-build) + `npm run lint` i frontend + `npm run race:gate` + `npm run race:competitions` i backend.
- [ ] **Step 2: PR** fra `feat/2770-deep-competitions` mod main. Body = PULL_REQUEST_TEMPLATE med Brugerverifikation-sektion; inkludér scorecard-tal (alle seeds) + eksplicit "motor bit-identisk: raceRunnerPassages deep-equal-test + race:gate grøn". Refs #2770.
- [ ] **Step 3: Efter merge (Fable/arkitekt-sessionen, IKKE worker):** apply migrationen (idempotent + post-verify: kolonner findes, tabel findes, RLS-policy aktiv, `apply_stage_result` opdateret), flip #2770 → `claude:done`, opdatér NOW.md.

**Post-merge-verify-SQL (køres af arkitekten):**
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name IN ('race_results','race_stage_passages')
   AND column_name IN ('sprint_points','kom_points','bonus_seconds','waypoint_kind');
SELECT polname FROM pg_policy WHERE polrelid = 'race_stage_passages'::regclass;
```

---

## Self-review-noter (plan-forfatter, 22/7)

- Spec-dækning: §3 (Task 2-3), §4 (Task 2), §5 (Task 1+4+5), §6 (data-gating testet Task 3+5), §7 (Task 6, afvigelse: direkte Supabase-read i stedet for backend-endpoint — matcher RaceDetailPage-mønstret, ejer-synligt i PR), §8 (Task 8), patch/help (Task 7).
- Typer konsistente: `computePassages`-kontrakten i Task 2/3/5 matcher; kolonnenavne ens i Task 1/4/5/6.
- PCM-import (`pending_race_results`) rører ikke passage-kolonner → null → legacy-sti (Task 4-test dækker).
