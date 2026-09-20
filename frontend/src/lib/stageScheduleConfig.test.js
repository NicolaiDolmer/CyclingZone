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

// #5302: efterårs-DST i København (sidste søndag i oktober) — dagen har 25
// timer, urene stilles 1 time tilbage kl. 03:00 CEST → 02:00 CET. Et naivt
// "now + 24h elapsed ms" rammer derfor IKKE næste kalenderdag, og 'tomorrow'
// forsvinder fra StageScheduleCard. Repro fra issuet: now 2026-10-24T22:30:00Z
// (= 2026-10-25 00:30 CEST, altså allerede København-dag 25.), scheduled_at
// 2026-10-26T12:00:00Z (= 2026-10-26 13:00 CET) → forventet 'tomorrow'.
test("#5302: relativeDayKey overlever efterårs-DST (25-timers-dag)", () => {
  const now = new Date("2026-10-24T22:30:00Z");
  const scheduledAt = new Date("2026-10-26T12:00:00Z");
  assert.equal(relativeDayKey(scheduledAt, now), "tomorrow");
  // Selve DST-dagen (25.) er stadig "today" for et løb samme København-dag.
  assert.equal(relativeDayKey(new Date("2026-10-25T10:00:00Z"), now), "today");
});

// Forårs-DST (sidste søndag i marts) — dagen har kun 23 timer, urene stilles
// 1 time frem kl. 02:00 CET → 03:00 CEST. Her ville et naivt "+24h" i
// virkeligheden overskyde næste kalenderdag — modsat retning af efterårs-
// bugget, men samme rodårsag (elapsed ms i stedet for kalenderdag).
test("#5302: relativeDayKey overlever forårs-DST (23-timers-dag)", () => {
  const now = new Date("2026-03-28T22:30:00Z"); // 2026-03-28 23:30 CET → København-dag 28.
  assert.equal(relativeDayKey(new Date("2026-03-29T12:00:00Z"), now), "tomorrow");
  assert.equal(relativeDayKey(new Date("2026-03-28T12:00:00Z"), now), "today");
});

// Almindelig dag uden DST-skift — kontrolgruppe der skal blive ved med at virke.
test("#5302: relativeDayKey virker uændret på en almindelig dag", () => {
  const now = new Date("2026-06-10T08:00:00Z");
  assert.equal(relativeDayKey(new Date("2026-06-11T12:00:00Z"), now), "tomorrow");
  assert.equal(relativeDayKey(new Date("2026-06-10T20:00:00Z"), now), "today");
});

// Årsskifte — Date.UTC skal selv normalisere måneds-/årsskiftet når dagen
// (31.) + 1 kalenderdag ruller over i januar næste år.
test("#5302: relativeDayKey ruller korrekt over årsskiftet", () => {
  // 2025-12-31 23:30 CET = 2025-12-31 22:30 UTC.
  const now = new Date("2025-12-31T22:30:00Z");
  // 2026-01-01 13:00 CET = 2026-01-01 12:00 UTC.
  assert.equal(relativeDayKey(new Date("2026-01-01T12:00:00Z"), now), "tomorrow");
  assert.equal(relativeDayKey(new Date("2025-12-31T20:00:00Z"), now), "today");
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

test("#5290: explicit Copenhagen dates before and after midnight", () => {
  const nextStage = "2026-09-16T12:00:00Z";
  const previousStage = "2026-09-15T13:00:00Z";
  for (const now of ["2026-09-15T16:06:00Z", "2026-09-15T21:30:00Z"]) {
    const reference = new Date(now);
    assert.equal(relativeDayKey(nextStage, reference), "tomorrow");
    assert.equal(relativeDayKey(previousStage, reference), "today");
  }
  const afterMidnight = new Date("2026-09-15T22:30:00Z");
  assert.equal(relativeDayKey(nextStage, afterMidnight), "today");
  assert.equal(relativeDayKey(previousStage, afterMidnight), null);
  assert.equal(relativeDayKey("2026-09-17T12:00:00Z", afterMidnight), "tomorrow");
  assert.equal(relativeDayKey("not-a-date", afterMidnight), null);
});
