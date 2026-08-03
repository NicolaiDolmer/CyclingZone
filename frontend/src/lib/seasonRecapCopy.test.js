import { test } from "node:test";
import assert from "node:assert/strict";
import { movementTone, movementLabelKey, nextSeasonGoalKey } from "./seasonRecapCopy.js";

test("movementTone maps promoted/relegated/maintained/null", () => {
  assert.equal(movementTone("promoted"), "success");
  assert.equal(movementTone("relegated"), "danger");
  assert.equal(movementTone("maintained"), "neutral");
  assert.equal(movementTone(null), "neutral");
});

test("movementLabelKey returns a bare suffix (no namespace path)", () => {
  assert.equal(movementLabelKey("promoted"), "promoted");
  assert.equal(movementLabelKey("relegated"), "relegated");
  assert.equal(movementLabelKey("maintained"), "maintained");
  assert.equal(movementLabelKey(null), "maintained");
});

const DIV = { minDivision: 1, maxDivision: 4 };

test("nextSeasonGoalKey: movement wins over position", () => {
  assert.equal(nextSeasonGoalKey({ movement: "promoted", division: 4, ...DIV }), "promoted");
  assert.equal(nextSeasonGoalKey({ movement: "relegated", division: 1, ...DIV }), "relegated");
});

test("nextSeasonGoalKey: held position uses division edges", () => {
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 1, ...DIV }), "heldTop");
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 4, ...DIV }), "heldBottom");
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 2, ...DIV }), "heldMid");
  assert.equal(nextSeasonGoalKey({ movement: "maintained", division: 3, ...DIV }), "heldMid");
});

test("nextSeasonGoalKey: null movement falls back to position", () => {
  assert.equal(nextSeasonGoalKey({ movement: null, division: 1, ...DIV }), "heldTop");
});
