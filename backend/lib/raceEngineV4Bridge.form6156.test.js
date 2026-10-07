// #6156: samlet form og formtoppe i loebsmotor v4.
//
// Fejlen bag issuet: raceRunner hentede rytterens form og hans peak-vinduer og
// bar dem paa simEntrant (`form`, `peakWindows`) og etapen (`peakDay`), men
// broen smed dem vaek paa vej ind i v4, og v4 kaldte selv jour sans med
// `form: null`. Ingen test faeldede. Denne fil er den regressionsvagt der
// manglede ved flippet 28/9: den koerer hele kaeden runner -> bro -> kerne og
// faelder, hvis form eller peak-vinduer igen tabes undervejs.
//
// Toppens stoerrelse er IKKE gentaget som tal her: forventningen afledes af de
// samme funktioner som formplanlaeggeren (peakValueFormPoints), saa testen
// holder ved en senere kalibrering, men faelder hvis broen regner noget andet
// end det spilleren faar vist.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildV4StageInput, combinedFormForStage, createRaceEngineV4Adapter } from "./raceEngineV4Bridge.js";
import { peakValueFormPoints } from "./plannerBoard.js";
import { RACE_V3_TUNING } from "./raceRoles.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

// Et peak-vindue paa CET-ordinaler (samme enhed som attachPeakContext bruger).
const WINDOW = Object.freeze({ start: 20000, end: 20004, trainingQuality: 0.8 });
const IN_PEAK = 20002;
const IN_PAYBACK = WINDOW.end + 1;
const NO_PHASE = WINDOW.end + RACE_V3_TUNING.PEAK_PAYBACK_DAYS + 5;

const peakPoints = (tq) => peakValueFormPoints({ trainingQuality: tq }).current;
const paybackPoints = () => peakValueFormPoints({}).payback;

// ── 1. combinedFormForStage: regnestykket ───────────────────────────────────

test("#6156 combinedFormForStage: ingen form og ingen top -> null (intet felt at sende)", () => {
  assert.equal(combinedFormForStage({}, IN_PEAK), null);
  assert.equal(combinedFormForStage({ form: null }, IN_PEAK), null);
  assert.equal(combinedFormForStage({ form: null, peakWindows: [WINDOW] }, NO_PHASE), null);
  assert.equal(combinedFormForStage({ form: "x" }, IN_PEAK), null);
});

test("#6156 combinedFormForStage: form uden top er rytterens form", () => {
  assert.equal(combinedFormForStage({ form: 63 }, IN_PEAK), 63);
  assert.equal(combinedFormForStage({ form: 63, peakWindows: [WINDOW] }, NO_PHASE), 63);
  // Ukendt etapedag: toppen kan ikke placeres, formen gaelder stadig.
  assert.equal(combinedFormForStage({ form: 63, peakWindows: [WINDOW] }, null), 63);
});

test("#6156 combinedFormForStage: i vinduet laegges toppen oveni, med vinduets egen traeningskvalitet", () => {
  const top = peakPoints(WINDOW.trainingQuality);
  assert.ok(top > 0);
  assert.equal(combinedFormForStage({ form: 55, peakWindows: [WINDOW] }, IN_PEAK), 55 + top);
  // Vinduets tq vinder over en rytter-niveau-fallback.
  assert.equal(combinedFormForStage({ form: 55, peakWindows: [WINDOW], peakTrainingQuality: 0.2 }, IN_PEAK), 55 + top);
  // Bedre optakt = stoerre top.
  const better = { ...WINDOW, trainingQuality: 1 };
  assert.ok(combinedFormForStage({ form: 55, peakWindows: [better] }, IN_PEAK) > 55 + top);
});

test("#6156 combinedFormForStage: i tilbagebetalingen trækkes dykket fra", () => {
  const dip = paybackPoints();
  assert.ok(dip < 0);
  assert.equal(combinedFormForStage({ form: 55, peakWindows: [WINDOW] }, IN_PAYBACK), 55 + dip);
});

