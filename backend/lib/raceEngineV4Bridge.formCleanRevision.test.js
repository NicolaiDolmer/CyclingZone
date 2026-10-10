// #6156 (ren motor-revision, spor 2): rytterens form i loebsmotor v4, kun under
// official_times_v3 og UDEN formtoppens tillaeg (toppe kobles paa ved S5).
//
// Fejlen bag issuet: raceRunner bar rytterens form (rider_condition.form) paa
// simEntrant, men broen smed den vaek paa vej ind i v4, og v4 kaldte selv jour
// sans med form=null. Ingen test faeldede. Denne fil er regressionsvagten: den
// koerer hele kaeden runner -> bro -> kerne og faelder, hvis formen igen tabes
// undervejs under official_times_v3, eller hvis den slipper ind under en
// aeldre revision.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildV4StageInput, createRaceEngineV4Adapter, riderFormForV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

const V3 = "official_times_v3";
const OLDER = [undefined, "legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2"];

// ── 1. riderFormForV4: kun formen, klampet ──────────────────────────────────

test("#6156 riderFormForV4: ingen eller ugyldig form -> null (intet felt at sende)", () => {
  for (const e of [null, undefined, {}, { form: null }, { form: undefined }, { form: "" }, { form: "x" }, { form: Number.NaN }]) {
    assert.equal(riderFormForV4(e), null, JSON.stringify(e));
  }
});

test("#6156 riderFormForV4: rytterens form sendes uaendret, klampet til 0-100", () => {
  assert.equal(riderFormForV4({ form: 63 }), 63);
  assert.equal(riderFormForV4({ form: "41" }), 41);
  assert.equal(riderFormForV4({ form: 0 }), 0);
  assert.equal(riderFormForV4({ form: 140 }), 100);
  assert.equal(riderFormForV4({ form: -5 }), 0);
});

test("#6156 riderFormForV4: formtoppens tillaeg laegges IKKE til (toppe kommer foerst ved S5)", () => {
  const window = { start: 20000, end: 20004, trainingQuality: 1 };
  assert.equal(riderFormForV4({ form: 55, peakWindows: [window], peakTrainingQuality: 1 }), 55);
  assert.equal(riderFormForV4({ peakWindows: [window] }), null, "en top uden form giver intet felt");
});

// ── 2. buildV4StageInput: kun official_times_v3 baerer feltet ───────────────

const stubModules = {
  route: { routeFromStageProfileRow: () => ({ profile_type: "mountain", finale_type: null, distance_km: 10, segments: [], waypoints: [] }) },
  entrants: { entrantFromAbilitiesRow: (row, opts) => ({ rider_id: opts.riderId, role: opts.role ?? "free_role", condition: opts.condition }) },
  tuning: { RACE_V4_TUNING: {} },
  orders: { buildStageOrderPlan: () => ({ orders: [], aiEffortByRider: new Map() }) },
};

const FIELD = Object.freeze([
  { rider_id: "in-form", team_id: "T1", abilities: {}, fatigue: 0, form: 80, peakWindows: [{ start: 1, end: 9, trainingQuality: 1 }] },
  { rider_id: "low-form", team_id: "T1", abilities: {}, fatigue: 10, form: 40 },
  { rider_id: "no-data", team_id: "T2", abilities: {}, fatigue: 0 },
]);

function stubInput(rulesRevision) {
  return buildV4StageInput({
    modules: stubModules,
    entrants: FIELD,
    stageProfile: { stage_number: 1, profile_type: "mountain", distance_km: 150, peakDay: 5 },
    seedString: "race:6156:1",
    stageNumber: 1,
    ...(rulesRevision ? { rulesRevision } : {}),
  });
}

test("#6156 buildV4StageInput: official_times_v3 saetter form = rider_condition.form (uden top)", () => {
  const byId = Object.fromEntries(stubInput(V3).startlist.map((e) => [e.rider_id, e]));
  assert.equal(byId["in-form"].form, 80, "peak-vinduet laegges ikke til");
  assert.equal(byId["low-form"].form, 40);
  assert.equal("form" in byId["no-data"], false, "ingen data -> intet felt");
});

test("#6156 buildV4StageInput: official_times_v2 og alle aeldre revisioner baerer ALDRIG form", () => {
  for (const rev of OLDER) {
    for (const e of stubInput(rev).startlist) assert.equal("form" in e, false, `${rev}: ${e.rider_id}`);
  }
});

test("#6156 buildV4StageInput: en rytter uden rider_condition faar samme v4-entrant under v3 som under v2", () => {
  const v2 = stubInput("official_times_v2").startlist.find((e) => e.rider_id === "no-data");
  const v3 = stubInput(V3).startlist.find((e) => e.rider_id === "no-data");
  assert.equal(JSON.stringify(v3), JSON.stringify(v2));
});

// ── 3. Regressionsvagten: runner -> bro -> kerne ────────────────────────────

function abilities(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 40 + ((seed * 11 + i * 5) % 45); });
  return a;
}

