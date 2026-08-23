// #3371 - tests for den rene permutations-scorer i stageOrderReorder3371.js.
import { test } from "node:test";
import assert from "node:assert/strict";

import { countViolations, chooseBestOrder, sequenceLabel } from "./stageOrderReorder3371.js";

test("countViolations: 0 brud på en allerede pæn sekvens", () => {
  const v = countViolations(["flat", "hilly", "mountain", "mountain", "flat", "mountain", "itt"]);
  assert.equal(v.mountainStreak, 0);
  assert.equal(v.mountainBreak, 0);
  assert.equal(v.ttAdjacent, 0);
  assert.equal(v.total, 0);
  assert.equal(v.openingOk, true);
});

test("countViolations: 3 bjerg i træk giver 1 mountainStreak-brud", () => {
  const v = countViolations(["flat", "mountain", "high_mountain", "high_mountain", "itt"]);
  assert.equal(v.mountainStreak, 1);
  assert.equal(v.total, 1);
});

test("countViolations: 4 bjerg i træk giver 2 mountainStreak-brud", () => {
  const v = countViolations(["flat", "mountain", "high_mountain", "high_mountain", "high_mountain"]);
  assert.equal(v.mountainStreak, 2);
});

test("countViolations: to bjergblokke adskilt kun af ITT tæller som mountainBreak", () => {
  const v = countViolations(["mountain", "mountain", "itt", "mountain", "flat"]);
  assert.equal(v.mountainStreak, 0);
  assert.equal(v.mountainBreak, 1);
  assert.equal(v.total, 1);
});

test("countViolations: bjergblokke adskilt af flat/rolling/hilly er OK", () => {
  const v = countViolations(["mountain", "mountain", "flat", "mountain", "mountain"]);
  assert.equal(v.mountainBreak, 0);
  assert.equal(v.total, 0);
});

test("countViolations: to ITT i træk giver ttAdjacent-brud", () => {
  const v = countViolations(["itt", "itt", "flat", "mountain"]);
  assert.equal(v.ttAdjacent, 1);
  assert.equal(v.total, 1);
});

test("countViolations: åbning uden for flat/rolling/itt er openingOk=false, men ikke et hårdt brud", () => {
  const v = countViolations(["mountain", "flat", "flat"]);
  assert.equal(v.openingOk, false);
  assert.equal(v.total, 0);
});

test("chooseBestOrder: allerede-optimal sekvens er uændret (idempotens-forudsætning)", () => {
  const stages = ["flat", "rolling", "mountain", "mountain", "flat", "mountain", "itt"].map((profile_type) => ({ profile_type }));
  const r = chooseBestOrder(stages, "race-A");
  assert.equal(r.changed, false);
  assert.deepEqual(r.order, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(r.after.total, 0);
  assert.equal(r.displacement, 0);
});

test("chooseBestOrder: 4 bjerg i træk regnes om til 0 brud", () => {
  const stages = ["flat", "mountain", "high_mountain", "high_mountain", "high_mountain"].map((profile_type) => ({ profile_type }));
  const r = chooseBestOrder(stages, "race-B");
  assert.equal(r.before.total, 2);
  assert.equal(r.after.total, 0);
  assert.equal(r.changed, true);
  // Multisæt af typer er uændret - kun rækkefølgen må ændre sig.
  const before = stages.map((s) => s.profile_type).slice().sort();
  const after = r.order.map((i) => stages[i].profile_type).slice().sort();
  assert.deepEqual(after, before);
});

test("chooseBestOrder: deterministisk - samme input+seedKey giver samme resultat hver gang", () => {
  const stages = ["itt", "itt", "mountain", "high_mountain", "high_mountain", "flat"].map((profile_type) => ({ profile_type }));
  const r1 = chooseBestOrder(stages, "race-C");
  const r2 = chooseBestOrder(stages, "race-C");
  assert.deepEqual(r1.order, r2.order);
});

test("chooseBestOrder: 2. kørsel på ALLEREDE reordnet output er et no-op (idempotens end-to-end)", () => {
  const stages = ["itt", "itt", "mountain", "high_mountain", "high_mountain", "flat"].map((profile_type) => ({ profile_type }));
  const r1 = chooseBestOrder(stages, "race-D");
  const reordered = r1.order.map((i) => ({ profile_type: stages[i].profile_type }));
  const r2 = chooseBestOrder(reordered, "race-D");
  assert.equal(r2.changed, false, "anden kørsel på det allerede-reordnede resultat skal ikke finde noget at ændre");
  assert.equal(r2.after.total, r1.after.total);
});

test("chooseBestOrder: n<=1 er altid uændret", () => {
  const r = chooseBestOrder([{ profile_type: "flat" }], "race-E");
  assert.equal(r.changed, false);
  assert.deepEqual(r.order, [0]);
});

test("sequenceLabel: joiner med '>'", () => {
  assert.equal(sequenceLabel(["flat", "mountain"]), "flat>mountain");
});
