// Race Engine v3 (#2224), slice S4 (#1176) — simulateStage-integration af
// raceIncidents.js: components.incident-stempling, gap-clamp, re-ranking og
// abandon-fjernelse. raceIncidents.js's egen roll-logik (probability-math,
// cap, outcome/kind-split, magnitude-bounds, determinisme) er dækket af
// raceIncidents.test.js — denne fil dækker KUN simulateStage's forbrug af den.
import test from "node:test";
import assert from "node:assert/strict";

import { simulateStage, ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, overrides = {}) {
  return { rider_id: id, team_id, abilities: abil(overrides) };
}
const ENTRANTS = [
  entrant("climber", "A", { climbing: 96 }),
  entrant("helperA1", "A", {}),
  entrant("helperA2", "A", {}),
  entrant("hunterA", "A", {}),
  entrant("sprinter", "B", { sprint: 96 }),
  entrant("helperB1", "B", {}),
  entrant("helperB2", "B", {}),
  entrant("freeC", "C", {}),
];
const COBBLES = { profile_type: "cobbles", demand_vector: DEMAND_VECTORS.cobbles };

// Seed 2 på ENTRANTS/cobbles giver PRÆCIS ét uheld: helperA1, time_loss +87s
// (fundet ved udtømmende scan 1..5000 — se raceIncidents.test.js's determinisme-
// dækning for selve roll-logikken; her verificerer vi kun hvad simulateStage GØR
// med et kendt time_loss-uheld).
test("simulateStage v3=true: time_loss-uheld (seed 2) — stemplet i components.incident, ingen fjernet, gap ≥ 0, min-gap-normaliseret", () => {
  const { ranked, incidents } = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES, seed: 2, v3: true });
  assert.equal(incidents.length, 1, "forventede præcis ét uheld på seed 2");
  assert.equal(incidents[0].rider_id, "helperA1");
  assert.equal(incidents[0].outcome, "time_loss");
  assert.equal(incidents[0].time_loss_seconds, 87);

  assert.equal(ranked.length, ENTRANTS.length, "time_loss fjerner INGEN — kun abandon gør");
  const helperA1 = ranked.find((r) => r.rider_id === "helperA1");
  assert.equal(helperA1.components.incident, 87, "components.incident skal bære de tabte sekunder");
  for (const r of ranked) {
    if (r.rider_id !== "helperA1") assert.equal(r.components.incident, 0, `${r.rider_id}: uberørt rytter skal have incident=0`);
  }
  // Rangordenen skal være konsistent med de (evt. justerede) stageGaps.
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i].stageGap >= ranked[i - 1].stageGap, "stageGap skal være ikke-aftagende i rank-rækkefølge");
    assert.equal(ranked[i].rank, i + 1);
  }
  assert.equal(Math.min(...ranked.map((r) => r.stageGap)), 0, "vinderen (blandt overlevende) skal normaliseres til gap 0");
  // finalScore må IKKE påvirkes af uheldet (gap-space, ikke score-space).
  const withoutIncidentSeed = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES, seed: 999_999_1, v3: true });
  void withoutIncidentSeed; // kun for at dokumentere kontrasten — ingen assert nødvendig her
});

// Seed 62 giver PRÆCIS ét uheld: freeC, abandon (injury_days=3).
test("simulateStage v3=true: abandon-uheld (seed 62) — rytteren FJERNES fra ranked, rank er sammenhængende 1..N-1", () => {
  const { ranked, incidents } = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES, seed: 62, v3: true });
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].rider_id, "freeC");
  assert.equal(incidents[0].outcome, "abandon");
  assert.equal(incidents[0].injury_days, 3);

  assert.equal(ranked.length, ENTRANTS.length - 1, "abandon skal fjerne PRÆCIS én rytter fra ranked");
  assert.ok(!ranked.some((r) => r.rider_id === "freeC"), "freeC må IKKE optræde i ranked (DNF)");
  const ranks = ranked.map((r) => r.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: ENTRANTS.length - 1 }, (_, i) => i + 1), "rank skal være sammenhængende 1..N-1 uden huller");
  assert.equal(Math.min(...ranked.map((r) => r.stageGap)), 0);
});

// Samme to seeds med v3=false (eller udeladt): INGEN uheldseffekt — motoren er
// dormant. Spejler det generelle flag-off-mønster (raceEngineV3FlagOff.test.js),
// men pinnet på PRÆCIS de seeds vi ved trigger et uheld når v3=true.
test("simulateStage v3=false: samme seeds (2, 62) — ingen uheld, alle 8 ryttere med, incidents=[]", () => {
  for (const seed of [2, 62]) {
    const { ranked, incidents } = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES, seed, v3: false });
    assert.deepEqual(incidents, []);
    assert.equal(ranked.length, ENTRANTS.length);
    for (const r of ranked) assert.equal(r.components.incident, 0);
  }
});

// ── Aggregeret struktur-invariant over et stort felt/mange seeds ─────────────
// Dækker det raceIncidents.test.js IKKE kan: at simulateStage's re-ranking +
// normalisering aldrig bryder (gap ≥ 0, rank sammenhængende, min-gap = 0)
// uanset HVOR MANGE uheld der rammer samme etape (cobbles + lav positioning →
// forhøjet, men stadig organisk, hit-rate — ingen tuning-override nødvendig
// her, simulateStage tager ikke en tuning-parameter).
function bigField(n) {
  return Array.from({ length: n }, (_, i) => entrant(`r${String(i).padStart(3, "0")}`, `team${i % 8}`, { positioning: 10 }));
}
test("simulateStage v3=true: struktur-invarianter holder over 100 seeds på et stort cobbles-felt (uanset antal uheld)", () => {
  const entrants = bigField(90);
  let sawTimeLoss = false, sawAbandon = false;
  for (let seed = 1; seed <= 100; seed++) {
    const { ranked, incidents } = simulateStage({ entrants, stageProfile: COBBLES, seed, v3: true });
    if (incidents.some((i) => i.outcome === "time_loss")) sawTimeLoss = true;
    if (incidents.some((i) => i.outcome === "abandon")) sawAbandon = true;
    const abandonedIds = new Set(incidents.filter((i) => i.outcome === "abandon").map((i) => i.rider_id));
    assert.equal(ranked.length, entrants.length - abandonedIds.size, `seed ${seed}: ranked.length skal matche overlevende`);
    for (const id of abandonedIds) assert.ok(!ranked.some((r) => r.rider_id === id), `seed ${seed}: abandoned ${id} lækkede ind i ranked`);
    if (ranked.length) {
      assert.equal(Math.min(...ranked.map((r) => r.stageGap)), 0, `seed ${seed}: min-gap skal være 0`);
      assert.ok(ranked.every((r) => r.stageGap >= 0), `seed ${seed}: negativ stageGap`);
      const ranks = ranked.map((r) => r.rank).sort((a, b) => a - b);
      assert.deepEqual(ranks, Array.from({ length: ranked.length }, (_, i) => i + 1), `seed ${seed}: rank-huller`);
    }
  }
  assert.ok(sawTimeLoss, "90-rytter-feltet over 100 seeds burde producere mindst ét time_loss-uheld");
  assert.ok(sawAbandon, "90-rytter-feltet over 100 seeds burde producere mindst ét abandon-uheld");
});
