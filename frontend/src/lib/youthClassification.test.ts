import test from "node:test";
import assert from "node:assert/strict";
import { raceHasYouthClassification, isHiddenYouthClassificationRow, withoutHiddenYouthClassification, isHiddenYouthCareerEvent } from "./youthClassification.ts";

test("#7031: kun seniorløb (og ukendt trup) har ungdomsklassement", () => {
  assert.equal(raceHasYouthClassification("senior"), true);
  assert.equal(raceHasYouthClassification(null), true);
  assert.equal(raceHasYouthClassification(undefined), true);
  assert.equal(raceHasYouthClassification("u23"), false);
  assert.equal(raceHasYouthClassification("junior"), false);
});

test("#7031: young/young_day fjernes i ungdomsløb, alt andet bliver", () => {
  const rows = [
    { result_type: "stage" }, { result_type: "gc" }, { result_type: "young" },
    { result_type: "young_day" }, { result_type: "leader" }, { result_type: "team" },
  ];
  assert.deepEqual(withoutHiddenYouthClassification(rows, "u23").map((r) => r.result_type), ["stage", "gc", "leader", "team"]);
  assert.deepEqual(withoutHiddenYouthClassification(rows, "junior").map((r) => r.result_type), ["stage", "gc", "leader", "team"]);
  assert.equal(withoutHiddenYouthClassification(rows, "senior"), rows, "seniorløb: samme array, uændret");
  assert.deepEqual(withoutHiddenYouthClassification(null, "u23"), []);
});

test("#7031: rækkefilteret til rytterens resultater", () => {
  assert.equal(isHiddenYouthClassificationRow({ result_type: "young" }, "u23"), true);
  assert.equal(isHiddenYouthClassificationRow({ result_type: "young_day" }, "junior"), true);
  assert.equal(isHiddenYouthClassificationRow({ result_type: "young" }, "senior"), false);
  assert.equal(isHiddenYouthClassificationRow({ result_type: "gc" }, "u23"), false);
});

test("#7031: first_jersey for ungdomstrøjen skjules kun i ungdomsløb", () => {
  const young = { event_type: "first_jersey", params: { classification: "young" } };
  const points = { event_type: "first_jersey", params: { classification: "points" } };
  assert.equal(isHiddenYouthCareerEvent(young, "u23"), true);
  assert.equal(isHiddenYouthCareerEvent(young, "junior"), true);
  assert.equal(isHiddenYouthCareerEvent(young, "senior"), false);
  assert.equal(isHiddenYouthCareerEvent(points, "u23"), false);
  assert.equal(isHiddenYouthCareerEvent({ event_type: "maiden_win", params: {} }, "u23"), false);
});