test("#6156 combinedFormForStage: en top uden form-data lægges paa middel, og skalaen holdes", () => {
  assert.equal(combinedFormForStage({ peakWindows: [WINDOW] }, IN_PEAK), 50 + peakPoints(WINDOW.trainingQuality));
  assert.equal(combinedFormForStage({ form: 98, peakWindows: [WINDOW] }, IN_PEAK), 100);
  assert.equal(combinedFormForStage({ form: 2, peakWindows: [WINDOW] }, IN_PAYBACK), 0);
});

// ── 2. buildV4StageInput: kun orders_gc_v4 baerer feltet ────────────────────

const stubModules = {
  route: { routeFromStageProfileRow: () => ({ profile_type: "hilly", finale_type: null, distance_km: 10, segments: [], waypoints: [] }) },
  entrants: { entrantFromAbilitiesRow: (row, opts) => ({ rider_id: opts.riderId, role: opts.role ?? "free_role" }) },
  tuning: { RACE_V4_TUNING: {} },
  orders: { buildStageOrderPlan: () => ({ orders: [], aiEffortByRider: new Map() }) },
};

const FIELD = Object.freeze([
  { rider_id: "peak", team_id: "T1", abilities: {}, fatigue: 0, form: 60, peakWindows: [WINDOW] },
  { rider_id: "form-only", team_id: "T1", abilities: {}, fatigue: 0, form: 41 },
  { rider_id: "no-data", team_id: "T2", abilities: {}, fatigue: 0 },
]);

function stubInput(rulesRevision, peakDay = IN_PEAK) {
  return buildV4StageInput({
    modules: stubModules,
    entrants: FIELD,
    stageProfile: { stage_number: 1, profile_type: "hilly", distance_km: 150, peakDay },
    seedString: "race:6156:1",
    stageNumber: 1,
    ...(rulesRevision ? { rulesRevision } : {}),
  });
}

test("#6156 buildV4StageInput: legacy og orders_gc_v1-v3 baerer ALDRIG form (byte-identisk input)", () => {
  for (const rev of [undefined, "legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3"]) {
    for (const e of stubInput(rev).startlist) assert.equal("form" in e, false, `${rev}: ${e.rider_id}`);
  }
});

test("#6156 buildV4StageInput: orders_gc_v4 baerer samlet form pr. rytter, og kun naar der er data", () => {
  const byId = Object.fromEntries(stubInput("orders_gc_v4").startlist.map((e) => [e.rider_id, e]));
  assert.equal(byId.peak.form, 60 + peakPoints(WINDOW.trainingQuality));
  assert.equal(byId["form-only"].form, 41);
  assert.equal("form" in byId["no-data"], false, "ingen data -> intet felt (motoren ser en uaendret rytter)");
  // Samme rytter, dagen efter vinduet: dykket.
  const payback = Object.fromEntries(stubInput("orders_gc_v4", IN_PAYBACK).startlist.map((e) => [e.rider_id, e]));
  assert.equal(payback.peak.form, 60 + paybackPoints());
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
  const race = { id: "race-6156", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };
  const stage = (n, peakDay) => ({
    race_id: race.id, id: `sp-${n}`, stage_number: n, profile_type: "hilly", finale_type: "reduced_sprint",
    distance_km: 160, climbs: [{ name: "Cote", crest_km: 140, category: "3" }], sprints: [],
    demand_vector: { punch: 0.4, climbing: 0.3, tempo: 0.3 },
    // Som attachPeakContext saetter den: etapens CET-ordinal.
    peakDay,
  });
  // Etape 1 ligger i vinduet, etape 2 i tilbagebetalingen.
  const stages = [stage(1, IN_PEAK), stage(2, IN_PAYBACK)];
  const entrants = Array.from({ length: 24 }, (_, i) => ({
    rider_id: `r${String(i).padStart(2, "0")}`,
    rider_name: `r${i}`,
    team_id: `t${i % 4}`,
    team_name: `t${i % 4}`,
    abilities: abilities(i),
    race_role: "free_role",
    effort: "normal",
    fatigue: 0,
    // Som attachPeakContext + rider_condition baerer dem paa entrant.
    form: 40 + (i % 5) * 10,
    ...(i % 3 === 0 ? { peakWindows: [WINDOW] } : {}),
  }));
  return { race, stages, entrants };
}

function assertFormsArrived(captured, stages, entrants, label) {
  assert.equal(captured.length, stages.length, `${label}: én motor-input pr. etape`);
  const byId = new Map(entrants.map((e) => [e.rider_id, e]));
  captured.forEach((input, idx) => {
    const day = stages[idx].peakDay;
    assert.equal(input.rules_revision, "orders_gc_v4", label);
    for (const v4e of input.startlist) {
      const expected = combinedFormForStage(byId.get(v4e.rider_id), day);
      assert.ok(expected !== null, `${label}: fixturet giver alle ryttere form`);
      assert.equal(v4e.form, expected, `${label} etape ${idx + 1}: ${v4e.rider_id} fik ikke sin samlede form`);
    }
    // Vagten mod "toppen tabes, kun formen kommer frem": mindst én rytter er paa top/dyk.
    const moved = input.startlist.filter((e) => e.form !== byId.get(e.rider_id).form);
    assert.ok(moved.length > 0, `${label} etape ${idx + 1}: ingen peak-vinduer naaede motoren`);
  });
}

test("#6156 regressionsvagt: buildRaceResults (helt loeb) faar form OG peak-vinduer helt ind i v4", async () => {
  const { buildRaceResults } = await import("./raceRunner.js");
  const { race, stages, entrants } = raceFixture();
  const captured = [];
  const v4Engine = await spiedAdapter(captured);
  buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: true, v4Engine, rulesRevision: "orders_gc_v4" });
  assertFormsArrived(captured, stages, entrants, "helt loeb");
});

