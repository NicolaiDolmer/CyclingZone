// backend/scripts/lib/headToHeadObservers.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { RACE_V4_TUNING } from "../../lib/engine/v4/tuning.ts";
import {
  observeStageV4,
  cohesionFraction,
  winnerGroupSize,
  spreadAtRank,
  descentAttackGainStats,
} from "./headToHeadObservers.js";

function ability(overrides = {}) {
  const base = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

test("observeStageV4: hoej-punch rytter vinder punch-etape -> favoriteWon true", () => {
  const results = [
    { rider_id: "strong_puncher", rank: 1, time_seconds: 100, group_id: "g1", status: "finished" },
    { rider_id: "weak_puncher", rank: 2, time_seconds: 110, group_id: "g2", status: "finished" },
  ];
  const entrants = {
    strong_puncher: { abilities: ability({ punch: 90, acceleration: 85, climbing: 70, tactics: 60 }) },
    weak_puncher: { abilities: ability({ punch: 20, acceleration: 20, climbing: 20, tactics: 20 }) },
  };
  const teamByRider = new Map([["strong_puncher", "teamA"], ["weak_puncher", "teamB"]]);
  const obs = observeStageV4({
    results, entrants, teamByRider,
    route: { finale_type: "punch" }, tuning: RACE_V4_TUNING,
    raceId: "race1", terrain: "hilly",
  });
  assert.equal(obs.favoriteId, "strong_puncher");
  assert.equal(obs.favoriteWon, true);
  assert.equal(obs.winnerId, "strong_puncher");
  assert.equal(obs.fieldSize, 2);
});

test("observeStageV4: manglende entrant-abilities udelades stille (ingen kast)", () => {
  const results = [{ rider_id: "ghost", rank: 1, time_seconds: 100, group_id: "g1", status: "finished" }];
  const obs = observeStageV4({
    results, entrants: {}, teamByRider: new Map(),
    route: { finale_type: "punch" }, tuning: RACE_V4_TUNING, raceId: "r", terrain: "hilly",
  });
  assert.equal(obs.favoriteId, null);
  assert.equal(obs.winnerId, "ghost");
});

test("observeStageV4: tom results-liste giver den tomme-kontrakt (samme shape som raceDominanceMetrics)", () => {
  const obs = observeStageV4({ results: [], entrants: {}, teamByRider: new Map(), route: {}, tuning: RACE_V4_TUNING });
  assert.equal(obs.fieldSize, 0);
  assert.equal(obs.favoriteWon, false);
  assert.equal(obs.maxSameTeamTop10, 0);
});

test("observeStageV4: null team_id tæller som eget unikt hold (ikke klumpet)", () => {
  const results = Array.from({ length: 4 }, (_, i) => ({
    rider_id: `r${i}`, rank: i + 1, time_seconds: 100 + i, group_id: "g", status: "finished",
  }));
  const entrants = Object.fromEntries(results.map((r) => [r.rider_id, { abilities: ability() }]));
  const teamByRider = new Map(); // ingen hold -> alle null
  const obs = observeStageV4({
    results, entrants, teamByRider, route: { finale_type: "bunch_sprint" }, tuning: RACE_V4_TUNING,
  });
  assert.equal(obs.maxSameTeamTop10, 1);
  assert.equal(obs.distinctTeamsTop10, 4);
});

test("cohesionFraction: alle paa vindertiden -> 1.0", () => {
  assert.equal(cohesionFraction([0, 0, 0, 0]), 1);
});

test("cohesionFraction: kun vinderen -> 1/N", () => {
  assert.equal(cohesionFraction([0, 5, 8, 12]), 0.25);
});

test("cohesionFraction: tom liste -> null", () => {
  assert.equal(cohesionFraction([]), null);
});

test("winnerGroupSize: solo-sejr (kun 1 paa mindste tid) -> 1", () => {
  assert.equal(winnerGroupSize([100, 105, 110]), 1);
});

test("winnerGroupSize: gruppesejr (flere paa mindste tid) -> N", () => {
  assert.equal(winnerGroupSize([100, 100, 100, 105]), 3);
});

test("spreadAtRank: spaend fra rank 1 til rank n", () => {
  assert.equal(spreadAtRank([0, 2, 4, 6, 8], 3), 4);
  assert.equal(spreadAtRank([0, 2], 10), 2); // clamper til sidste tilgaengelige rang
});

test("descentAttackGainStats: filtrerer paa direction=descent + type=finale_attack", () => {
  const events = [
    { type: "finale_attack", params: { direction: "descent", gained_seconds: 12 } },
    { type: "finale_attack", params: { direction: "descent", gained_seconds: 18 } },
    { type: "finale_attack", params: { kind: "placement_gap", gap_seconds: 3 } }, // ingen direction -> ignoreres
    { type: "incident", params: {} },
  ];
  const stats = descentAttackGainStats(events);
  assert.equal(stats.count, 2);
  assert.equal(stats.min, 12);
  assert.equal(stats.max, 18);
});

test("descentAttackGainStats: ingen matches -> nulstillet objekt uden kast", () => {
  const stats = descentAttackGainStats([]);
  assert.deepEqual(stats, { count: 0, min: null, max: null });
});
