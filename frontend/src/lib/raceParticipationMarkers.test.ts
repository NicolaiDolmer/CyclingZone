import test from "node:test";
import assert from "node:assert/strict";
import { participationForResult, historyForStage, participationFlagsForResult } from "./raceParticipationMarkers.ts";
const timeline = { timeline_version: 2, stage_number: 6, events: [
  { km: 0, type: "stage_start", params: { field_count: 3 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["morning"] } },
  { km: 75, type: "finale_attack", params: { direction: "descent", group_id: "later", rider_ids: ["attacker"] } },
  { km: 96, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["morning"] } },
  { km: 100, type: "finish", params: { top: [{ rider_id: "attacker", rank: 1 }] } },
] };

test("historical broad flags are corrected by the same event projection as the runner", () => {
  const history = historyForStage(timeline, 6, ["morning", "attacker", "passive"]);
  assert.deepEqual(participationForResult({ rider_id: "attacker", in_breakaway: true }, history), { morning: false, caught: false, survived: false, laterAttack: true, verified: true });
  assert.deepEqual(participationForResult({ rider_id: "morning", in_breakaway: true }, history), { morning: true, caught: true, survived: false, laterAttack: false, verified: true });
  assert.equal(participationForResult({ rider_id: "passive", in_breakaway: true }, history)?.morning, false);
});

test("another stage's timeline cannot overwrite a result's stored marker", () => {
  const history = historyForStage(timeline, 5, ["morning"]);
  assert.equal(history, null);
  assert.equal(participationForResult({ rider_id: "old", in_breakaway: true, breakaway_caught: true }, history)?.caught, true);
});

test("missing timeline retains the legacy marker without inventing a later attack", () => {
  assert.equal(participationForResult({ rider_id: "old", in_breakaway: true }, null)?.laterAttack, false);
  assert.equal(participationForResult({ rider_id: null }, null), null);
});

test("legacy v1 sampled names cannot erase other stored morning flags", () => {
  const history = historyForStage({ ...timeline, timeline_version: 1 }, 6, ["morning", "fourth"]);
  assert.equal(history, null);
  assert.equal(participationForResult({ rider_id: "fourth", in_breakaway: true }, history)?.morning, true);
});
test("view flags preserve an unknown native outcome instead of claiming survival", () => {
  const history = historyForStage({ ...timeline, events: timeline.events.filter(event => event.type !== "breakaway_caught") }, 6, ["morning", "attacker"]);
  assert.ok(history);
  assert.deepEqual(participationFlagsForResult({ rider_id: "morning", in_breakaway: true, breakaway_caught: false }, history), { in_breakaway: true, breakaway_caught: null });
});