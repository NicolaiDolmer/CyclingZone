import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stageStatus,
  countdownParts,
  countdownSegments,
  relativeDayKey,
  RACE_TIMEZONE,
  formatCountdown,
} from "./stageScheduleConfig.js";

// Minimal fake t() — matcher i18next-signaturen godt nok til at teste formatCountdown
// uden en ægte i18next-instans (samme mønster som resten af filen: ren logik, ingen DOM).
function fakeT(key, opts) {
  if (key === "races:detail.stageSchedule.startingNow") return "Starting now";
  if (key === "races:detail.stageSchedule.countdownPrefix") return "in";
  const count = opts?.count;
  if (key === "races:detail.stageSchedule.countdownDays") return `${count} day${count === 1 ? "" : "s"}`;
  if (key === "races:detail.stageSchedule.countdownHours") return `${count} hour${count === 1 ? "" : "s"}`;
  if (key === "races:detail.stageSchedule.countdownMinutes") return `${count} min`;
  return key;
}

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

// #3243 — formatCountdown genbruges af TeamSelectionCtaCard (nyt holds
// første-løb-CTA) og DashboardPage ("Kommende løb"). Samme streng begge steder.
test("formatCountdown renders 'starting now' for past/now scheduled times", () => {
  assert.equal(formatCountdown(1000, 5000, fakeT), "Starting now");
});

test("formatCountdown renders prefix + the two most-significant segments", () => {
  const nowMs = 0;
  const scheduledMs = (1 * 24 * 60 + 3 * 60) * 60 * 1000; // 1d 3h
  assert.equal(formatCountdown(scheduledMs, nowMs, fakeT), "in 1 day 3 hours");
});

test("formatCountdown falls back to minutes-only under an hour", () => {
  const nowMs = 0;
  const scheduledMs = 12 * 60 * 1000; // 12 min
  assert.equal(formatCountdown(scheduledMs, nowMs, fakeT), "in 12 min");
});
