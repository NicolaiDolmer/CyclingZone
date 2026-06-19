import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRidersByType, UNTYPED_KEY } from "./trainingRoster.js";

test("groupRidersByType grupperer efter primary_type i RIDER_TYPE_KEYS-orden (#1480)", () => {
  const riders = [
    { id: 1, primary_type: "climber" },
    { id: 2, primary_type: "sprinter" },
    { id: 3, primary_type: "climber" },
    { id: 4, primary_type: "gc" },
  ];
  const groups = groupRidersByType(riders);
  // sprinter (rank 0) før climber (rank 2) før gc (rank 7).
  assert.deepEqual(groups.map((g) => g.type), ["sprinter", "climber", "gc"]);
  const climber = groups.find((g) => g.type === "climber");
  assert.deepEqual(climber.riders.map((r) => r.id), [1, 3]);
});

test("groupRidersByType bevarer indkommende rækkefølge inden for en gruppe", () => {
  const riders = [
    { id: "c", primary_type: "rouleur" },
    { id: "a", primary_type: "rouleur" },
    { id: "b", primary_type: "rouleur" },
  ];
  const groups = groupRidersByType(riders);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].riders.map((r) => r.id), ["c", "a", "b"]);
});

test("groupRidersByType lægger ryttere uden gyldig type sidst under untyped", () => {
  const riders = [
    { id: 1, primary_type: null },
    { id: 2, primary_type: "sprinter" },
    { id: 3, primary_type: "ukendt_type" }, // ikke i RIDER_TYPE_KEYS
  ];
  const groups = groupRidersByType(riders);
  assert.equal(groups[0].type, "sprinter");
  const last = groups[groups.length - 1];
  assert.equal(last.type, UNTYPED_KEY);
  assert.deepEqual(last.riders.map((r) => r.id), [1, 3]);
});

test("groupRidersByType udelader tomme grupper og håndterer tom/ugyldig input", () => {
  assert.deepEqual(groupRidersByType([]), []);
  assert.deepEqual(groupRidersByType(null), []);
  assert.deepEqual(groupRidersByType(undefined), []);
  const groups = groupRidersByType([{ id: 1, primary_type: "tt" }]);
  assert.deepEqual(groups.map((g) => g.type), ["tt"]);
});
