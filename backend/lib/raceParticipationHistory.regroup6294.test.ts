import test from "node:test";
import assert from "node:assert/strict";
import { deriveParticipationHistory, settleBreakawayOutcome, breakawayFlagsForOutcome, nonEscapeeAheadByRider, withoutRegroupCatches } from "./raceParticipationHistory.ts";
import type { ParticipationEvent } from "./raceParticipationHistory.ts";

// #6294 anchor (prod shape, anonymised): a four-rider morning break; one
// escapee crashes (the incident names no group, so his solo group is unknown
// to the projection), rides back and the engine records it as a
// breakaway_caught by his solo group plus the group_merged of that group into
// the break on the same km. The break then holds on to the line.
const BREAK = ["e1", "e2", "e3", "e4"];
const crashRegroupStage: ParticipationEvent[] = [
  { km: 0, type: "stage_start", params: { distance_km: 180 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: BREAK } },
  { km: 61.27, type: "incident", params: { kind: "crash", outcome: "time_loss", rider_id: "e3", severity: "light", time_loss_seconds: 8 } },
  { km: 91.61, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e1", "e2", "e4"], chase_group_id: "solo-m10-3-0", chase_group_kind: "solo" } },
  { km: 91.61, type: "group_merged", params: { group_id: "solo-m10-3-0", into_group_id: "breakaway-0", rider_ids: ["e3"] } },
  { km: 180, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: BREAK, gap_seconds: 150 } },
  { km: 180, type: "finish", params: { top: [{ rider_id: "e2", rank: 1 }] } },
];
const ROWS = [
  { rider_id: "e2", rank: 1 }, { rider_id: "e3", rank: 2 }, { rider_id: "e1", rank: 3 }, { rider_id: "e4", rank: 4 }, { rider_id: "p1", rank: 5 },
];

test("#6294 anchor: a crashed escapee riding back to the break is a regroup, not a catch", () => {
  const history = deriveParticipationHistory(crashRegroupStage, [...BREAK, "p1"]);
  const ahead = nonEscapeeAheadByRider(history, ROWS);
  for (const id of BREAK) {
    const outcome = settleBreakawayOutcome(history.riders.get(id), ahead.get(id) ?? null);
    assert.equal(outcome, "survived", `${id} held home`);
    assert.deepEqual(breakawayFlagsForOutcome(true, outcome), { in_breakaway: true, breakaway_caught: false, breakaway_dropped: false });
  }
  assert.equal(history.regroupCatches.size, 1);
});

test("#6294 the film loses the false catch line but keeps the regroup merge", () => {
  const film = withoutRegroupCatches(crashRegroupStage);
  assert.equal(film.some((event) => event.type === "breakaway_caught"), false);
  assert.equal(film.filter((event) => event.type === "group_merged").length, 1);
  assert.equal(film.length, crashRegroupStage.length - 1);
});

test("#6294 a closing group with one rider outside the break is still a catch", () => {
  const events: ParticipationEvent[] = [
    ...crashRegroupStage.slice(0, 3),
    { km: 91.61, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e1", "e2", "e4"], chase_group_id: "chase-9", chase_group_kind: "chase" } },
    { km: 91.61, type: "group_merged", params: { group_id: "chase-9", into_group_id: "breakaway-0", rider_ids: ["e3", "p1"] } },
    { km: 180, type: "finish", params: {} },
  ];
  const history = deriveParticipationHistory(events, [...BREAK, "p1"]);
  assert.equal(history.riders.get("e1")?.caught, true);
  assert.equal(history.regroupCatches.size, 0);
  assert.equal(withoutRegroupCatches(events).length, events.length);
});

test("#6294 an unknown closing group without a matching merge stays a catch (no invented regroup)", () => {
  const events: ParticipationEvent[] = [
    ...crashRegroupStage.slice(0, 2),
    { km: 120, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: BREAK, chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
    { km: 120, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: BREAK } },
    { km: 180, type: "finish", params: {} },
  ];
  const history = deriveParticipationHistory(events);
  for (const id of BREAK) assert.equal(history.riders.get(id)?.caught, true);
  assert.equal(history.regroupCatches.size, 0);
});

test("#6294 a merge on another km does not decide the catch", () => {
  const events: ParticipationEvent[] = [
    ...crashRegroupStage.slice(0, 3),
    { km: 91.61, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e1", "e2", "e4"], chase_group_id: "solo-m10-3-0", chase_group_kind: "solo" } },
    { km: 95, type: "group_merged", params: { group_id: "solo-m10-3-0", into_group_id: "breakaway-0", rider_ids: ["e3"] } },
    { km: 180, type: "finish", params: {} },
  ];
  assert.equal(deriveParticipationHistory(events).regroupCatches.size, 0);
});
