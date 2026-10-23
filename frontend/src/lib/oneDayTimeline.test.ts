// #6512: egne ryttere i endagsloebsfilmen, baade for gc- og stage-raekker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownRiderIdsForOneDay } from "./oneDayTimeline.ts";

test("one-day results stored as gc rows still yield the team's own riders", () => {
  const rows = [
    { result_type: "gc", rider_id: "a", team_id: "t1", stage_number: null },
    { result_type: "gc", rider_id: "b", team_id: "t2", stage_number: null },
    { result_type: "points", rider_id: "c", team_id: "t1" },
  ];
  assert.deepEqual(ownRiderIdsForOneDay(rows, "t1"), ["a"]);
});

test("stage rows work too, duplicates across gc and stage collapse, no team gives none", () => {
  const rows = [
    { result_type: "stage", rider_id: "a", team_id: "t1", stage_number: 1 },
    { result_type: "gc", rider_id: "a", team_id: "t1" },
  ];
  assert.deepEqual(ownRiderIdsForOneDay(rows, "t1"), ["a"]);
  assert.deepEqual(ownRiderIdsForOneDay(rows, null), []);
  assert.deepEqual(ownRiderIdsForOneDay(undefined, "t1"), []);
});
