import test from "node:test";
import assert from "node:assert/strict";
import { scorePopulation } from "./reputation-calibration.js";

test("#5828 calibration measures the visible transition floor and still reports the raw motor score", () => {
  const run = scorePopulation({
    riders: [
      { id: "popular", popularity: 82, is_retired: false },
      { id: "unknown", popularity: 0, is_retired: false },
    ],
    byRider: new Map(),
    currentSeasonIndex: 4,
    seedFloorWeight: 1,
    softCap: 80,
  });

  assert.ok(run.scored[0].reputation < 82, "the raw engine value remains available for diagnosis");
  assert.equal(run.scored[0].displayReputation, 82);
  assert.equal(run.starCount, 1, "the launch distribution uses the number players will see");
  assert.equal(run.rawStarCount, 0);
});
