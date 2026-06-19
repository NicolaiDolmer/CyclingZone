import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_FOCUS_ABILITIES, TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES,
  TRAINING_SETBACK_PCT, isValidFocus, isValidIntensity, injuryDaysLeft,
  isRiderInjured, flattenCondition, CONDITION_SELECT,
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

// isRiderInjured tests (#1531 — skade-badge)
test("isRiderInjured er false ved null/undefined/fortid", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  assert.equal(isRiderInjured(null, today), false);
  assert.equal(isRiderInjured(undefined, today), false);
  assert.equal(isRiderInjured("2026-06-11T00:00:00Z", today), false);
});

test("isRiderInjured er true når injured_until er i fremtiden", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  assert.equal(isRiderInjured("2026-06-15T00:00:00Z", today), true);
});

// flattenCondition tests (#1531 — løft injured_until op fra embed)
test("flattenCondition løfter injured_until op fra objekt-embed", () => {
  const r = { id: "x", rider_condition: { injured_until: "2026-06-15" } };
  const out = flattenCondition(r);
  assert.equal(out.injured_until, "2026-06-15");
  assert.equal(out.rider_condition, undefined);
});

test("flattenCondition løfter injured_until op fra array-embed", () => {
  const r = { id: "x", rider_condition: [{ injured_until: "2026-06-15" }] };
  assert.equal(flattenCondition(r).injured_until, "2026-06-15");
});

test("flattenCondition tåler manglende/null embed (ingen skade-rad)", () => {
  assert.equal(flattenCondition({ id: "x" }).injured_until, undefined);
  assert.equal(flattenCondition({ id: "x", rider_condition: null }).injured_until, undefined);
  assert.equal(flattenCondition(null), null);
});

test("CONDITION_SELECT embedder kun injured_until (ikke form/fatigue)", () => {
  assert.equal(CONDITION_SELECT, "rider_condition(injured_until)");
});
