import assert from "node:assert/strict";
import test from "node:test";
import { availableKinds, rememberedKind, moveRotationPass, moveWeekBlock, weekCells, weekPlacement } from "./programR5Model.ts";

test("R5 only restores the rotation view when its flag is on", () => {
  assert.deepEqual(availableKinds(false), ["week"]);
  assert.deepEqual(availableKinds(true), ["week", "rotation"]);
  assert.equal(rememberedKind("rotation", availableKinds(false)), "week");
  assert.equal(rememberedKind("rotation", availableKinds(true)), "rotation");
});

test("moving a pass keeps its effort and leaves the saved order intact", () => {
  const original = [{ session: "sprint", effort: "hard" as const }, { session: "endurance" }];
  assert.deepEqual(moveRotationPass(original, 1, 0), [original[1], original[0]]);
  assert.deepEqual(original.map(({ session }) => session), ["sprint", "endurance"]);
});

test("a reordered week block moves the lock and effort with the pass", () => {
  assert.deepEqual(moveWeekBlock({
    slots: ["sprint", "endurance", "tempo", "rest", "threshold"],
    slotEfforts: ["hard", "easy", null, null, "normal"], lockSlot: 4,
  }, 4, 1), {
    slots: ["sprint", "threshold", "endurance", "tempo", "rest"],
    slotEfforts: ["hard", "normal", "easy", null, null], lockSlot: 1,
  });
});

test("WB-2 and WB-6 use the same source in the grid and the Races took row", () => {
  const placed = weekPlacement(4, [4]);
  const cells = weekCells({
    days: { mon: { slots: ["sprint", "endurance", "tempo", "rest", "threshold"] } },
    draft: {}, weekdays: ["mon"], todayWeekday: "mon", raceToday: new Set([4]), lockedToday: new Set(),
    placements: { mon: placed },
  });
  assert.deepEqual(placed.taken, [3]);
  assert.deepEqual(cells[0][3], { kind: "session", session: "threshold", changed: false, sourceSlot: 4 });
  assert.deepEqual(weekPlacement(4, [4], { 0: 0, 1: 1, 2: 2, 3: 3 }).taken, [4]);
});
