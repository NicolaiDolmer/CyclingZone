// Race Engine v3 (#2224), slice S1 (#2352) — work-cost + kaptajn-beskyttelse
// wiring i simulateStage. Spejler raceTeamRoles.test.js's fixtures men med
// v3=true. Determinisme-guard (bit-identisk flag-off) verificeres separat i
// raceEngineV3FlagOff.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateStage, buildTeamContext, TEAM_RACE_WEIGHT } from "./raceSimulator.js";
import { RACE_V3_TUNING, teamRaceWeightV3 } from "./raceRoles.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const demand = { climbing: 0.7, endurance: 0.3, randomness: 0 }; // randomness 0 → ingen noise
const MOUNTAIN = { profile_type: "mountain", demand_vector: demand }; // GC-relevant
const FLAT = { profile_type: "flat", demand_vector: demand };
const ITT = { profile_type: "itt", demand_vector: demand };

function team(prefix, roles, quality = 70, fatigue) {
  return roles.map((role, i) => ({
    rider_id: `${prefix}${i}`,
    team_id: prefix,
    race_role: role,
    abilities: ab(quality),
    ...(fatigue != null ? { fatigue } : {}),
  }));
}

// ── work_cost trækkes fra hjælperens finalScore ───────────────────────────────

test("v3: helper på GC-relevant profil betaler WORK_COST_HELPER_GC (score lavere end v1)", () => {
  const entrants = team("a", ["captain", "helper", "helper"]);
  const v1 = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 1, v3: false });
  const v3 = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 1, v3: true });
  const helperV1 = v1.ranked.find((r) => r.rider_id === "a1");
  const helperV3 = v3.ranked.find((r) => r.rider_id === "a1");
  assert.equal(helperV1.components.work_cost, 0, "v1 (flag-off): work_cost altid 0");
  assert.equal(helperV3.components.work_cost, RACE_V3_TUNING.WORK_COST_HELPER_GC);
  assert.ok(
    helperV3.finalScore < helperV1.finalScore - 1e-9,
    "v3-hjælperens score skal være lavere end v1 (samme captain-boost forskel udlignes af work_cost)"
  );
});

test("v3: helper på flad betaler WORK_COST_HELPER_FLAT (leadout)", () => {
  const entrants = team("a", ["captain", "helper"]);
  const { ranked } = simulateStage({ entrants, stageProfile: FLAT, seed: 2, v3: true });
  assert.equal(ranked.find((r) => r.rider_id === "a1").components.work_cost, RACE_V3_TUNING.WORK_COST_HELPER_FLAT);
});

test("v3: hunter betaler WORK_COST_HUNTER uanset profil", () => {
  const entrants = team("a", ["captain", "hunter"]);
  for (const profile of [MOUNTAIN, FLAT, ITT]) {
    const { ranked } = simulateStage({ entrants, stageProfile: profile, seed: 3, v3: true });
    assert.equal(ranked.find((r) => r.rider_id === "a1").components.work_cost, RACE_V3_TUNING.WORK_COST_HUNTER, profile.profile_type);
  }
});

test("v3: captain betaler intet work_cost", () => {
  const entrants = team("a", ["captain", "helper"]);
  const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 4, v3: true });
  assert.equal(ranked.find((r) => r.rider_id === "a0").components.work_cost, 0);
});

// ── free_role: 0 cost, 0 holdbidrag ───────────────────────────────────────────

test("v3: free_role betaler 0 work_cost", () => {
  const entrants = team("a", ["captain", "free_role", "free_role"]);
  const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 5, v3: true });
  assert.equal(ranked.find((r) => r.rider_id === "a1").components.work_cost, 0);
  assert.equal(ranked.find((r) => r.rider_id === "a2").components.work_cost, 0);
});

test("v3: free_role bidrager IKKE til kaptajnens helperSupport (0 holdbidrag)", () => {
  const withHelpers = team("a", ["captain", "helper", "helper"]);
  const withFreeRole = team("a", ["captain", "free_role", "free_role"]);
  const helperCtx = buildTeamContext({
    entrants: withHelpers,
    terrainById: new Map(withHelpers.map((e) => [e.rider_id, 0.65])),
    stageProfile: MOUNTAIN, v3: true,
  });
  const freeCtx = buildTeamContext({
    entrants: withFreeRole,
    terrainById: new Map(withFreeRole.map((e) => [e.rider_id, 0.65])),
    stageProfile: MOUNTAIN, v3: true,
  });
  assert.ok(helperCtx.get("a").helperSupport > 0, "helpers bidrager til support");
  assert.equal(freeCtx.get("a").helperSupport, 0, "free_role bidrager IKKE til support");
});

test("v3: all-free_role hold = kaptajnen (hvis en fandtes) får intet team-boost", () => {
  const entrants = team("a", ["captain", "free_role", "free_role", "free_role"]);
  const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 6, v3: true });
  assert.equal(ranked.find((r) => r.rider_id === "a0").components.team, 0);
});

// ── v1-buildTeamContext uændret (v3=false, default) ───────────────────────────

test("buildTeamContext uden v3 (default false): 'free_role'-værdi (selvom ugyldig i v1-data) puttes i helpers som før — ren defensiv bagudkompatibilitet", () => {
  const entrants = team("a", ["captain", "free_role"]);
  const ctx = buildTeamContext({
    entrants,
    terrainById: new Map(entrants.map((e) => [e.rider_id, 0.65])),
    stageProfile: MOUNTAIN,
    // v3 udeladt → default false
  });
  assert.ok(ctx.get("a").helperSupport > 0, "v1-branchen behandler ukendte roller som helper (uændret adfærd)");
});

// ── TEAM_RACE_WEIGHT_V3 > v1 for samme helperSupport ──────────────────────────

test("v3: kaptajn-boost bruger teamRaceWeightV3() (> TEAM_RACE_WEIGHT) for samme helperSupport", () => {
  const entrants = team("a", ["captain", "helper", "helper"]);
  const v1 = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 7, v3: false });
  const v3 = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 7, v3: true });
  const captainV1Team = v1.ranked.find((r) => r.rider_id === "a0").components.team;
  const captainV3Team = v3.ranked.find((r) => r.rider_id === "a0").components.team;
  assert.ok(captainV1Team <= TEAM_RACE_WEIGHT + 1e-9);
  assert.ok(captainV3Team <= teamRaceWeightV3() + 1e-9);
  assert.ok(captainV3Team > captainV1Team, `v3-boost (${captainV3Team}) skal være > v1-boost (${captainV1Team})`);
});

// ── work_cost forbruger ingen rng (noise-sekvens upåvirket) ───────────────────

test("v3 ændrer IKKE noise-komponenten for entranter uden race_role (rng-sekvens uafhængig)", () => {
  const noRoleDemand = { climbing: 0.6, endurance: 0.4, randomness: 1 };
  const entrants = [
    { rider_id: "x1", abilities: ab(70) },
    { rider_id: "x2", abilities: ab(65) },
    { rider_id: "x3", abilities: ab(60) },
  ];
  const stage = { profile_type: "mountain", demand_vector: noRoleDemand };
  const v1 = simulateStage({ entrants, stageProfile: stage, seed: 999, v3: false });
  const v3 = simulateStage({ entrants, stageProfile: stage, seed: 999, v3: true });
  for (const id of ["x1", "x2", "x3"]) {
    const a = v1.ranked.find((r) => r.rider_id === id).components.noise;
    const b = v3.ranked.find((r) => r.rider_id === id).components.noise;
    assert.equal(a, b, `noise for ${id} skal være uændret mellem v1/v3`);
  }
});
