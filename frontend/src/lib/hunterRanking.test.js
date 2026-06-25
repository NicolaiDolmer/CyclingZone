import test from "node:test";
import assert from "node:assert/strict";
import { rankHunterCandidates } from "./hunterRanking.js";

test("rankHunterCandidates: rangerer efter aggression desc, tiebreak navn", () => {
  const riders = [
    { id: "a", name: "Charlie", aggression: 40 },
    { id: "b", name: "Alice", aggression: 80 },
    { id: "c", name: "Bob", aggression: 80 },
    { id: "d", name: "Dave", aggression: 60 },
  ];
  const ranked = rankHunterCandidates(riders);
  assert.deepEqual(ranked.map((r) => r.name), ["Alice", "Bob", "Dave"]); // top-3, 80/80 tiebreak alfabetisk
});

test("rankHunterCandidates: filtrerer ryttere uden aggression-værdi fra", () => {
  const riders = [
    { id: "a", name: "A", aggression: null },
    { id: "b", name: "B", aggression: undefined },
    { id: "c", name: "C", aggression: 50 },
  ];
  assert.deepEqual(rankHunterCandidates(riders).map((r) => r.id), ["c"]);
});

test("rankHunterCandidates: tom/ingen kandidater → tom liste", () => {
  assert.deepEqual(rankHunterCandidates([]), []);
  assert.deepEqual(rankHunterCandidates(), []);
  assert.deepEqual(rankHunterCandidates([{ id: "x", name: "X" }]), []);
});

test("rankHunterCandidates: respekterer limit", () => {
  const riders = [
    { id: "a", name: "A", aggression: 10 },
    { id: "b", name: "B", aggression: 20 },
    { id: "c", name: "C", aggression: 30 },
  ];
  assert.deepEqual(rankHunterCandidates(riders, 2).map((r) => r.id), ["c", "b"]);
});
