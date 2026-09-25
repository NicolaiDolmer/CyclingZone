// backend/scripts/v4GcMargin.test.mjs
// #5578: GC-harnessens rene dele (gruppering, akkumulering, udfald pr. motor)
// + en lille ende-til-ende-koersel paa det syntetiske headToHeadV4-eksempel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  accumulateGc,
  measureGtMargins,
  pinGrandTours,
  runGrandTour,
  v3StageOutcome,
  v4StageOutcome,
} from "./v4GcMargin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("pinGrandTours: kun race_id'er med mindst minStages etaper, i etapeorden", () => {
  const stages = [
    { race_id: "gt", stage_number: 12, race_stage_number: 2 },
    { race_id: "gt", stage_number: 11, race_stage_number: 1 },
    { race_id: "gt", stage_number: 13, race_stage_number: 3 },
    { race_id: "kort", stage_number: 20, race_stage_number: 1 },
    { stage_number: 30 },
  ];
  const tours = pinGrandTours(stages, 3);
  assert.equal(tours.length, 1);
  assert.equal(tours[0].raceId, "gt");
  assert.deepEqual(tours[0].stages.map((s) => s.stage_number), [11, 12, 13]);
});

test("accumulateGc: tid minus bonus summeres; marginen er nr. 2 minus nr. 1", () => {
  const outcomes = [
    { finishers: [{ rider_id: "a", seconds: 100, bonus: 10 }, { rider_id: "b", seconds: 100, bonus: 0 }, { rider_id: "c", seconds: 130, bonus: 0 }], outRiderIds: [] },
    { finishers: [{ rider_id: "a", seconds: 50, bonus: 0 }, { rider_id: "b", seconds: 40, bonus: 4 }, { rider_id: "c", seconds: 40, bonus: 0 }], outRiderIds: [] },
  ];
  const { standings, marginSeconds } = accumulateGc(["a", "b", "c"], outcomes);
  assert.deepEqual(standings.map((s) => s.rider_id), ["b", "a", "c"]);
  assert.equal(standings[0].gc_seconds, 136);
  assert.equal(marginSeconds, 4);
});

test("accumulateGc: en rytter der er ude (eller mangler i en etape) er ude af klassementet for resten af loebet", () => {
  const outcomes = [
    { finishers: [{ rider_id: "a", seconds: 100, bonus: 0 }, { rider_id: "b", seconds: 200, bonus: 0 }], outRiderIds: ["c"] },
    { finishers: [{ rider_id: "a", seconds: 100, bonus: 0 }, { rider_id: "b", seconds: 100, bonus: 0 }, { rider_id: "c", seconds: 0, bonus: 0 }], outRiderIds: [] },
  ];
  const { standings, marginSeconds } = accumulateGc(["a", "b", "c"], outcomes);
  assert.deepEqual(standings.map((s) => s.rider_id), ["a", "b"]);
  assert.equal(marginSeconds, 100);
});

test("accumulateGc: under to i maal -> margin null (aldrig et gaettet 0)", () => {
  const { marginSeconds } = accumulateGc(["a"], [{ finishers: [{ rider_id: "a", seconds: 1, bonus: 0 }], outRiderIds: [] }]);
  assert.equal(marginSeconds, null);
});

test("v4StageOutcome: kun finished taeller; abandoned og otl er ude; bonus fra passage_totals", () => {
  const outcome = v4StageOutcome({
    results: [
      { rider_id: "a", time_seconds: 1000, status: "finished" },
      { rider_id: "b", time_seconds: 1500, status: "otl" },
      { rider_id: "c", time_seconds: 900, status: "abandoned" },
    ],
    passage_totals: [{ rider_id: "a", bonus_seconds: 10 }],
  });
  assert.deepEqual(outcome.finishers, [{ rider_id: "a", seconds: 1000, bonus: 10 }]);
  assert.deepEqual(outcome.outRiderIds, ["b", "c"]);
});

test("v3StageOutcome: tiden er stageGap, bonus fra racePassages, fravaerende i ranked er ude", () => {
  const perRider = new Map([["a", { bonus_seconds: 6 }]]);
  const outcome = v3StageOutcome([{ rider_id: "a", stageGap: 0 }, { rider_id: "b", stageGap: 12 }], perRider, ["a", "b", "c"]);
  assert.deepEqual(outcome.finishers, [{ rider_id: "a", seconds: 0, bonus: 6 }, { rider_id: "b", seconds: 12, bonus: 0 }]);
  assert.deepEqual(outcome.outRiderIds, ["c"]);
});

function exampleInputs() {
  const dir = join(HERE, "fixtures", "headToHeadV4-example");
  const population = JSON.parse(readFileSync(join(dir, "population.json"), "utf8"));
  const stagesFile = JSON.parse(readFileSync(join(dir, "stages.json"), "utf8"));
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  return { population, stages };
}

test("runGrandTour: ende-til-ende paa det syntetiske eksempel — begge motorer giver et klassement, deterministisk", () => {
  const { population, stages } = exampleInputs();
  const tour = { raceId: "eksempel", stages: stages.map((s) => ({ ...s, race_id: "eksempel" })) };
  const first = runGrandTour({ population, tour, seed: "s1", fieldSize: null });
  const second = runGrandTour({ population, tour, seed: "s1", fieldSize: null });
  assert.deepEqual(first, second, "samme seed -> samme klassement");
  for (const engine of ["v3", "v4"]) {
    assert.ok(first[engine].standings.length >= 2, `${engine}: mindst to i maal`);
    assert.ok(Number.isFinite(first[engine].marginSeconds) && first[engine].marginSeconds >= 0, `${engine}: margin er et ikke-negativt tal`);
  }
});

test("measureGtMargins: fejler hoejt uden grand tours i etape-filen i stedet for at rapportere et tomt anker", () => {
  const { population, stages } = exampleInputs();
  assert.throws(() => measureGtMargins({ population, stages, seeds: ["s1"] }), /ingen grand tours/);
});
