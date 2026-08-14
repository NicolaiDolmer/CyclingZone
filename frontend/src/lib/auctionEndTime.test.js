import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultEndWallClock,
  gameWallClockToUTC,
  getEndTimeIssue,
  utcToGameWallClock,
  windowHoursForWallClock,
} from "./auctionEndTime.js";

// Prod-configen: 08-24 alle dage.
const PROD = {
  weekday_open_hour: 8, weekday_close_hour: 24,
  weekend_open_hour: 8, weekend_close_hour: 24,
  min_hours: 1, max_hours: 48,
};

test("gameWallClockToUTC: sommertid (CEST, UTC+2)", () => {
  // 15/8 2026 er CEST → 20:44 Copenhagen = 18:44 UTC
  assert.equal(gameWallClockToUTC("2026-08-15T20:44").toISOString(), "2026-08-15T18:44:00.000Z");
});

test("gameWallClockToUTC: vintertid (CET, UTC+1)", () => {
  // 15/1 2026 er CET → 20:44 Copenhagen = 19:44 UTC
  assert.equal(gameWallClockToUTC("2026-01-15T20:44").toISOString(), "2026-01-15T19:44:00.000Z");
});

test("gameWallClockToUTC: ugyldig input → Invalid Date", () => {
  assert.ok(Number.isNaN(gameWallClockToUTC("").getTime()));
  assert.ok(Number.isNaN(gameWallClockToUTC("ikke-en-dato").getTime()));
  assert.ok(Number.isNaN(gameWallClockToUTC(null).getTime()));
});

test("utcToGameWallClock: rundtur bevarer klokkeslættet", () => {
  const wall = "2026-08-15T20:44";
  assert.equal(utcToGameWallClock(gameWallClockToUTC(wall)), wall);
});

test("windowHoursForWallClock: lørdag læses som weekend", () => {
  // 15/8 2026 er en lørdag
  const cfg = { weekday_open_hour: 16, weekday_close_hour: 22, weekend_open_hour: 8, weekend_close_hour: 23 };
  assert.deepEqual(windowHoursForWallClock("2026-08-15T20:44", cfg), { openHour: 8, closeHour: 23 });
  // 14/8 2026 er en fredag
  assert.deepEqual(windowHoursForWallClock("2026-08-14T20:44", cfg), { openHour: 16, closeHour: 22 });
});

test("getEndTimeIssue: gyldigt tidspunkt inde i vinduet → null", () => {
  const now = gameWallClockToUTC("2026-08-15T10:00");
  assert.equal(getEndTimeIssue("2026-08-15T20:44", now, PROD), null);
});

test("getEndTimeIssue: under 1 time frem → end_too_soon", () => {
  const now = gameWallClockToUTC("2026-08-15T10:00");
  assert.equal(getEndTimeIssue("2026-08-15T10:30", now, PROD).code, "end_too_soon");
});

test("getEndTimeIssue: over 48 timer frem → end_too_late", () => {
  const now = gameWallClockToUTC("2026-08-15T10:00");
  assert.equal(getEndTimeIssue("2026-08-17T11:00", now, PROD).code, "end_too_late");
});

test("getEndTimeIssue: natten afvises", () => {
  const now = gameWallClockToUTC("2026-08-15T10:00");
  const issue = getEndTimeIssue("2026-08-16T03:44", now, PROD);
  assert.equal(issue.code, "end_outside_window");
  assert.equal(issue.openHour, 8);
});

test("getEndTimeIssue: 23:59 er gyldigt når lukketid er 24", () => {
  const now = gameWallClockToUTC("2026-08-15T10:00");
  assert.equal(getEndTimeIssue("2026-08-15T23:59", now, PROD), null);
});

test("getEndTimeIssue: klienten spejler serveren på kortere lukketid", () => {
  const cfg = { ...PROD, weekend_close_hour: 22 };
  const now = gameWallClockToUTC("2026-08-15T10:00");
  assert.equal(getEndTimeIssue("2026-08-15T22:30", now, cfg).code, "end_outside_window");
  assert.equal(getEndTimeIssue("2026-08-15T21:30", now, cfg), null);
});

test("getEndTimeIssue: tom værdi → invalid_end_time", () => {
  assert.equal(getEndTimeIssue("", new Date(), PROD).code, "invalid_end_time");
});

test("defaultEndWallClock: 12 timer frem når det lander i vinduet", () => {
  const now = gameWallClockToUTC("2026-08-15T10:00");
  assert.equal(defaultEndWallClock(now, PROD), "2026-08-15T22:00");
});

test("defaultEndWallClock: trækkes ind i vinduet når 12 timer frem er nat", () => {
  // 20:00 + 12t = 08:00 næste dag, som er præcis åbningstid → gyldigt
  const now = gameWallClockToUTC("2026-08-15T20:00");
  const wall = defaultEndWallClock(now, PROD);
  assert.equal(getEndTimeIssue(wall, now, PROD), null);
});

test("defaultEndWallClock: forslaget er altid gyldigt hen over døgnet", () => {
  for (let hour = 0; hour < 24; hour++) {
    const now = gameWallClockToUTC(`2026-08-15T${String(hour).padStart(2, "0")}:00`);
    const wall = defaultEndWallClock(now, PROD);
    assert.equal(getEndTimeIssue(wall, now, PROD), null, `fejlede ved kl. ${hour}`);
  }
});
