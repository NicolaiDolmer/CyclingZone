import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_FOCUS_ABILITIES, TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES,
  TRAINING_SETBACK_PCT, isValidFocus, isValidIntensity,
} from "./training.js";

test("fokus-nøgler matcher abilities-mappens nøgler", () => {
  assert.deepEqual(TRAINING_FOCUS_KEYS, Object.keys(TRAINING_FOCUS_ABILITIES));
  assert.equal(TRAINING_FOCUS_KEYS.length, 6);
});

test("hvert fokus peger på mindst én evne", () => {
  for (const k of TRAINING_FOCUS_KEYS) {
    assert.ok(Array.isArray(TRAINING_FOCUS_ABILITIES[k]) && TRAINING_FOCUS_ABILITIES[k].length > 0, k);
  }
});

test("intensiteter + setback-procenter er konsistente", () => {
  assert.deepEqual(TRAINING_INTENSITIES, ["easy", "normal", "hard"]);
  assert.equal(TRAINING_SETBACK_PCT.easy, 0);
  assert.ok(TRAINING_SETBACK_PCT.hard > TRAINING_SETBACK_PCT.normal);
  assert.ok(TRAINING_SETBACK_PCT.normal > TRAINING_SETBACK_PCT.easy);
});

test("validatorer afviser ukendte værdier", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nope"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(!isValidIntensity("extreme"));
});
