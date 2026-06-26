// backend/lib/raceLineupMove.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { findOverlappingSourceRaceId, validateMoveTarget } from "./raceLineupMove.js";

test("findOverlappingSourceRaceId: returnerer det overlappende kilde-løb (ekskl. target)", () => {
  // rytteren er i A og C; A overlapper target, C gør ikke.
  const windowByRace = { target: { start: 10, end: 10 }, A: { start: 10, end: 11 }, C: { start: 20, end: 20 } };
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: ["A", "C"], toRaceId: "target", windowByRace }), "A");
});

test("findOverlappingSourceRaceId: ingen overlappende kilde → null (ren tilføj)", () => {
  const windowByRace = { target: { start: 10, end: 10 }, C: { start: 20, end: 20 } };
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: ["C"], toRaceId: "target", windowByRace }), null);
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: [], toRaceId: "target", windowByRace }), null);
});

test("findOverlappingSourceRaceId: rytteren allerede i target → null (no-op)", () => {
  const windowByRace = { target: { start: 10, end: 10 } };
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: ["target"], toRaceId: "target", windowByRace }), null);
});

test("validateMoveTarget: fuldt mål afvises", () => {
  assert.deepEqual(
    validateMoveTarget({ targetCount: 6, fieldSize: 6, teamInPool: true, frozen: false, eligible: true }),
    { ok: false, error: "move_target_full" });
});

test("validateMoveTarget: frosset/forkert-pulje/uberettiget afvises i rækkefølge", () => {
  assert.equal(validateMoveTarget({ targetCount: 2, fieldSize: 6, teamInPool: false, frozen: false, eligible: true }).error, "move_wrong_pool");
  assert.equal(validateMoveTarget({ targetCount: 2, fieldSize: 6, teamInPool: true, frozen: true, eligible: true }).error, "move_target_locked");
  assert.equal(validateMoveTarget({ targetCount: 2, fieldSize: 6, teamInPool: true, frozen: false, eligible: false }).error, "move_rider_ineligible");
});

test("validateMoveTarget: gyldigt mål → ok", () => {
  assert.deepEqual(validateMoveTarget({ targetCount: 5, fieldSize: 6, teamInPool: true, frozen: false, eligible: true }), { ok: true });
});
