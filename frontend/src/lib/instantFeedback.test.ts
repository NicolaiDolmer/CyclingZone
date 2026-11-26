import assert from "node:assert/strict";
import test from "node:test";
import { applyNotificationChanges, TrainingPlanWrites } from "./instantFeedback.ts";

test("reads started during or before training saves cannot publish stale plans or slots", async () => {
  const writes = new TrainingPlanWrites();
  const before = writes.revision;
  let release!: () => void;
  const slow = writes.enqueue(["a"], () => new Promise<void>((resolve) => { release = resolve; }), () => {});
  await Promise.resolve();
  const during = writes.revision;
  assert.deepEqual([...writes.savingIds], ["a"]);
  assert.equal(writes.acceptsRead(before), false);
  assert.equal(writes.acceptsRead(during), false);
  release();
  await slow;
  assert.equal(writes.acceptsRead(during), false);
  assert.equal(writes.acceptsRead(writes.revision), true);
});

test("simultaneous training choices complete in order and each rider remains pending until done", async () => {
  const writes = new TrainingPlanWrites();
  const calls: string[] = [];
  let release!: () => void;
  const first = writes.enqueue(["a"], () => new Promise<void>((resolve) => { release = resolve; calls.push("a:old"); }), () => {});
  const second = writes.enqueue(["a"], async () => { calls.push("a:new"); }, () => {});
  const third = writes.enqueue(["b"], async () => { calls.push("b"); }, () => {});
  await Promise.resolve();
  assert.deepEqual(calls, ["a:old"]);
  assert.deepEqual([...writes.savingIds], ["a", "b"]);
  release();
  await first;
  assert.ok(writes.savingIds.has("a"));
  await Promise.all([second, third]);
  assert.deepEqual(calls, ["a:old", "a:new", "b"]);
  assert.equal(writes.savingIds.size, 0);
});

test("rolling back one pending notification leaves another success and a realtime row intact", () => {
  const base = [{ id: "a", is_read: false }, { id: "b", is_read: false }];
  const first = { kind: "read" as const, ids: new Set(["a"]) };
  const second = { kind: "read" as const, ids: new Set(["b"]) };
  assert.deepEqual(applyNotificationChanges(base, [first, second]).map((row) => row.is_read), [true, true]);
  const acknowledged = applyNotificationChanges([{ id: "new", is_read: false }, ...base], [second]);
  // Discard the rejected first change; the successful change is already in the base.
  assert.deepEqual(applyNotificationChanges(acknowledged, []).map((row) => [row.id, row.is_read]),
    [["new", false], ["a", false], ["b", true]]);
});
