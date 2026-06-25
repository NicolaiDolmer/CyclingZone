import { test } from "node:test";
import assert from "node:assert/strict";
import { moveInList, toggleInList, autoSuggestCaptains, summarizeDiff, TERRAIN_BUCKETS } from "./strategyLogic.js";

test("moveInList: flyt op/ned, clamp ved ender", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 0, -1), ["a", "b", "c"]); // clamp top
  assert.deepEqual(moveInList(["a", "b", "c"], 2, 1), ["a", "b", "c"]);  // clamp bund
});

test("toggleInList: tilføj hvis fraværende, fjern hvis til stede", () => {
  assert.deepEqual(toggleInList(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleInList(["a", "b"], "a"), ["b"]);
});

test("autoSuggestCaptains: top-3 efter bucket-suitability, deterministisk tiebreak", () => {
  const roster = [
    { id: "r1", suitabilities: { mountain: 50 } },
    { id: "r2", suitabilities: { mountain: 90 } },
    { id: "r3", suitabilities: { mountain: 70 } },
    { id: "r4", suitabilities: { mountain: 70 } },
  ];
  assert.deepEqual(autoSuggestCaptains(roster, "mountain"), ["r2", "r3", "r4"]); // 90,70,70(tiebreak id)
});

test("autoSuggestCaptains: bucket uden data → tom liste", () => {
  assert.deepEqual(autoSuggestCaptains([{ id: "r1", suitabilities: {} }], "itt"), []);
});

test("summarizeDiff: tæller løb med ændringer", () => {
  const diff = {
    A: { added: ["r2"], removed: ["r1"], captainChange: null },
    B: { added: [], removed: [], captainChange: { from: "r0", to: "r3" } },
    C: { added: [], removed: [], captainChange: null },
  };
  assert.deepEqual(summarizeDiff(diff), { changedRaces: 2, totalAdded: 1, totalRemoved: 1, captainChanges: 1 });
});

test("TERRAIN_BUCKETS matcher backend", () => {
  assert.deepEqual(TERRAIN_BUCKETS, ["flat", "hilly", "mountain", "cobbles", "itt"]);
});
