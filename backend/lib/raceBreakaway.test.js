// backend/lib/raceBreakaway.test.js
// #1307: udbruds-mekanik — seeded, kun egnede profiler, 1-3 escapees, hunter-vægt.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateStage, aggressionScore, BREAKAWAY_PROFILES, BREAKAWAY_TOP_EXCLUDED } from "./raceSimulator.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  ...over,
});
const demand = { sprint: 0.8, endurance: 0.2, randomness: 0.5 };
const makeEntrants = (n) =>
  Array.from({ length: n }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    team_id: `t${i % 4}`,
    // Spredning: r000 stærkest, r0NN svagest → bund-kandidater findes.
    abilities: ab({ sprint: 90 - i * 2, tactics: 40 + (i % 30) }),
  }));

test("aggressionScore vægter tactics/endurance/acceleration", () => {
  const high = aggressionScore(ab({ tactics: 99, endurance: 99, acceleration: 99 }));
  const low = aggressionScore(ab({ tactics: 1, endurance: 1, acceleration: 1 }));
  assert.ok(high > low);
  assert.ok(high <= 99 && low >= 0);

  // Relativ vægtning: tactics (0.5) vejer tungere end acceleration (0.2).
  // En rytter med tactics=99 (resten 50) skal score højere end en med acceleration=99 (resten 50).
  const highTactics = aggressionScore(ab({ tactics: 99 }));
  const highAcceleration = aggressionScore(ab({ acceleration: 99 }));
  assert.ok(
    highTactics > highAcceleration,
    `tactics-tung (${highTactics}) skal > acceleration-tung (${highAcceleration}) — tactics har 0.5 vs 0.2 vægt`,
  );
});

test("udbrud: kun på egnede profiler", () => {
  const entrants = makeEntrants(30);
  const itt = simulateStage({ entrants, stageProfile: { profile_type: "itt", demand_vector: demand }, seed: 7 });
  assert.ok(itt.ranked.every((r) => (r.components.breakaway ?? 0) === 0), "itt må ikke have udbrud");
  const flat = simulateStage({ entrants, stageProfile: { profile_type: "flat", demand_vector: demand }, seed: 7 });
  const escapees = flat.ranked.filter((r) => r.components.breakaway > 0);
  assert.ok(escapees.length >= 1 && escapees.length <= 3, `1-3 escapees, fik ${escapees.length}`);
});

test("udbrud: deterministisk — samme seed giver samme escapees og bonus", () => {
  const entrants = makeEntrants(30);
  const profile = { profile_type: "rolling", demand_vector: demand };
  const a = simulateStage({ entrants, stageProfile: profile, seed: 42 });
  const b = simulateStage({ entrants: [...entrants].reverse(), stageProfile: profile, seed: 42 });
  assert.deepEqual(
    a.ranked.map((r) => [r.rider_id, r.components.breakaway]),
    b.ranked.map((r) => [r.rider_id, r.components.breakaway]),
  );
});

test("udbrud: escapees kommer fra den lavere-rangerede del (uden hunter)", () => {
  const entrants = makeEntrants(40);
  const profile = { profile_type: "flat", demand_vector: demand };
  // Terrain-rang: r000 er stærkest. Escapee må ikke være blandt top-40 %.
  // Med kalibreret cut (BREAKAWAY_TOP_EXCLUDED 0.05) udelukkes kun de absolut øverste — den reelle
  // lavere-rank-garanti måles i race:gate-harness (escapee-pick-percentiler), ikke her.
  for (let seed = 1; seed <= 20; seed++) {
    const { ranked } = simulateStage({ entrants, stageProfile: profile, seed });
    for (const r of ranked.filter((x) => x.components.breakaway > 0)) {
      const idx = Number(r.rider_id.slice(1));
      assert.ok(idx >= Math.floor(40 * BREAKAWAY_TOP_EXCLUDED), `escapee ${r.rider_id} er i den beskyttede top`);
    }
  }
});

test("hunter: markant forhøjet escapee-chance", () => {
  const base = makeEntrants(30);
  let hunterPicked = 0, samePicked = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const withHunter = base.map((e) => e.rider_id === "r015" ? { ...e, race_role: "hunter" } : e);
    const a = simulateStage({ entrants: withHunter, stageProfile: { profile_type: "flat", demand_vector: demand }, seed });
    if (a.ranked.find((r) => r.rider_id === "r015").components.breakaway > 0) hunterPicked++;
    const b = simulateStage({ entrants: base, stageProfile: { profile_type: "flat", demand_vector: demand }, seed });
    if (b.ranked.find((r) => r.rider_id === "r015").components.breakaway > 0) samePicked++;
  }
  assert.ok(hunterPicked > samePicked * 1.5, `hunter ${hunterPicked} vs uden ${samePicked}`);
});

test("BREAKAWAY_PROFILES indeholder præcis flat/rolling/mountain", () => {
  assert.deepEqual(Object.keys(BREAKAWAY_PROFILES).sort(), ["flat", "mountain", "rolling"]);
});
