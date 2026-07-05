import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationRowsForStage } from "./raceStageClassifications.js";

function row(result_type, stage_number, rank, rider_id = null, team_id = null) {
  return { id: `${result_type}-${stage_number}-${rank}`, result_type, stage_number, rank, rider_id, team_id, finish_time: null };
}

test("key='stage' returns 'stage' rows for the given stage_number, sorted by rank", () => {
  const results = [row("stage", 2, 2, "b"), row("stage", 1, 1, "z"), row("stage", 2, 1, "a")];
  const out = classificationRowsForStage(results, 2, "stage");
  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b"]);
});

test("key='gc' on a mid-race stage falls back to 'leader' day-type rows", () => {
  const results = [
    row("leader", 2, 1, "a"), row("leader", 2, 2, "b"),
    row("gc", 3, 1, "a"), // final stage 3 — must NOT leak into stage 2's query
  ];
  const out = classificationRowsForStage(results, 2, "gc");
  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b"]);
});

test("key='gc' on the final stage returns the persisted final 'gc' rows, not 'leader'", () => {
  const results = [
    row("leader", 3, 1, "wrong-if-returned"),
    row("gc", 3, 1, "a"), row("gc", 3, 2, "b"),
  ];
  const out = classificationRowsForStage(results, 3, "gc");
  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b"]);
});

test("key='team' on a mid-race stage uses persisted 'team_day' rows when present", () => {
  const results = [row("team_day", 2, 1, null, "A"), row("team_day", 2, 2, null, "B")];
  const out = classificationRowsForStage(results, 2, "team");
  assert.deepEqual(out.map((r) => r.team_id), ["A", "B"]);
});

test("key='team' on a legacy mid-race stage (no team_day rows) derives from 'leader' gaps", () => {
  const results = [
    { ...row("leader", 2, 1, "a", "A"), finish_time: "+0:00" },
    { ...row("leader", 2, 2, "b", "B"), finish_time: "+0:10" },
  ];
  const out = classificationRowsForStage(results, 2, "team");
  assert.deepEqual(out.map((r) => r.team_id), ["A", "B"]);
});

test("no matching rows for the requested stage/key returns an empty array", () => {
  assert.deepEqual(classificationRowsForStage([], 1, "points"), []);
  assert.deepEqual(classificationRowsForStage(undefined, 1, "young"), []);
});
