// backend/lib/raceTeamRoles.test.js
// #1307: teamComponent-seam aktiveret — hjælperkvalitet × friskhed booster kaptajnen.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateStage, buildTeamContext, TEAM_RACE_WEIGHT } from "./raceSimulator.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const demand = { climbing: 0.7, endurance: 0.3, randomness: 0 }; // randomness 0 → ingen noise
const profile = { profile_type: "itt", demand_vector: demand };  // itt → ingen udbrud

function team(prefix, roles, quality = 70, fatigue) {
  return roles.map((role, i) => ({
    rider_id: `${prefix}${i}`,
    team_id: prefix,
    race_role: role,
    abilities: ab(quality),
    ...(fatigue != null ? { fatigue } : {}),
  }));
}

test("kaptajn får boost af friske, gode hjælpere; hjælpere er neutrale", () => {
  const entrants = team("a", ["captain", "helper", "helper"]);
  const { ranked } = simulateStage({ entrants, stageProfile: profile, seed: 1 });
  const captain = ranked.find((r) => r.rider_id === "a0");
  const helper = ranked.find((r) => r.rider_id === "a1");
  assert.ok(captain.components.team > 0, "kaptajn skal have positivt team-bidrag");
  assert.ok(captain.components.team <= TEAM_RACE_WEIGHT + 1e-9, "bounded af TEAM_RACE_WEIGHT");
  assert.equal(helper.components.team, 0);
});

test("trætte hjælpere giver mindre boost end friske (acceptance: træthed indgår)", () => {
  const fresh = simulateStage({ entrants: team("a", ["captain", "helper", "helper"], 70, 0), stageProfile: profile, seed: 1 });
  const tired = simulateStage({ entrants: team("a", ["captain", "helper", "helper"], 70, 100), stageProfile: profile, seed: 1 });
  const fb = fresh.ranked.find((r) => r.rider_id === "a0").components.team;
  const tb = tired.ranked.find((r) => r.rider_id === "a0").components.team;
  assert.ok(fb > tb, `frisk ${fb} skal være > træt ${tb}`);
  assert.ok(tb > 0, "selv trætte hjælpere bidrager noget");
});

test("sprint_captain beskyttes på flade etaper, captain på øvrige", () => {
  const entrants = team("a", ["captain", "sprint_captain", "helper", "helper"]);
  const flatP = { profile_type: "flat", demand_vector: demand };
  const flat = simulateStage({ entrants, stageProfile: flatP, seed: 99 });
  assert.ok(flat.ranked.find((r) => r.rider_id === "a1").components.team > 0, "sprint_captain boostes på flat");
  assert.equal(flat.ranked.find((r) => r.rider_id === "a0").components.team, 0, "captain er hjælper-neutral på flat når sprint_captain findes");
  const mtn = simulateStage({ entrants, stageProfile: profile, seed: 99 });
  assert.ok(mtn.ranked.find((r) => r.rider_id === "a0").components.team > 0, "captain boostes ellers");
});

test("hunter tæller som hjælper i boostet; hold uden roller er fuldt neutrale", () => {
  const withHunter = team("a", ["captain", "hunter"]);
  const r1 = simulateStage({ entrants: withHunter, stageProfile: profile, seed: 5 });
  assert.ok(r1.ranked.find((r) => r.rider_id === "a0").components.team > 0);
  const noRoles = team("b", [undefined, undefined, undefined]);
  const r2 = simulateStage({ entrants: noRoles, stageProfile: profile, seed: 5 });
  assert.ok(r2.ranked.every((r) => r.components.team === 0));
});

test("buildTeamContext: helperSupport ∈ [0,1], hold uden kaptajn udelades", () => {
  const entrants = [...team("a", ["captain", "helper"]), ...team("b", ["helper", "helper"])];
  const terrainById = new Map(entrants.map((e) => [e.rider_id, 0.65]));
  const ctx = buildTeamContext({ entrants, terrainById, stageProfile: profile });
  assert.ok(ctx.has("a") && !ctx.has("b"));
  const a = ctx.get("a");
  assert.ok(a.helperSupport >= 0 && a.helperSupport <= 1);
});
