import test from "node:test";
import assert from "node:assert/strict";

import {
  STARTER_SQUAD,
  allocateStarterSquads,
  computeAge,
  runStarterSquadAllocation,
} from "./starterSquadAllocator.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";

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

test("runStarterSquadAllocation: dryRun skriver intet; apply skriver team_id pr. tildeling", async () => {
  const riders = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `young-${i}`, birthdate: "2006-01-01", potentiale: 5, base_value: 800000 - i })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `dom-${i}`, birthdate: "1999-01-01", potentiale: 3, base_value: 300000 - i })),
  ];
  const updates = [];
  const supabase = {
    from() {
      const api = {
        select() { return api; },
        is() { return api; },
        eq() { return api; },
        order() { return api; },
        range() { return Promise.resolve({ data: riders, error: null }); },
        update(patch) { return { eq(_c, id) { updates.push({ id, ...patch }); return Promise.resolve({ error: null }); } }; },
      };
      return api;
    },
  };
  const getManagerTeams = async () => [{ id: "t1" }, { id: "t2" }];

  const dry = await runStarterSquadAllocation(supabase, { dryRun: true, seed: 2026, getManagerTeams });
  assert.equal(dry.teams, 2);
  assert.equal(dry.assigned, 0);
  assert.equal(updates.length, 0);

  const applied = await runStarterSquadAllocation(supabase, { dryRun: false, seed: 2026, getManagerTeams });
  assert.equal(applied.assigned, 2 * STARTER_SQUAD.SQUAD_SIZE);
  assert.equal(updates.length, 2 * STARTER_SQUAD.SQUAD_SIZE);
  assert.ok(updates.every((u) => u.team_id === "t1" || u.team_id === "t2"));
});
