import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantSuggestions,
  countSuggestionsWithoutPlan,
  filterAssistantSuggestions,
  acceptableAssistantSuggestions,
  acceptableSuggestionIds,
  acceptableSelectionIds,
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

// ── #4699: begge accept-stier må kun sende det serveren kan skrive ──────────
// Rapport (Discord, _chriskp_ 2/9): "Tried to both check all boxes, some boxes,
// and the Accept all button. Neither seems to be working." Rodårsag: panelet
// tilbød ryttere der ALLEREDE har managerens egen plan, og smart-bulk springer
// dem over server-side (partitionSmartBulkTargets), så kaldet skrev 0 rækker.
// Målt i prod 3/9: 65 af 241 manager-hold har en plan på hver ikke-pensioneret
// rytter, og det er de aktive hold - for dem var funktionen helt død.

const MIXED = [
  { riderId: "r1", hasPlan: false },
  { riderId: "r2", hasPlan: true },
  { riderId: "r3", hasPlan: false },
];

test("#4699 acceptableAssistantSuggestions: kun rækker uden managerens egen plan", () => {
  assert.deepEqual(acceptableAssistantSuggestions(MIXED).map((r) => r.riderId), ["r1", "r3"]);
});

test("#4699 acceptableAssistantSuggestions: tomt/undefined input kaster ikke", () => {
  assert.deepEqual(acceptableAssistantSuggestions(undefined), []);
  assert.deepEqual(acceptableAssistantSuggestions([]), []);
});

test("#4699 'Accept all' sender kun de acceptable synlige rækker, ikke hele visningen", () => {
  assert.deepEqual(acceptableSuggestionIds(MIXED), ["r1", "r3"]);
});

test("#4699 'Accept all' på et fuldt planlagt hold sender INTET (knappen skal være slået fra)", () => {
  const allPlanned = [
    { riderId: "r1", hasPlan: true },
    { riderId: "r2", hasPlan: true },
  ];
  assert.deepEqual(acceptableSuggestionIds(allPlanned), []);
});

test("#4699 'Accept selected' beskærer markeringen til det acceptable", () => {
  // Manageren har markeret alle tre bokse (det _chriskp_ gjorde).
  const selected = new Set(["r1", "r2", "r3"]);
  assert.deepEqual(acceptableSelectionIds(selected, MIXED), ["r1", "r3"]);
});

test("#4699 'Accept selected' med kun planlagte ryttere markeret sender INTET", () => {
  assert.deepEqual(acceptableSelectionIds(new Set(["r2"]), MIXED), []);
});

test("#4699 'Accept selected' ignorerer id'er der ikke længere er synlige", () => {
  assert.deepEqual(acceptableSelectionIds(new Set(["r1", "gone"]), MIXED), ["r1"]);
});

test("#4699 'Accept selected' bevarer visnings-rækkefølgen, ikke markerings-rækkefølgen", () => {
  assert.deepEqual(acceptableSelectionIds(new Set(["r3", "r1"]), MIXED), ["r1", "r3"]);
});

test("#4699 'Accept selected' tager både Set og array, og tåler undefined", () => {
  assert.deepEqual(acceptableSelectionIds(["r1", "r3"], MIXED), ["r1", "r3"]);
  assert.deepEqual(acceptableSelectionIds(undefined, MIXED), []);
  assert.deepEqual(acceptableSelectionIds(new Set(["r1"]), undefined), []);
});

test("#4699 de to accept-stier er enige: markér-alt giver samme ids som 'Accept all'", () => {
  const allBoxes = new Set(MIXED.map((r) => r.riderId));
  assert.deepEqual(acceptableSelectionIds(allBoxes, MIXED), acceptableSuggestionIds(MIXED));
});

test("#4699 acceptable-sættet matcher filteret 'kun ryttere uden en plan'", () => {
  // Er filteret slået til, er HVER synlig række acceptabel - panelet må aldrig
  // vise en aktiv checkbox som accept-stien springer over.
  const filtered = filterAssistantSuggestions(MIXED, true);
  assert.deepEqual(acceptableSuggestionIds(filtered), filtered.map((r) => r.riderId));
  assert.equal(acceptableSuggestionIds(filtered).length, countSuggestionsWithoutPlan(MIXED));
});
