import test from "node:test";
import assert from "node:assert/strict";
import { effectiveStageFit, bestFitRiderId } from "./lineupInsight.js";

const rider = (id, suitability, stageSuitability) => ({ id, suitability, stageSuitability });

test("effectiveStageFit: bruger per-etape når stageIndex sat, ellers løb-snit", () => {
  const r = rider("r1", 70, [40, 90]);
  assert.equal(effectiveStageFit(r, 1), 90);
  assert.equal(effectiveStageFit(r, 0), 40);
  assert.equal(effectiveStageFit(r, null), 70);
});

test("effectiveStageFit: manglende stageSuitability → fald tilbage til løb-snit", () => {
  const r = rider("r1", 70, null);
  assert.equal(effectiveStageFit(r, 1), 70);
});

test("effectiveStageFit: intet fit → null", () => {
  assert.equal(effectiveStageFit(rider("r1", null, null), 0), null);
});

test("bestFitRiderId: id med højest effektiv fit blandt valgte (tiebreak id asc)", () => {
  const riders = [rider("r1", 50, [50, 60]), rider("r2", 50, [50, 80]), rider("r3", 50, [50, 80])];
  assert.equal(bestFitRiderId(riders, ["r1", "r2", "r3"], 1), "r2");
  assert.equal(bestFitRiderId(riders, ["r1"], 1), "r1");
  assert.equal(bestFitRiderId(riders, [], 1), null);
});
