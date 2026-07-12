// Race Engine v3 (#2224), slice S1 (#2352) — FLAG-OFF BIT-IDENTISK-regression.
//
// Spec §5 (determinisme-regler, ufravigelige): "Feature-flag race_engine_v3_scoring
// ... flag-off = bit-identisk dagens motor." Denne testfil er den eksplicitte
// dokumentation/gate for det kravet: v3 udeladt (default) og v3=false skal give
// PRÆCIS samme output som hinanden på tværs af simulateStage, buildRaceResults
// og buildStageRowsAccumulated — over mange entrant/rolle/profil-kombinationer,
// inkl. multi-etape GC-akkumulering (så fatigue/points-akkumuleringen heller
// ikke afviger).
import test from "node:test";
import assert from "node:assert/strict";

import { simulateStage, ENGINE_VERSION } from "./raceSimulator.js";
import { buildRaceResults, buildStageRowsAccumulated } from "./raceRunner.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, role, overrides = {}, is_u25 = false) {
  return {
    rider_id: id, team_id, rider_name: id, is_u25,
    abilities: abil(overrides),
    ...(role ? { race_role: role } : {}),
  };
}

const ENTRANTS = [
  entrant("climber", "A", "captain", { climbing: 96, endurance: 92, recovery: 84, punch: 72 }, true),
  entrant("helperA1", "A", "helper", { endurance: 60, climbing: 55 }),
  entrant("helperA2", "A", "helper", { endurance: 58, climbing: 52 }),
  entrant("hunterA", "A", "hunter", { aggression: 80, tactics: 70 }),
  entrant("sprinter", "B", "sprint_captain", { sprint: 96, acceleration: 92, positioning: 88 }),
  entrant("helperB1", "B", "helper", { sprint: 60, positioning: 58 }),
  entrant("helperB2", "B", "helper", { endurance: 55, recovery: 52 }),
  entrant("freeC", "C", undefined, { climbing: 70, endurance: 68 }),
];

const STAGES = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];
const STAGE_RACE = { id: "race-v3-flagoff", race_type: "stage_race", race_class: "ProSeries", season_id: "s1" };
const POINTS = {
  "stage__1": 43, "gc__1": 160, "gc__2": 120, "team__1": 50, "team__2": 30,
};

// ── simulateStage: v3 udeladt === v3=false, over mange profiler + seeds ───────

test("simulateStage: v3 udeladt (default) er deepEqual med v3=false, alle profiler × 20 seeds", () => {
  const profiles = ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "cobbles", "classic"];
  for (const profileType of profiles) {
    const demand = DEMAND_VECTORS[profileType];
    for (let seed = 1; seed <= 20; seed++) {
      const stageProfile = { profile_type: profileType, demand_vector: demand };
      const withoutV3 = simulateStage({ entrants: ENTRANTS, stageProfile, seed });
      const explicitFalse = simulateStage({ entrants: ENTRANTS, stageProfile, seed, v3: false });
      assert.deepEqual(withoutV3, explicitFalse, `${profileType}/seed=${seed}`);
    }
  }
});

test("simulateStage: v3=false komponenter — work_cost/dayform/jour_sans altid 0, komponentsummen holder", () => {
  const stageProfile = { profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain };
  const { ranked } = simulateStage({ entrants: ENTRANTS, stageProfile, seed: 42, v3: false });
  for (const r of ranked) {
    assert.equal(r.components.work_cost, 0, r.rider_id);
    // S2 (#2353): dagsform + jour sans er ligeledes døde i v1-stien.
    assert.equal(r.components.dayform, 0, r.rider_id);
    assert.equal(r.components.jour_sans, 0, r.rider_id);
    const sum = r.components.terrain + r.components.noise + r.components.form
      - r.components.fatigue + r.components.team + (r.components.breakaway ?? 0)
      + (r.components.finale ?? 0) + r.components.work_cost
      + r.components.dayform + r.components.jour_sans;
    assert.ok(Math.abs(sum - r.finalScore) < 1e-12, `finalScore matcher ikke komponenter (${r.rider_id})`);
  }
});

// S2 (#2353): v1's form-vægt er UÆNDRET — en entrant med form-data scorer
// præcis som før S2 når flaget er off (FORM_RACE_WEIGHT=0.012-stien er urørt).
test("simulateStage: v3=false med form-data — formComponent bruger stadig v1's FORM_RACE_WEIGHT", () => {
  const stageProfile = { profile_type: "itt", demand_vector: DEMAND_VECTORS.itt };
  const withForm = ENTRANTS.map((e) => ({ ...e, form: 100 }));
  const { ranked } = simulateStage({ entrants: withForm, stageProfile, seed: 5, v3: false });
  for (const r of ranked) {
    assert.ok(Math.abs(r.components.form - 0.012) < 1e-12, `${r.rider_id}: v1-form skal være +0.012, var ${r.components.form}`);
  }
});

