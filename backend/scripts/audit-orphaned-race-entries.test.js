import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "./audit-orphaned-race-entries.js";

test("summarize: empty input", () => {
  const s = summarize([]);
  assert.equal(s.total, 0);
  assert.equal(s.distinct_races, 0);
  assert.equal(s.auto_filled_count, 0);
  assert.equal(s.not_auto_filled_count, 0);
  assert.deepEqual(s.by_race_status, {});
  assert.deepEqual(s.by_season_id, {});
  assert.equal(s.earliest_created_at, null);
  assert.equal(s.latest_created_at, null);
});

test("summarize: matches the shape verified against prod (#3817 — 36 rows)", () => {
  const rows = [
    {
      race_id: "race-a",
      rider_id: "rider-1",
      is_auto_filled: true,
      created_at: "2026-06-29T10:09:07.507759+00:00",
      races: { status: "completed", season_id: "season-1" },
    },
    {
      race_id: "race-a",
      rider_id: "rider-2",
      is_auto_filled: true,
      created_at: "2026-07-22T08:06:24.034252+00:00",
      races: { status: "completed", season_id: "season-1" },
    },
    {
      race_id: "race-b",
      rider_id: "rider-3",
      is_auto_filled: false,
      created_at: "2026-07-10T00:00:00.000000+00:00",
      races: { status: "scheduled", season_id: "season-2" },
    },
  ];

  const s = summarize(rows);
  assert.equal(s.total, 3);
  assert.equal(s.distinct_races, 2);
  assert.equal(s.auto_filled_count, 2);
  assert.equal(s.not_auto_filled_count, 1);
  assert.deepEqual(s.by_race_status, { completed: 2, scheduled: 1 });
  assert.deepEqual(s.by_season_id, { "season-1": 2, "season-2": 1 });
  assert.equal(s.earliest_created_at, "2026-06-29T10:09:07.507759+00:00");
  assert.equal(s.latest_created_at, "2026-07-22T08:06:24.034252+00:00");
});

test("summarize: missing races join falls back to 'unknown'", () => {
  const rows = [
    { race_id: "race-c", rider_id: "rider-4", is_auto_filled: true, created_at: "2026-01-01T00:00:00.000000+00:00", races: null },
  ];
  const s = summarize(rows);
  assert.deepEqual(s.by_race_status, { unknown: 1 });
  assert.deepEqual(s.by_season_id, { unknown: 1 });
});
