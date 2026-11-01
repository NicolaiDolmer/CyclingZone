// #4613 — intentions-logik. Ingen React, ingen I/O.

import test from "node:test";
import assert from "node:assert/strict";
import {
  stageHasIntention,
} from "./raceOverviewLogic.js";

const OVERRIDES = [
  { stage_number: 1, rider_id: "a", effort: "all_out" },
  // 'normal' ER rollens standard — den tæller ikke som et valg.
  { stage_number: 2, rider_id: "b", effort: "normal" },
];

test("stageHasIntention: kun en afvigelse fra rollens standard tæller", () => {
  assert.equal(stageHasIntention({ overrides: OVERRIDES, stageNumber: 1 }), true);
  assert.equal(stageHasIntention({ overrides: OVERRIDES, stageNumber: 2 }), false);
  assert.equal(stageHasIntention({ overrides: OVERRIDES, stageNumber: 3 }), false);
  assert.equal(stageHasIntention({ overrides: undefined, stageNumber: 1 }), false);
});
