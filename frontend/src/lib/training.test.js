import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_FOCUS_ABILITIES, TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES,
  TRAINING_SETBACK_PCT, isValidFocus, isValidIntensity, injuryDaysLeft,
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

test("intensiteter inkluderer rest + setback-procenter er konsistente", () => {
  assert.deepEqual(TRAINING_INTENSITIES, ["rest", "easy", "normal", "hard"]);
  assert.equal(TRAINING_SETBACK_PCT.easy, 0);
  assert.ok(TRAINING_SETBACK_PCT.hard > TRAINING_SETBACK_PCT.normal);
  assert.ok(TRAINING_SETBACK_PCT.normal > TRAINING_SETBACK_PCT.easy);
});

test("validatorer afviser ukendte værdier + accepterer rest", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nope"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(isValidIntensity("rest"));
  assert.ok(!isValidIntensity("extreme"));
});

// injuryDaysLeft tests
test("injuryDaysLeft returnerer 0 ved null", () => {
  assert.equal(injuryDaysLeft(null), 0);
  assert.equal(injuryDaysLeft(undefined), 0);
});

test("injuryDaysLeft returnerer 0 når rask (fortid)", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(injuryDaysLeft(yesterday.toISOString()), 0);
});

test("injuryDaysLeft returnerer 0 præcis i dag", () => {
  const today = new Date();
  assert.equal(injuryDaysLeft(today.toISOString(), new Date(today)), 0);
});

test("injuryDaysLeft returnerer korrekte dage frem i tid", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  const until = new Date("2026-06-15T00:00:00Z");
  assert.equal(injuryDaysLeft(until.toISOString(), today), 3);
});

test("injuryDaysLeft returnerer 1 for næste dag", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  const until = new Date("2026-06-13T00:00:00Z");
  assert.equal(injuryDaysLeft(until.toISOString(), today), 1);
});