// ── buildRaceResults: v3 udeladt === v3=false — HELE løbets output ────────────

test("buildRaceResults: v3 udeladt er deepEqual med v3=false (resultRows, runs, finalFatigue)", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  assert.deepEqual(a, b);
});

test("buildRaceResults: v3=false → engine_version=1 (ENGINE_VERSION), ingen riderScores på runs", () => {
  const { runs } = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  for (const r of runs) {
    assert.equal(r.engine_version, ENGINE_VERSION);
    assert.equal(r.riderScores, undefined, "v3=false må IKKE attache riderScores");
  }
});

// ── buildRaceResults: v3=true ÆNDRER faktisk resultatet (sanity — testen ovenfor er ikke triviel) ─

test("buildRaceResults: v3=true giver et ANDET resultat end v3=false (work-cost + team-vægt virker)", () => {
  const off = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  const on = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: true });
  assert.notDeepEqual(off.resultRows, on.resultRows, "v3=true skal ændre resultRows (work-cost/team-vægt er ikke no-ops)");
  for (const r of on.runs) {
    assert.equal(r.engine_version, 2, "v3=true → ENGINE_VERSION_V3");
    assert.ok(Array.isArray(r.riderScores), "v3=true skal attache riderScores");
  }
});

// ── buildStageRowsAccumulated: samme garanti på stage-by-stage-stien ──────────

test("buildStageRowsAccumulated: v3 udeladt er deepEqual med v3=false", () => {
  const entrantsWithFatigue = ENTRANTS.map((e) => ({ ...e, fatigue: 0 }));
  const a = buildStageRowsAccumulated({
    race: STAGE_RACE, stagesSorted: STAGES, stageIndex: 0,
    entrants: entrantsWithFatigue, pointsLookup: POINTS, priorStageRows: [],
  });
  const b = buildStageRowsAccumulated({
    race: STAGE_RACE, stagesSorted: STAGES, stageIndex: 0,
    entrants: entrantsWithFatigue, pointsLookup: POINTS, priorStageRows: [], v3: false,
  });
  assert.deepEqual(a, b);
});

// ── Race v3 S3 (#2034): race_stage_roles-overrides eksisterer, MEN v3=false ────
// Spec §5: overrides må KUN anvendes når v3=true. Denne test er S3's eksplicitte
// gate for det kravet — givet en IKKE-tom stageRoleOverrides-Map (som om en
// manager havde gemt taktik-ændringer via PUT-endpointet), skal buildRaceResults
// og buildStageRowsAccumulated stadig give BIT-IDENTISK output med v3=false og
// INGEN overrides overhovedet.

const STAGE_ROLE_OVERRIDES = new Map([
  [1, new Map([
    ["climber", { race_role: "helper", effort: "protect" }], // ville demote basis-kaptajnen hvis anvendt
    ["helperA1", { race_role: "captain", effort: "save" }],
  ])],
  [2, new Map([
    ["hunterA", { race_role: "free_role", effort: "protect" }],
  ])],
  [3, new Map([
    ["sprinter", { race_role: "helper", effort: "save" }],
  ])],
]);

test("buildRaceResults: v3=false + race_stage_roles-overrides findes → BIT-IDENTISK med v3=false uden overrides", () => {
  const withoutOverrides = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  const withOverrides = buildRaceResults({
    race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false,
    stageRoleOverrides: STAGE_ROLE_OVERRIDES,
  });
  assert.deepEqual(withoutOverrides, withOverrides, "v3=false skal ignorere stageRoleOverrides fuldstændigt");
});

test("buildStageRowsAccumulated: v3=false + race_stage_roles-overrides findes → BIT-IDENTISK med v3=false uden overrides", () => {
  const entrantsWithFatigue = ENTRANTS.map((e) => ({ ...e, fatigue: 0 }));
  const withoutOverrides = buildStageRowsAccumulated({
    race: STAGE_RACE, stagesSorted: STAGES, stageIndex: 0,
    entrants: entrantsWithFatigue, pointsLookup: POINTS, priorStageRows: [], v3: false,
  });
  const withOverrides = buildStageRowsAccumulated({
    race: STAGE_RACE, stagesSorted: STAGES, stageIndex: 0,
    entrants: entrantsWithFatigue, pointsLookup: POINTS, priorStageRows: [], v3: false,
    stageRoleOverrides: STAGE_ROLE_OVERRIDES,
  });
  assert.deepEqual(withoutOverrides, withOverrides, "v3=false skal ignorere stageRoleOverrides fuldstændigt");
});

