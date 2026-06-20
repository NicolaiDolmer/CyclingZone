import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stageStatus,
  countdownParts,
  countdownSegments,
  relativeDayKey,
  RACE_TIMEZONE,
} from "./stageScheduleConfig.js";

test("stageStatus classifies done/next/pending from stages_completed", () => {
  // Løbet har afviklet 2 etaper.
  assert.equal(stageStatus(1, 2), "done");
  assert.equal(stageStatus(2, 2), "done");
  assert.equal(stageStatus(3, 2), "next");
  assert.equal(stageStatus(4, 2), "pending");
});

test("stageStatus treats 0 completed as none done, stage 1 next", () => {
  assert.equal(stageStatus(1, 0), "next");
  assert.equal(stageStatus(2, 0), "pending");
});

test("stageStatus tolerates non-finite completed (defaults to 0)", () => {
  assert.equal(stageStatus(1, undefined), "next");
  assert.equal(stageStatus(1, null), "next");
});

test("countdownParts returns null for past/now", () => {
  assert.equal(countdownParts(0), null);
  assert.equal(countdownParts(-5000), null);
  assert.equal(countdownParts(NaN), null);
});

test("countdownParts rounds minutes up so sub-minute does not vanish", () => {
  // 30 sekunder → 1 minut (ikke 0).
  assert.deepEqual(countdownParts(30 * 1000), { days: 0, hours: 0, minutes: 1 });
});

test("countdownParts breaks ms into days/hours/minutes", () => {
  const ms = (1 * 24 * 60 + 3 * 60 + 25) * 60 * 1000; // 1d 3h 25m
  assert.deepEqual(countdownParts(ms), { days: 1, hours: 3, minutes: 25 });
});

test("countdownSegments shows at most two most-significant units", () => {
  assert.deepEqual(countdownSegments({ days: 1, hours: 3, minutes: 25 }), [
    { unit: "days", count: 1 },
    { unit: "hours", count: 3 },
  ]);
  assert.deepEqual(countdownSegments({ days: 0, hours: 5, minutes: 10 }), [
    { unit: "hours", count: 5 },
    { unit: "minutes", count: 10 },
  ]);
  assert.deepEqual(countdownSegments({ days: 0, hours: 0, minutes: 12 }), [
    { unit: "minutes", count: 12 },
  ]);
});

test("countdownSegments drops a zero trailing segment", () => {
  assert.deepEqual(countdownSegments({ days: 2, hours: 0, minutes: 0 }), [
    { unit: "days", count: 2 },
  ]);
  assert.deepEqual(countdownSegments({ days: 0, hours: 4, minutes: 0 }), [
    { unit: "hours", count: 4 },
  ]);
});

test("countdownSegments floors minutes to at least 1", () => {
  assert.deepEqual(countdownSegments({ days: 0, hours: 0, minutes: 0 }), [
    { unit: "minutes", count: 1 },
  ]);
});

test("countdownSegments returns empty for null parts", () => {
  assert.deepEqual(countdownSegments(null), []);
});

test("relativeDayKey detects today/tomorrow in Copenhagen time", () => {
  // Et fast slot 2026-07-04 15:00 CEST = 13:00 UTC.
  const slot = new Date("2026-07-04T13:00:00Z");
  // Samme København-dag, tidligere på dagen.
  assert.equal(relativeDayKey(slot, new Date("2026-07-04T08:00:00Z")), "today");
  // Dagen før → tomorrow.
  assert.equal(relativeDayKey(slot, new Date("2026-07-03T20:00:00Z")), "tomorrow");
  // To dage før → null (vis fuld dato).
  assert.equal(relativeDayKey(slot, new Date("2026-07-02T08:00:00Z")), null);
});

test("relativeDayKey honours Copenhagen midnight boundary, not UTC", () => {
  // 2026-07-04 00:30 CEST = 2026-07-03 22:30 UTC → København-dagen er d. 4.
  const slot = new Date("2026-07-03T22:30:00Z");
  // now: 2026-07-04 09:00 CEST = 07:00 UTC → samme København-dag som slot.
  assert.equal(relativeDayKey(slot, new Date("2026-07-04T07:00:00Z")), "today");
});

test("relativeDayKey returns null for invalid input", () => {
  assert.equal(relativeDayKey("not-a-date"), null);
});

test("RACE_TIMEZONE is the Copenhagen IANA zone", () => {
  assert.equal(RACE_TIMEZONE, "Europe/Copenhagen");
});
