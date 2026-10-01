import test from "node:test";
import assert from "node:assert/strict";
import { deriveParticipationHistory } from "./raceParticipationHistory.ts";
const start = { km: 0, type: "stage_start", params: { field_count: 5 } };
const finish = { km: 100, type: "finish", params: { top: [{ rider_id: "later", rank: 1 }] } };

test("morning participants, later attackers and passive splits have different histories", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
    { km: 50, type: "finale_attack", params: { direction: "descent", group_id: "late", rider_ids: ["later"] } },
    { km: 60, type: "peloton_splits", params: { source_group_id: "peloton-0", group_id: "tail", rider_ids: ["passive"] } }, finish,
  ], ["a", "b", "later", "passive", "p"]);
  assert.deepEqual([...history.morningRiderIds], ["a", "b"]);
  assert.equal(history.riders.get("later")?.morning, false);
  assert.equal(history.riders.get("later")?.laterAttack, true);
  assert.equal(history.riders.get("passive")?.laterAttack ?? false, false);
  assert.equal(history.complete, true);
});

test("a real merge catches morning riders even if their group id survives", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
    { km: 90, type: "group_merged", params: { group_id: "peloton-0", into_group_id: "escape", rider_ids: ["later", "passive", "p"] } }, finish,
  ], ["a", "b", "later", "passive", "p"]);
  assert.equal(history.riders.get("a")?.caught, true);
  assert.equal(history.riders.get("b")?.caught, true);
  assert.equal(history.riders.get("p")?.morning ?? false, false);
});

test("winning after a catch does not turn the morning break into a survival", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 80, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 100, type: "breakaway_survived", params: { group_id: "later", rider_ids: ["a"] } }, finish,
  ]);
  assert.equal(history.riders.get("a")?.caught, true);
  assert.equal(history.riders.get("a")?.survived, false);
});

test("a stage-decided result event is not proof of an offensive attack", () => {
  const history = deriveParticipationHistory([start, { km: 100, type: "finale_attack", params: { kind: "stage_decided", rider_id: "a" } }, finish]);
  assert.equal(history.riders.get("a")?.laterAttack ?? false, false);
});

test("partial history does not invent participants or an outcome from a group name", () => {
  const history = deriveParticipationHistory([{ km: 80, type: "gap_update", params: { group_id: "breakaway-0", gap_seconds: 0 } }]);
  assert.equal(history.complete, false);
  assert.equal(history.morningRiderIds.size, 0);
  assert.equal(history.riders.size, 0);
});

test("a departed morning rider is absent when the remaining escape is caught", () => {
  for (const outcome of ["time_loss", "abandoned"]) {
    const history = deriveParticipationHistory([start,
      { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
      { km: 30, type: "incident", params: { rider_id: "a", outcome } },
      { km: 90, type: "group_merged", params: { group_id: "peloton-0", into_group_id: "escape", rider_ids: ["p"] } }, finish,
    ], ["a", "b", "p"]);
    assert.equal(history.riders.get("a")?.caught, false);
    assert.equal(history.riders.get("b")?.caught, true);
  }
});