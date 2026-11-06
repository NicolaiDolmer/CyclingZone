import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayReason } from "./trainingDayReason.ts";
import type { TrainingActivity } from "./trainingDailyReceipt.ts";

const slot = (patch: Partial<TrainingActivity> = {}): TrainingActivity => ({
  rider_id: "r1", intensity: "hard", focus: "vo2max", bound_race_day: false, ...patch,
});
const rest = (patch: Partial<TrainingActivity> = {}) => slot({ intensity: "rest", ...patch });
const day = (make: () => TrainingActivity) => [make(), make(), make(), make(), make()];

test("a whole date of planned rest says the plan rested the rider", () => {
  assert.equal(dayReason(day(rest), 0), "restPlan");
});

test("a fatigue rule, a race binding and an injury each win over the plan", () => {
  assert.equal(dayReason(day(() => rest({ fatigue_rule: { kind: "fatigue", fallback: "rest" } })), 0), "fatigueRule");
  assert.equal(dayReason(day(() => rest({ bound_race_day: true })), 0), "raceBound");
  assert.equal(dayReason(day(() => rest({ injured: true })), 0), "injured");
});

test("a rider injured during the date's only session is injured, not near his best", () => {
  assert.equal(dayReason([rest(), slot({ injured: true })], 0), "injured");
});

test("every session at the ceiling is the near-best reason, with or without rest and race slots", () => {
  assert.equal(dayReason(day(() => slot({ at_ceiling: true })), 0), "nearBest");
  assert.equal(dayReason([rest(), slot({ intensity: "race", race_day: true, at_ceiling: true })], 0), "nearBest");
});

test("one session with room left means no reason is claimed", () => {
  assert.equal(dayReason([slot({ at_ceiling: true }), slot()], 0), null);
});

test("active recovery has its own cause and is never called the ceiling", () => {
  assert.equal(dayReason(day(() => slot({ intensity: "recovery", focus: "restitution" })), 0), null);
});

test("a date with a whole point has nothing to explain", () => {
  assert.equal(dayReason(day(() => slot({ at_ceiling: true })), 1), null);
  assert.equal(dayReason(day(rest), 1), null);
});

test("old reports without the evidence say nothing rather than guess", () => {
  assert.equal(dayReason(day(() => rest({ bound_race_day: undefined })), 0), null);
  assert.equal(dayReason(day(() => slot({ bound_race_day: undefined })), 0), null);
  assert.equal(dayReason([], 0), null);
});

test("every reason has a text in every language, in words only", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const locale = JSON.parse(readFileSync(new URL(`../../public/locales/${lang}/training.json`, import.meta.url), "utf8"));
    for (const reason of ["injured", "raceBound", "fatigueRule", "restPlan", "nearBest"]) {
      const text = locale.dailyReceipt.reason[reason];
      assert.equal(typeof text, "string", `${lang}: ${reason}`);
      assert.doesNotMatch(text, /[%\d]/, `${lang}: ${reason}`);
    }
  }
});
