import { test } from "node:test";
import assert from "node:assert/strict";
import { latestScheduledMsByRace } from "./raceCompletionDate.js";

test("latestScheduledMsByRace: empty/missing input yields an empty map", () => {
  assert.equal(latestScheduledMsByRace([]).size, 0);
  assert.equal(latestScheduledMsByRace(null).size, 0);
  assert.equal(latestScheduledMsByRace(undefined).size, 0);
});

test("latestScheduledMsByRace: single row maps race_id -> its timestamp", () => {
  const out = latestScheduledMsByRace([{ race_id: "r1", scheduled_at: "2026-07-27T12:00:00Z" }]);
  assert.equal(out.get("r1"), Date.parse("2026-07-27T12:00:00Z"));
});

test("latestScheduledMsByRace: multiple stages for the same race keep the LATEST timestamp", () => {
  const out = latestScheduledMsByRace([
    { race_id: "r1", scheduled_at: "2026-07-27T12:00:00Z" },
    { race_id: "r1", scheduled_at: "2026-07-29T12:00:00Z" }, // final stage, later
    { race_id: "r1", scheduled_at: "2026-07-28T12:00:00Z" },
  ]);
  assert.equal(out.get("r1"), Date.parse("2026-07-29T12:00:00Z"));
});

test("latestScheduledMsByRace: keeps races independent", () => {
  const out = latestScheduledMsByRace([
    { race_id: "r1", scheduled_at: "2026-07-27T12:00:00Z" },
    { race_id: "r2", scheduled_at: "2026-07-20T12:00:00Z" },
  ]);
  assert.equal(out.size, 2);
  assert.equal(out.get("r2"), Date.parse("2026-07-20T12:00:00Z"));
});

test("latestScheduledMsByRace: invalid/unparseable timestamps are skipped", () => {
  const out = latestScheduledMsByRace([
    { race_id: "r1", scheduled_at: "not-a-date" },
    { race_id: "r1", scheduled_at: null },
    { race_id: "r2", scheduled_at: "2026-07-20T12:00:00Z" },
  ]);
  assert.equal(out.has("r1"), false);
  assert.equal(out.get("r2"), Date.parse("2026-07-20T12:00:00Z"));
});
