// #4581: rene funktions-tests for raceResultsSelectors.js — udtrukket af
// RaceDetailPage.jsx som del af per-etape-paginering. Logikken er uændret fra den
// tidligere inline-udgave; testene beviser det, ikke en ny adfærd.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveStageNumbers,
  overallSeedStageNumber,
  validateInitialStage,
  stagesToPreload,
  jerseyHoldersForStage,
} from "./raceResultsSelectors.js";

test("deriveStageNumbers: etapeløb med kørte etaper -> [1..N]", () => {
  assert.deepEqual(deriveStageNumbers({ raceType: "stage_race", stagesCompleted: 5 }), [1, 2, 3, 4, 5]);
});

test("deriveStageNumbers: etapeløb der ikke er startet -> []", () => {
  assert.deepEqual(deriveStageNumbers({ raceType: "stage_race", stagesCompleted: 0 }), []);
  assert.deepEqual(deriveStageNumbers({ raceType: "stage_race", stagesCompleted: null }), []);
});

test("deriveStageNumbers: endagsløb -> altid [] (ingen etape-faner)", () => {
  assert.deepEqual(deriveStageNumbers({ raceType: "one_day_race", stagesCompleted: 1 }), []);
});

test("overallSeedStageNumber: ingen kørte etaper -> null", () => {
  assert.equal(overallSeedStageNumber({ stagesCompleted: 0 }), null);
  assert.equal(overallSeedStageNumber({ stagesCompleted: null }), null);
});

test("overallSeedStageNumber: seneste kørte etape returneres", () => {
  assert.equal(overallSeedStageNumber({ stagesCompleted: 14 }), 14);
  assert.equal(overallSeedStageNumber({ stagesCompleted: 1 }), 1); // endagsløb
});

test("validateInitialStage: gyldigt nummer inden for kørte etaper accepteres", () => {
  assert.equal(validateInitialStage("5", { stagesCompleted: 14 }), 5);
  assert.equal(validateInitialStage(5, { stagesCompleted: 14 }), 5);
});

test("validateInitialStage: fremtidig/ikke-kørt etape afvises", () => {
  assert.equal(validateInitialStage("15", { stagesCompleted: 14 }), null);
  assert.equal(validateInitialStage("1", { stagesCompleted: 0 }), null);
});

test("validateInitialStage: ugyldigt input (NaN/0/negativ) afvises", () => {
  assert.equal(validateInitialStage("samlet", { stagesCompleted: 14 }), null);
  assert.equal(validateInitialStage(null, { stagesCompleted: 14 }), null);
  assert.equal(validateInitialStage("0", { stagesCompleted: 14 }), null);
  assert.equal(validateInitialStage("-2", { stagesCompleted: 14 }), null);
});

test("stagesToPreload: dedupliserer når dybt-link peger på samme etape som seed", () => {
  assert.deepEqual(stagesToPreload({ initialStage: 14, overallSeedStage: 14 }), [14]);
});

test("stagesToPreload: begge beholdes når de er forskellige", () => {
  assert.deepEqual(stagesToPreload({ initialStage: 5, overallSeedStage: 14 }), [5, 14]);
});

test("stagesToPreload: null-værdier udelades, tom liste når begge null", () => {
  assert.deepEqual(stagesToPreload({ initialStage: null, overallSeedStage: 14 }), [14]);
  assert.deepEqual(stagesToPreload({ initialStage: null, overallSeedStage: null }), []);
});

const JERSEY_DEFS = [
  { dayType: "leader", bg: "gold", fg: "black" },
  { dayType: "points_day", bg: "green", fg: "black" },
  { dayType: "mountain_day", bg: "red", fg: "white" },
  { dayType: "young_day", bg: "white", fg: "black" },
];

test("jerseyHoldersForStage: finder rank-1-rækken pr. dag-type for DEN etape", () => {
  const results = [
    { id: 1, result_type: "leader", stage_number: 3, rank: 1, rider_id: "r1" },
    { id: 2, result_type: "leader", stage_number: 3, rank: 2, rider_id: "r2" },
    { id: 3, result_type: "points_day", stage_number: 3, rank: 1, rider_id: "r3" },
    // anden etape - skal IKKE matche
    { id: 4, result_type: "leader", stage_number: 4, rank: 1, rider_id: "r9" },
  ];
  const jerseys = jerseyHoldersForStage(results, 3, JERSEY_DEFS);
  assert.equal(jerseys.length, 2);
  assert.equal(jerseys[0].dayType, "leader");
  assert.equal(jerseys[0].holder.rider_id, "r1");
  assert.equal(jerseys[0].bg, "gold"); // bevarer jersey-def-felter
  assert.equal(jerseys[1].dayType, "points_day");
  assert.equal(jerseys[1].holder.rider_id, "r3");
});

test("jerseyHoldersForStage: dag-typer uden en rank-1-række for etapen udelades", () => {
  const results = [
    { id: 1, result_type: "leader", stage_number: 3, rank: 1, rider_id: "r1" },
  ];
  const jerseys = jerseyHoldersForStage(results, 3, JERSEY_DEFS);
  assert.equal(jerseys.length, 1);
  assert.equal(jerseys[0].dayType, "leader");
});

test("jerseyHoldersForStage: legacy-rækker uden rank (default 1) matcher stadig", () => {
  const results = [{ id: 1, result_type: "leader", stage_number: 1, rider_id: "legacy" }];
  const jerseys = jerseyHoldersForStage(results, 1, JERSEY_DEFS);
  assert.equal(jerseys.length, 1);
  assert.equal(jerseys[0].holder.rider_id, "legacy");
});

test("jerseyHoldersForStage: tomme results giver ingen trøjer", () => {
  assert.deepEqual(jerseyHoldersForStage([], 3, JERSEY_DEFS), []);
  assert.deepEqual(jerseyHoldersForStage(null, 3, JERSEY_DEFS), []);
});
