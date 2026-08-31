import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantSuggestions,
  countSuggestionsWithoutPlan,
  filterAssistantSuggestions,
} from "./assistantTrainingSuggestions.js";

const RIDERS = [
  { id: "r1", firstname: "Anna", lastname: "Andersen" },
  { id: "r2", firstname: "Bo", lastname: "Berg" },
  { id: "r3", firstname: "Cecilie", lastname: "Christensen" },
];

test("buildAssistantSuggestions: builds one row per rider with a smart-focus hit", () => {
  const rows = buildAssistantSuggestions({
    riders: RIDERS,
    smartDefaultFocusByRider: { r1: "vo2max", r2: "endurance", r3: "sprint" },
    planFor: () => null,
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.riderId), ["r1", "r2", "r3"]);
});

test("buildAssistantSuggestions: skips riders without a smartDefaultFocus entry (e.g. retired)", () => {
  const rows = buildAssistantSuggestions({
    riders: RIDERS,
    smartDefaultFocusByRider: { r1: "vo2max", r3: "sprint" }, // r2 missing
    planFor: () => null,
  });
  assert.deepEqual(rows.map((r) => r.riderId), ["r1", "r3"]);
});

test("buildAssistantSuggestions: derives intensity from SESSION_INTENSITY per focus", () => {
  const rows = buildAssistantSuggestions({
    riders: RIDERS,
    smartDefaultFocusByRider: { r1: "vo2max", r2: "endurance", r3: "sprint" },
    planFor: () => null,
  });
  const byId = Object.fromEntries(rows.map((r) => [r.riderId, r.intensity]));
  assert.equal(byId.r1, "hard"); // vo2max -> hard
  assert.equal(byId.r2, "easy"); // endurance -> easy
  assert.equal(byId.r3, "hard"); // sprint -> hard
});

test("buildAssistantSuggestions: hasPlan reflects planFor's current focus, not just presence of a plan row", () => {
  const rows = buildAssistantSuggestions({
    riders: RIDERS,
    smartDefaultFocusByRider: { r1: "vo2max", r2: "endurance" },
    planFor: (id) => (id === "r1" ? { focus: "threshold", intensity: "hard" } : { intensity: "rest" }),
  });
  const byId = Object.fromEntries(rows.map((r) => [r.riderId, r.hasPlan]));
  assert.equal(byId.r1, true);
  assert.equal(byId.r2, false); // plan row exists but has no focus (e.g. rest day) -> no plan
});

test("buildAssistantSuggestions: builds a readable name from firstname+lastname", () => {
  const rows = buildAssistantSuggestions({
    riders: RIDERS,
    smartDefaultFocusByRider: { r1: "vo2max" },
    planFor: () => null,
  });
  assert.equal(rows[0].name, "Anna Andersen");
});

test("countSuggestionsWithoutPlan: counts only rows with hasPlan=false", () => {
  const rows = [
    { hasPlan: false },
    { hasPlan: true },
    { hasPlan: false },
  ];
  assert.equal(countSuggestionsWithoutPlan(rows), 2);
});

test("countSuggestionsWithoutPlan: empty/undefined input returns 0", () => {
  assert.equal(countSuggestionsWithoutPlan([]), 0);
  assert.equal(countSuggestionsWithoutPlan(undefined), 0);
});

test("filterAssistantSuggestions: onlyWithoutPlan=false returns all rows unchanged", () => {
  const rows = [{ riderId: "r1", hasPlan: false }, { riderId: "r2", hasPlan: true }];
  assert.deepEqual(filterAssistantSuggestions(rows, false), rows);
});

test("filterAssistantSuggestions: onlyWithoutPlan=true keeps only riders without a plan", () => {
  const rows = [
    { riderId: "r1", hasPlan: false },
    { riderId: "r2", hasPlan: true },
    { riderId: "r3", hasPlan: false },
  ];
  const filtered = filterAssistantSuggestions(rows, true);
  assert.deepEqual(filtered.map((r) => r.riderId), ["r1", "r3"]);
});

test("filterAssistantSuggestions: undefined rows -> empty array, never throws", () => {
  assert.deepEqual(filterAssistantSuggestions(undefined, true), []);
  assert.deepEqual(filterAssistantSuggestions(undefined, false), []);
});
