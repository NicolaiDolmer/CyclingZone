import test from "node:test";
import assert from "node:assert/strict";

import {
  STARTER_SQUAD,
  STARTER_POOL_STAT_WINDOW,
  allocateStarterSquads,
  buildWeakStarterPool,
  computeAge,
  runStarterSquadAllocation,
} from "./starterSquadAllocator.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";

// Pool med tydelig struktur: nogle stjerner (højeste base_value, ikke unge),
// rigeligt unge (18-21, høj potentiale, mid base_value) + domestiques (lav).
function makePool({ stars = 4, young = 18, dom = 18 } = {}) {
  const pool = [];
  for (let i = 0; i < stars; i++) pool.push({ id: `star-${i}`, age: 27, potentiale: 5, base_value: 5_000_000 - i });
  for (let i = 0; i < young; i++) pool.push({ id: `young-${i}`, age: 20, potentiale: 5, base_value: 800_000 - i * 100 });
  for (let i = 0; i < dom; i++) pool.push({ id: `dom-${i}`, age: 27, potentiale: 3, base_value: 300_000 - i * 100 });
  return pool;
}

test("STARTER_SQUAD: youth + domestiques = MIN_RIDERS_FOR_RACE", () => {
  assert.equal(STARTER_SQUAD.YOUTH_PER_TEAM + STARTER_SQUAD.DOMESTIQUE_PER_TEAM, STARTER_SQUAD.SQUAD_SIZE);
  assert.equal(STARTER_SQUAD.SQUAD_SIZE, MIN_RIDERS_FOR_RACE);
});

test("computeAge regner alder ud fra birthdate vs referenceår", () => {
  assert.equal(computeAge("2005-03-01", 2026), 21);
  assert.equal(computeAge("2000-12-31", 2026), 26);
});

