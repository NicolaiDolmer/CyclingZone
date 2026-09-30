import test from "node:test";
import assert from "node:assert/strict";
import { rankedFromV4Output } from "./raceEngineV4Bridge.js";
import { deriveBreakawayStatus } from "./raceSimulator.js";

test("#5953 v4 output flags formation members, not later group members", () => {
  const output = {
    results: [
      { rider_id: "late", rank: 1, time_seconds: 100, status: "finished" },
      { rider_id: "a", rank: 2, time_seconds: 103, status: "finished" },
      { rider_id: "p", rank: 3, time_seconds: 110, status: "finished" },
    ],
    groupSnapshots: [{ km: 70, groups: [{ group_id: "breakaway-0", kind: "breakaway", rider_ids: ["a", "late", "p"], gap_seconds: 0 }] }],
    timeline: { events: [
      { km: 0, type: "stage_start", params: { field_count: 3 } },
      { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a"] } },
      { km: 50, type: "finale_attack", params: { direction: "descent", group_id: "late", rider_ids: ["late"] } },
      { km: 100, type: "finish", params: { top: [{ rider_id: "late", rank: 1 }] } },
    ] },
  };
  const ranked = rankedFromV4Output(output);
  assert.deepEqual(ranked.map((row) => row.components.breakaway), [0, 1, 0]);
});

test("#5953 a morning rider who was caught and subsequently won stays caught", () => {
  const output = {
    results: [{ rider_id: "a", rank: 1, time_seconds: 100, status: "finished" }, { rider_id: "p", rank: 2, time_seconds: 110, status: "finished" }],
    groupSnapshots: [{ km: 12, groups: [{ group_id: "breakaway-0", kind: "breakaway", rider_ids: ["a"], gap_seconds: 0 }] }],
    timeline: { events: [
      { km: 0, type: "stage_start", params: { field_count: 2 } },
      { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a"] } },
      { km: 80, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a"] } },
      { km: 100, type: "finish", params: { top: [{ rider_id: "a", rank: 1 }] } },
    ] },
  };
  assert.deepEqual(deriveBreakawayStatus(rankedFromV4Output(output)).get("a"), { in_breakaway: true, breakaway_caught: true });
});

test("unknown morning-break outcome remains unknown internally without inventing a rank-based catch", () => {
  const output = {
    results: [{ rider_id: "p", rank: 1, time_seconds: 100, status: "finished" }, { rider_id: "a", rank: 2, time_seconds: 110, status: "finished" }],
    timeline: { events: [
      { km: 0, type: "stage_start", params: { field_count: 2 } },
      { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
      { km: 100, type: "finish", params: { top: [{ rider_id: "p", rank: 1 }] } },
    ] },
  };
  const ranked = rankedFromV4Output(output);
  assert.equal(ranked.find(row => row.rider_id === "a")?.breakaway_status.breakaway_caught, null);
  assert.deepEqual(deriveBreakawayStatus(ranked).get("a"), { in_breakaway: true, breakaway_caught: false }, "legacy NOT NULL flags do not infer a catch from rank; native history carries the unknown outcome");
});