test("#6156 regressionsvagt: buildStageRowsAccumulated (etape for etape) faar ogsaa form og peak-vinduer ind", async () => {
  const { buildRaceResults, buildStageRowsAccumulated } = await import("./raceRunner.js");
  const { race, stages, entrants } = raceFixture();
  const first = [];
  buildStageRowsAccumulated({ race, stagesSorted: stages, stageIndex: 0, entrants, v3: true, v4Engine: await spiedAdapter(first), rulesRevision: "orders_gc_v4" });
  const priorStageRows = buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: true, v4Engine: await spiedAdapter([]), rulesRevision: "orders_gc_v4" })
    .resultRows.filter((r) => r.result_type === "stage" && r.stage_number === 1);
  const second = [];
  buildStageRowsAccumulated({ race, stagesSorted: stages, stageIndex: 1, entrants, priorStageRows, v3: true, v4Engine: await spiedAdapter(second), rulesRevision: "orders_gc_v4" });
  assertFormsArrived([...first, ...second], stages, entrants, "etape for etape");
});

test("#6156 regressionsvagt: under orders_gc_v3 naar formen IKKE motoren (revisionen er slukket for igangvaerende loeb)", async () => {
  const { buildRaceResults } = await import("./raceRunner.js");
  const { race, stages, entrants } = raceFixture();
  const captured = [];
  buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: true, v4Engine: await spiedAdapter(captured), rulesRevision: "orders_gc_v3" });
  assert.equal(captured.length, stages.length);
  for (const input of captured) {
    assert.ok(input.startlist.every((e) => !("form" in e)), "v3-input er uaendret");
  }
});

test("#6156: samlet form flytter et v4-resultat; uden data er v4-resultatet identisk med orders_gc_v3", async () => {
  const { race, stages, entrants } = raceFixture();
  const run = async (rulesRevision, field) => {
    const engine = await spiedAdapter([]);
    return engine.simulateStage({ entrants: field, stageProfile: stages[0], seedString: `${race.id}:1`, stageNumber: 1, isStageRace: true, raceStages: stages, rulesRevision }).v4Output;
  };
  const noData = entrants.map(({ form, peakWindows, ...rest }) => rest);
  const v3 = await run("orders_gc_v3", noData);
  const v4 = await run("orders_gc_v4", noData);
  assert.equal(JSON.stringify(v4.results), JSON.stringify(v3.results), "uden form-data: samme resultat");
  const withForm = await run("orders_gc_v4", entrants);
  assert.notEqual(JSON.stringify(withForm.results), JSON.stringify(v3.results), "med form-data: formen virker");
});
