import { test } from "node:test";
import assert from "node:assert/strict";
import { movementTone, movementLabelKey, nextSeasonGoalKey } from "./seasonRecapCopy.js";

test("movementTone maps promoted/relegated/maintained/null", () => {
  assert.equal(movementTone("promoted"), "success");
  assert.equal(movementTone("relegated"), "danger");
  assert.equal(movementTone("maintained"), "neutral");
  assert.equal(movementTone(null), "neutral");
});

test("movementLabelKey maps to the recap.movement.* namespace", () => {
  assert.equal(movementLabelKey("promoted"), "recap.movement.promoted");
  assert.equal(movementLabelKey("relegated"), "recap.movement.relegated");
  assert.equal(movementLabelKey("maintained"), "recap.movement.maintained");
  assert.equal(movementLabelKey(null), "recap.movement.maintained");
});

const DIV = { minDivision: 1, maxDivision: 4 };

test("nextSeasonGoalKey: movement wins over position", () => {
  assert.equal(nextSeasonGoalKey({ movement: "promoted", division: 4, ...DIV }), "recap.goal.promoted");
  assert.equal(nextSeasonGoalKey({ movement: "relegated", division: 1, ...DIV }), "recap.goal.relegated");
});

test("nextSeasonGoalKey: held position uses division edges", () => {
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 1, ...DIV }), "recap.goal.heldTop");
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 4, ...DIV }), "recap.goal.heldBottom");
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 2, ...DIV }), "recap.goal.heldMid");
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 3, ...DIV }), "recap.goal.heldMid");
});

test("nextSeasonGoalKey: null movement falls back to position", () => {
  assert.equal(nextSeasonGoalKey({ movement: null, division: 1, ...DIV }), "recap.goal.heldTop");
});