// Sanity (spejler mønsteret for v3=true ovenfor): overrides SKAL ændre resultatet
// når v3=true — ellers ville testene ovenfor være trivielle (ingen-op uanset).
test("buildRaceResults: v3=true + race_stage_roles-overrides ÆNDRER faktisk resultatet vs. ingen overrides", () => {
  const withoutOverrides = buildRaceResults({ race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: true });
  const withOverrides = buildRaceResults({
    race: STAGE_RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: true,
    stageRoleOverrides: STAGE_ROLE_OVERRIDES,
  });
  assert.notDeepEqual(withoutOverrides.resultRows, withOverrides.resultRows);
  // Checksum skal også afvige (stageRoles-nøglen er nu med i payloaden).
  assert.notEqual(withoutOverrides.runs[0].input_checksum, withOverrides.runs[0].input_checksum);
});

// ── Race v3 S4 (#1176): styrt/mekaniske uheld + DNF — flag-off-gate ───────────
// Spec §5 samme krav som S1-S3: v3=false SKAL forblive dormant. Uheld har deres
// EGEN rng-stream ("incident:"-præfiks, raceIncidents.js) og køres KUN i
// simulateStage's v3-gren (efter gap-modellen) — v3=false rører den kode-sti
// slet ikke, så flag-off er bit-identisk med FØR S4 fandtes.

// Seed 2/62 på ENTRANTS+cobbles giver et kendt uheld når v3=true (verificeret
// eksplicit i raceSimulatorIncidents.test.js: seed 2 = time_loss for helperA1,
// seed 62 = abandon for freeC). Bruges her til at bevise at v3=false på PRÆCIS
// samme seeds er upåvirket — dvs. testen ovenfor er ikke triviel af mangel på
// et uheld at undertrykke.
const COBBLES_STAGE = { profile_type: "cobbles", demand_vector: DEMAND_VECTORS.cobbles };

test("simulateStage S4: v3=false på seeds der KENDES at trigge uheld når v3=true — incidents=[], ranked uændret (8 ryttere, alle components.incident=0)", () => {
  for (const seed of [2, 62]) {
    const withoutV3 = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES_STAGE, seed });
    const explicitFalse = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES_STAGE, seed, v3: false });
    assert.deepEqual(withoutV3, explicitFalse, `seed ${seed}`);
    assert.deepEqual(explicitFalse.incidents, [], `seed ${seed}: incidents skal være tom`);
    assert.equal(explicitFalse.ranked.length, ENTRANTS.length, `seed ${seed}: ingen skal fjernes`);
    for (const r of explicitFalse.ranked) assert.equal(r.components.incident, 0, `seed ${seed}/${r.rider_id}`);
  }
});

test("simulateStage S4: v3=true på SAMME seeds rent faktisk ÆNDRER resultatet (sanity — beviser at testen ovenfor undertrykker en ægte effekt)", () => {
  const timeLoss = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES_STAGE, seed: 2, v3: true });
  assert.equal(timeLoss.incidents.length, 1, "seed 2 skal give ét time_loss-uheld når v3=true");
  assert.equal(timeLoss.ranked.length, ENTRANTS.length, "time_loss fjerner ingen");
  assert.notEqual(timeLoss.ranked.find((r) => r.rider_id === "helperA1").components.incident, 0);

  const abandon = simulateStage({ entrants: ENTRANTS, stageProfile: COBBLES_STAGE, seed: 62, v3: true });
  assert.equal(abandon.incidents.length, 1, "seed 62 skal give ét abandon-uheld når v3=true");
  assert.equal(abandon.ranked.length, ENTRANTS.length - 1, "abandon skal fjerne præcis én rytter");
});

// buildRaceResults/buildStageRowsAccumulated: v3=false SKAL ignorere uheld
// fuldstændigt selv på uheldsudsatte seeds — samme mønster som S3's
// stageRoleOverrides-gate ovenfor, men for S4's dormant incident-sti.
test("buildRaceResults S4: v3=false på en STAGES-liste der rammer de kendte uheld-seeds → resultat uændret ift. v3 udeladt (incidents=[])", () => {
  const stages = [{ stage_number: 1, profile_type: "cobbles", demand_vector: DEMAND_VECTORS.cobbles }];
  // #2351-saltet stableSeed afhænger af race.id+etapenummer, ikke et rå tal vi kan
  // pinne direkte her — vi verificerer derfor invarianten generelt (v3 udeladt ===
  // v3=false, og incidents er ALTID tom) frem for at jage et specifikt seed-hit.
  const a = buildRaceResults({ race: STAGE_RACE, stages, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  assert.deepEqual(a, b);
  assert.deepEqual(a.incidents, [], "v3=false/udeladt skal ALTID give tom incidents-liste");
});