test("hver manager får præcis SQUAD_SIZE ryttere, ingen overlap", () => {
  const teamIds = ["t1", "t2", "t3"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const { assignments, leftToMarket } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  for (const t of teamIds) assert.equal(assignments[t].length, STARTER_SQUAD.SQUAD_SIZE);
  const assigned = teamIds.flatMap((t) => assignments[t]);
  assert.equal(new Set(assigned).size, assigned.length, "ingen rytter på to hold");
  assert.equal(assigned.length + leftToMarket.length, pool.length);
});

test("stjerner (top base_value) forhåndstildeles ALDRIG — bliver i markedet", () => {
  const teamIds = ["t1", "t2"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const starCount = Math.floor(pool.length * STARTER_SQUAD.STAR_CUTOFF_FRACTION);
  const starIds = [...pool].sort((a, b) => b.base_value - a.base_value).slice(0, starCount).map((r) => r.id);
  const { assignments } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  const assigned = new Set(teamIds.flatMap((t) => assignments[t]));
  for (const id of starIds) assert.ok(!assigned.has(id), `stjerne ${id} må ikke tildeles`);
});

test("komposition: YOUTH_PER_TEAM unge + DOMESTIQUE_PER_TEAM domestiques pr. hold (rigelige pools)", () => {
  const teamIds = ["t1", "t2"];
  const pool = makePool({ stars: 4, young: 20, dom: 20 });
  const { assignments } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  for (const t of teamIds) {
    const ids = assignments[t];
    const young = ids.filter((id) => id.startsWith("young-")).length;
    const dom = ids.filter((id) => id.startsWith("dom-")).length;
    assert.equal(young, STARTER_SQUAD.YOUTH_PER_TEAM, `${t} unge`);
    assert.equal(dom, STARTER_SQUAD.DOMESTIQUE_PER_TEAM, `${t} domestiques`);
  }
});

test("top-up: skæv pool (få unge) giver stadig SQUAD_SIZE pr. hold", () => {
  const teamIds = ["t1", "t2"];
  const pool = makePool({ stars: 2, young: 2, dom: 40 }); // kun 2 unge til 8 youth-slots
  const { assignments } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  for (const t of teamIds) assert.equal(assignments[t].length, STARTER_SQUAD.SQUAD_SIZE);
});

test("seeded: samme seed → identisk allokering (dry-run = apply)", () => {
  const teamIds = ["t1", "t2", "t3"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const a = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  const b = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  assert.deepEqual(a.assignments, b.assignments);
});

test("fairness: holdenes samlede base_value-spænd ≤ tolerance", () => {
  const teamIds = ["t1", "t2", "t3"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const { stats } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  assert.ok(stats.maxSquadBaseValue - stats.minSquadBaseValue <= stats.fairnessTolerance,
    `spænd ${stats.maxSquadBaseValue - stats.minSquadBaseValue} > tolerance ${stats.fairnessTolerance}`);
});

// #1487: svag dedikeret start-pool. Stats clampes ind i [50,57] FØR derivation,
// så afledte styrke-evner lander ~5-21 (dybe domestikker, ingen stjerner).
test("buildWeakStarterPool: alle stats clampet til vinduet, pcm_id null, korrekt antal (#1487)", () => {
  // Fake-generator returnerer stærke ryttere (stats 80) → SKAL clampes ned til hi.
  const fakeGenerate = ({ count }) => ({
    riders: Array.from({ length: count }, (_, i) => ({
      pcm_id: null, firstname: `F${i}`, lastname: `L${i}`,
      birthdate: "2003-01-01", potentiale: 4,
      ...Object.fromEntries(STAT_KEYS.map((k) => [k, 80])),
      _meta: { age: 23 },
    })),
    coverage: {}, seed: 0,
  });
  const pool = buildWeakStarterPool({ count: 40, seed: 2026, referenceYear: 2026, generate: fakeGenerate });
  assert.equal(pool.length, 40);
  for (const r of pool) {
    assert.equal(r.pcm_id, null);
    assert.ok(!("_meta" in r), "_meta må ikke med i insert-payload");
    for (const k of STAT_KEYS) {
      assert.ok(
        r[k] >= STARTER_POOL_STAT_WINDOW.lo && r[k] <= STARTER_POOL_STAT_WINDOW.hi,
        `${k}=${r[k]} udenfor [${STARTER_POOL_STAT_WINDOW.lo},${STARTER_POOL_STAT_WINDOW.hi}]`,
      );
    }
  }
});

// FORWARD-GUARD (#1487): den ÆGTE produktions-kæde (rigtig generator → clamp →
// prod-fallback-derivation, dvs. deriveAbilities med tomt fysiologi-objekt) SKAL
// give svage ryttere. Fanger en fremtidig generator-/kalibrerings-ændring der ved
// et uheld gør start-puljen stærk igen. Tærskel 25 = ejer-målet "ingen over ~25".
test("svag start-pulje: afledte styrke-evner forbliver svage (≤25) (#1487 forward-guard)", () => {
  const STAT_DRIVEN = VISIBLE_ABILITIES.filter((k) => k !== "tactics" && k !== "aggression");
  const pool = buildWeakStarterPool({ count: 200, seed: 2026, referenceYear: 2026 });
  let globalMax = 0;
  for (const r of pool) {
    // Prod-fallback-sti (relaunch/akademi): tomt fysiologi-objekt → ingen kontrast.
    const abilities = deriveAbilities({}, r, { asOfYear: 2026 });
    const maxStat = Math.max(...STAT_DRIVEN.map((k) => abilities[k]));
    globalMax = Math.max(globalMax, maxStat);
  }
  assert.ok(globalMax <= 25, `stærkeste styrke-evne ${globalMax} > 25 — start-puljen er ikke længere svag`);
});

test("starCutoffFraction 0: ingen stjerner ekskluderes — også den dyreste allokeres (#1487)", () => {
  const teamIds = ["t1", "t2"]; // 2×8 = 16 slots
  const pool = [
    { id: "rich", age: 27, potentiale: 3, base_value: 9_000_000 },
    ...Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, age: 27, potentiale: 3, base_value: 1000 + i })),
  ];
  const { assignments, leftToMarket } = allocateStarterSquads(pool, teamIds, { seed: 2026, starCutoffFraction: 0 });
  const assigned = new Set(teamIds.flatMap((t) => assignments[t]));
  assert.ok(assigned.has("rich"), "starCutoffFraction 0 → ingen ekskluderes, heller ikke den dyreste");
  assert.equal(assigned.size, 16);
  assert.equal(leftToMarket.length, 0);
});

test("runStarterSquadAllocation (#1487): generér svag pulje, derive (data-hale), tildel team_id", async () => {
  // 2 hold × SQUAD_SIZE = 16 startryttere.
  // Fake-generator: stærke stats (80) som SKAL clampes til vinduets hi før insert.
  const fakeGenerate = ({ count }) => ({
    riders: Array.from({ length: count }, (_, i) => ({
      pcm_id: null, firstname: `F${i}`, lastname: `L${i}`,
      birthdate: i % 2 === 0 ? "2006-01-01" : "1999-01-01",
      potentiale: i % 2 === 0 ? 5 : 3,
      ...Object.fromEntries(STAT_KEYS.map((k) => [k, 80])),
      _meta: { age: 20 },
    })),
    coverage: {}, seed: 0,
  });
  const derived = [];
  const fakeDerive = async (_sb, ids) => { derived.push(...ids); };

  const inserted = [];
  const updates = [];
  const supabase = {
    from() {
      let cols = null;
      let inIds = null;
      const api = {
        select(c) { cols = c; return api; },
        is() { return api; },
        eq() { return api; },
        in(_c, ids) { inIds = ids; return api; },
        order() { return api; },
        range() {
          if (cols && cols.includes("firstname")) return Promise.resolve({ data: [], error: null }); // navne-fetch
          if (inIds) {
            return Promise.resolve({
              data: inIds.map((id) => ({ id, birthdate: "2000-01-01", potentiale: 3, base_value: 5000 })),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        insert(rows) {
          const start = inserted.length;
          inserted.push(...rows);
          return { select() { return Promise.resolve({ data: rows.map((_, i) => ({ id: `weak-${start + i}` })), error: null }); } };
        },
        update(patch) { return { eq(_c, id) { updates.push({ id, ...patch }); return Promise.resolve({ error: null }); } }; },
      };
      return api;
    },
  };
  const getManagerTeams = async () => [{ id: "t1" }, { id: "t2" }];
  const deps = { generate: fakeGenerate, derive: fakeDerive };

  const dry = await runStarterSquadAllocation(supabase, { dryRun: true, seed: 2026, getManagerTeams, deps });
  assert.equal(dry.teams, 2);
  assert.equal(dry.assigned, 0);
  assert.equal(inserted.length, 0, "dry-run indsætter intet");
  assert.equal(updates.length, 0, "dry-run skriver intet");

  const applied = await runStarterSquadAllocation(supabase, { dryRun: false, seed: 2026, getManagerTeams, deps });
  assert.equal(inserted.length, 2 * STARTER_SQUAD.SQUAD_SIZE, "16 svage ryttere indsat");
  for (const r of inserted) {
    for (const k of STAT_KEYS) assert.ok(r[k] <= STARTER_POOL_STAT_WINDOW.hi, `${k} ikke clampet`);
  }
  assert.equal(derived.length, 2 * STARTER_SQUAD.SQUAD_SIZE, "alle nye ryttere derivet (data-hale)");
  assert.equal(applied.assigned, 2 * STARTER_SQUAD.SQUAD_SIZE);
  assert.equal(updates.length, 2 * STARTER_SQUAD.SQUAD_SIZE);
  assert.ok(updates.every((u) => u.team_id === "t1" || u.team_id === "t2"));
});
