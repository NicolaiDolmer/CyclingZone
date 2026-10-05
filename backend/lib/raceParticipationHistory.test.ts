import test from "node:test";
import assert from "node:assert/strict";
import { deriveParticipationHistory, settleBreakawayOutcome, bestNonEscapeeRank, breakawayFlagsForOutcome } from "./raceParticipationHistory.ts";
import { PENISOLA_STAGE3_EVENTS, PENISOLA_STAGE3_RANKS, PENISOLA_DROPPED, PENISOLA_CAUGHT } from "./raceParticipationHistory.fixtures.ts";
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

// ── #6185: "dropped from the break" is its own third state ──────────────────

test("#6185 anchor: Penisola stage 3 escapees dropped at km 162 are dropped, not held home and not caught", () => {
  const ids = Object.keys(PENISOLA_STAGE3_RANKS);
  const history = deriveParticipationHistory(PENISOLA_STAGE3_EVENTS, ids);
  assert.equal(history.complete, true);
  for (const id of PENISOLA_DROPPED) {
    const rider = history.riders.get(id);
    assert.equal(rider?.morning, true, id);
    assert.equal(rider?.dropped, true, `${id} dropped`);
    assert.equal(rider?.caught, false, `${id} not caught`);
    assert.equal(rider?.survived, false, `${id} not survived`);
  }
  for (const id of PENISOLA_CAUGHT) assert.equal(history.riders.get(id)?.caught, true, `${id} caught`);
  for (const id of PENISOLA_CAUGHT) assert.equal(history.riders.get(id)?.dropped, false, `${id} not dropped`);
  // A later attack by a rider who is then dropped keeps both facts.
  assert.equal(history.riders.get("e1")?.laterAttack, true);
});

test("#6185 anchor: settled outcomes and persisted flags for the Penisola stage", () => {
  const ids = Object.keys(PENISOLA_STAGE3_RANKS);
  const history = deriveParticipationHistory(PENISOLA_STAGE3_EVENTS, ids);
  const best = bestNonEscapeeRank(ids.map((id) => ({ rank: PENISOLA_STAGE3_RANKS[id], escapee: history.morningRiderIds.has(id) })));
  assert.equal(best, 1);
  const outcome = (id: string) => settleBreakawayOutcome(history.riders.get(id), PENISOLA_STAGE3_RANKS[id] > best);
  for (const id of PENISOLA_DROPPED) {
    assert.equal(outcome(id), "dropped", id);
    assert.deepEqual(breakawayFlagsForOutcome(true, outcome(id)), { in_breakaway: true, breakaway_caught: false, breakaway_dropped: true });
  }
  for (const id of PENISOLA_CAUGHT) assert.equal(outcome(id), "caught", id);
  assert.equal(outcome("w"), null);
  assert.deepEqual(breakawayFlagsForOutcome(false, null), { in_breakaway: false, breakaway_caught: false, breakaway_dropped: false });
});

test("#6185 being swallowed by the bunch after the drop keeps the drop", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
    { km: 60, type: "peloton_splits", params: { source_group_id: "escape", group_id: "chase", rider_ids: ["a"] } },
    { km: 70, type: "group_merged", params: { group_id: "chase", into_group_id: "peloton-0", rider_ids: ["a"] } },
    { km: 95, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["b"] } }, finish,
  ], ["a", "b", "p"]);
  assert.equal(history.riders.get("a")?.dropped, true);
  assert.equal(history.riders.get("a")?.caught, false);
  assert.equal(history.riders.get("b")?.caught, true);
  assert.equal(history.riders.get("b")?.dropped, false);
});

test("#6185 a split after the catch is not a drop from the break", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 50, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 80, type: "peloton_splits", params: { source_group_id: "peloton-0", group_id: "tail", rider_ids: ["a"] } }, finish,
  ], ["a", "p"]);
  assert.equal(history.riders.get("a")?.caught, true);
  assert.equal(history.riders.get("a")?.dropped, false);
});

test("#6185 the engine's verdict at the line wins over an earlier drop", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
    { km: 60, type: "peloton_splits", params: { source_group_id: "escape", group_id: "chase", rider_ids: ["b"] } },
    { km: 100, type: "breakaway_survived", params: { group_id: "chase", rider_ids: ["b"] } }, finish,
  ], ["a", "b", "p"]);
  assert.equal(history.riders.get("b")?.survived, true);
  assert.equal(history.riders.get("b")?.dropped, false);
});

test("#6185 part 2 ready: an explicit breakaway_dropped event is read when present", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
    { km: 140, type: "breakaway_dropped", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 150, type: "group_merged", params: { group_id: "peloton-0", into_group_id: "escape", rider_ids: ["p"] } }, finish,
  ], ["a", "b", "p"]);
  assert.equal(history.riders.get("a")?.dropped, true);
  assert.equal(history.riders.get("a")?.caught, false);
  assert.equal(history.riders.get("b")?.caught, true);
  // Non-morning riders named in the event are ignored.
  const other = deriveParticipationHistory([start, { km: 10, type: "breakaway_dropped", params: { rider_ids: ["x"] } }, finish]);
  assert.equal(other.riders.get("x")?.dropped ?? false, false);
});

test("#6185 losing time out of the break is a drop", () => {
  const history = deriveParticipationHistory([start,
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a", "b"] } },
    { km: 30, type: "incident", params: { rider_id: "a", outcome: "time_loss" } }, finish,
  ], ["a", "b", "p"]);
  assert.equal(history.riders.get("a")?.dropped, true);
});

test("#6185 finish safety net: an uncaught escapee behind a non-escapee is never held home", () => {
  const morning = { morning: true, caught: false, survived: false, dropped: false };
  assert.equal(settleBreakawayOutcome(morning, true), "dropped");
  assert.equal(settleBreakawayOutcome({ ...morning, survived: true }, true), "caught");
  assert.equal(settleBreakawayOutcome({ ...morning, survived: true }, false), "survived");
  assert.equal(settleBreakawayOutcome(morning, false), null);
  assert.equal(settleBreakawayOutcome(morning, null), null);
  assert.equal(settleBreakawayOutcome({ ...morning, caught: true }, true), "caught");
  assert.equal(settleBreakawayOutcome({ ...morning, morning: false }, true), null);
  assert.equal(settleBreakawayOutcome(null, true), null);
  assert.deepEqual(breakawayFlagsForOutcome(true, null), { in_breakaway: true, breakaway_caught: false, breakaway_dropped: null });
  assert.deepEqual(breakawayFlagsForOutcome(true, "survived"), { in_breakaway: true, breakaway_caught: false, breakaway_dropped: false });
});