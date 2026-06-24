// frontend/src/lib/raceHubLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeColumnStatus, isRiderBound } from "./raceHubLogic.js";

test("computeColumnStatus: full / understaffed / withdrawn", () => {
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 5, target: 7, withdrawn: false }), { kind: "understaffed", selected: 5, target: 7 });
  assert.deepEqual(computeColumnStatus({ selected: 0, target: 8, withdrawn: true }), { kind: "withdrawn", selected: 0, target: 8 });
});

test("isRiderBound: rytter bundet i et ANDET kolonne-løb end det aktuelle", () => {
  const bindingMap = { r1: ["a"], r2: ["b"] };
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "b" }), true); // r1 er i a, bundet ift. b
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "a" }), false); // r1 ER a's egen
  assert.equal(isRiderBound({ bindingMap, riderId: "r9", forRaceId: "b" }), false);
});