async function spiedAdapter(capturedInputs) {
  const [core, tuning, entrants, route, orders, timeline] = await Promise.all([
    import("./engine/v4/index.ts"),
    import("./engine/v4/tuning.ts"),
    import("./engine/v4/adapters/entrantAdapter.ts"),
    import("./engine/v4/adapters/routeAdapter.ts"),
    import("./engine/v4/orders/teamOrdersAdapter.ts"),
    import("./engine/v4/timeline.ts"),
  ]);
  const spyCore = {
    simulateStageV4: (input) => {
      capturedInputs.push(input);
      return core.simulateStageV4(input);
    },
  };
  return createRaceEngineV4Adapter({ core: spyCore, tuning, entrants, route, orders, timeline });
}

function raceFixture() {
  const race = { id: "race-6156-clean", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };
  const stage = (n) => ({
    race_id: race.id, id: `sp-${n}`, stage_number: n, profile_type: "mountain", finale_type: "summit",
    distance_km: 150, climbs: [{ name: "Col", crest_km: 150, category: "1" }], sprints: [],
    demand_vector: { climbing: 0.6, tempo: 0.2, endurance: 0.2 },
  });
  const stages = [stage(1), stage(2)];
  const entrants = Array.from({ length: 24 }, (_, i) => ({
    rider_id: `r${String(i).padStart(2, "0")}`,
    rider_name: `r${i}`,
    team_id: `t${i % 4}`,
    team_name: `t${i % 4}`,
    abilities: abilities(i),
    race_role: "free_role",
    effort: "normal",
    fatigue: 0,
    // Som raceRunner beriger entrant fra rider_condition; hver 6. rytter uden.
    ...(i % 6 === 5 ? {} : { form: 30 + (i % 5) * 15 }),
  }));
  return { race, stages, entrants };
}

function assertFormsArrived(captured, stages, entrants, label) {
  assert.equal(captured.length, stages.length, `${label}: én motor-input pr. etape`);
  const byId = new Map(entrants.map((e) => [e.rider_id, e]));
  for (const [idx, input] of captured.entries()) {
    assert.equal(input.rules_revision, V3, label);
    let withForm = 0;
    for (const v4e of input.startlist) {
      const source = byId.get(v4e.rider_id);
      if (source.form == null) {
        assert.equal("form" in v4e, false, `${label} etape ${idx + 1}: ${v4e.rider_id} uden data fik et form-felt`);
      } else {
        assert.equal(v4e.form, source.form, `${label} etape ${idx + 1}: ${v4e.rider_id} fik ikke sin form`);
        withForm++;
      }
    }
    assert.ok(withForm > 0, `${label} etape ${idx + 1}: ingen form naaede motoren`);
  }
}

test("#6156 regressionsvagt: buildRaceResults (helt loeb) faar formen helt ind i v4 under official_times_v3", async () => {
  const { buildRaceResults } = await import("./raceRunner.js");
  const { race, stages, entrants } = raceFixture();
  const captured = [];
  buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: true, v4Engine: await spiedAdapter(captured), rulesRevision: V3 });
  assertFormsArrived(captured, stages, entrants, "helt loeb");
});

test("#6156 regressionsvagt: buildStageRowsAccumulated (etape for etape) faar ogsaa formen ind", async () => {
  const { buildStageRowsAccumulated } = await import("./raceRunner.js");
  const { race, stages, entrants } = raceFixture();
  const captured = [];
  buildStageRowsAccumulated({ race, stagesSorted: stages, stageIndex: 0, entrants, v3: true, v4Engine: await spiedAdapter(captured), rulesRevision: V3 });
  assertFormsArrived(captured, stages.slice(0, 1), entrants, "etape for etape");
});

test("#6156 regressionsvagt: under official_times_v2 naar formen IKKE motoren", async () => {
  const { buildRaceResults } = await import("./raceRunner.js");
  const { race, stages, entrants } = raceFixture();
  const captured = [];
  buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: true, v4Engine: await spiedAdapter(captured), rulesRevision: "official_times_v2" });
  assert.equal(captured.length, stages.length);
  for (const input of captured) assert.ok(input.startlist.every((e) => !("form" in e)), "v2-input er uaendret");
});

test("#6156: formen flytter et v3-resultat; uden form-data er v3-resultatet det samme som foer", async () => {
  const { race, stages, entrants } = raceFixture();
  const run = async (field) => {
    const engine = await spiedAdapter([]);
    return engine.simulateStage({ entrants: field, stageProfile: stages[0], seedString: `${race.id}:1`, stageNumber: 1, isStageRace: true, raceStages: stages, rulesRevision: V3 }).v4Output;
  };
  const noData = entrants.map(({ form: _form, ...rest }) => rest);
  const nullForm = entrants.map((e) => ({ ...e, form: null }));
  const baseline = await run(noData);
  assert.equal(JSON.stringify(await run(nullForm)), JSON.stringify(baseline), "form=null = ingen form-data");
  const withForm = await run(entrants);
  assert.notEqual(JSON.stringify(withForm.results), JSON.stringify(baseline.results), "med form-data: formen virker");
});
