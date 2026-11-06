import test from "node:test";
import assert from "node:assert/strict";
import { trainNowEarlierDay, trainNowLockCopy } from "./trainNowClock.ts";

// #7558: a stage race that started yesterday keeps yesterday's lock on today's board.
// "Today" may only be claimed when the press really was today (Copenhagen game day).
const NOW = new Date("2026-11-02T10:00:00Z"); // 11:00 in Copenhagen

const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;

test("press earlier today: no earlier day", () => {
  assert.equal(trainNowEarlierDay("2026-11-02T07:12:00Z", "da", NOW), null);
});

test("unknown press time: wording unchanged", () => {
  assert.equal(trainNowEarlierDay(null, "da", NOW), null);
  assert.equal(trainNowEarlierDay("not-a-date", "da", NOW), null);
});

test("press yesterday: relative day label", () => {
  assert.equal(trainNowEarlierDay("2026-11-01T13:00:00Z", "en", NOW), "yesterday");
  assert.equal(trainNowEarlierDay("2026-11-01T13:00:00Z", "da", NOW), "i går");
});

test("press older than yesterday: short date label, not today and not yesterday", () => {
  const label = trainNowEarlierDay("2026-10-29T13:00:00Z", "en", NOW);
  assert.ok(label && !/yesterday/.test(label));
});

test("game day is Copenhagen, not UTC: a press just after Copenhagen midnight is today", () => {
  // 23:30 UTC on 1 Nov is 00:30 on 2 Nov in Copenhagen (CET).
  assert.equal(trainNowEarlierDay("2026-11-01T23:30:00Z", "en", NOW), null);
});

test("game day is Copenhagen, not UTC: a press just before Copenhagen midnight is yesterday", () => {
  // 22:30 UTC on 1 Nov is 23:30 on 1 Nov in Copenhagen.
  assert.equal(trainNowEarlierDay("2026-11-01T22:30:00Z", "en", NOW), "yesterday");
});

test("copy: today keeps the existing today keys", () => {
  const copy = trainNowLockCopy(t, "2026-11-02T07:12:00Z", "da", NOW);
  assert.equal(copy.earlier, false);
  assert.match(copy.title, /^selection\.trainNowLock\.title/);
  assert.match(copy.body, /^selection\.trainNowLock\.bodyAt/);
  assert.match(copy.rider, /^selection\.trainNowLock\.rider/);
});

test("copy: unknown press time keeps the existing no-time today keys", () => {
  const copy = trainNowLockCopy(t, null, "da", NOW);
  assert.equal(copy.earlier, false);
  assert.match(copy.body, /^selection\.trainNowLock\.body/);
  assert.doesNotMatch(copy.body, /bodyAt/);
});

test("copy: yesterday's press never uses a today key", () => {
  const copy = trainNowLockCopy(t, "2026-11-01T13:00:00Z", "da", NOW);
  assert.equal(copy.earlier, true);
  assert.match(copy.title, /titleEarlier/);
  assert.match(copy.body, /bodyEarlierAt/);
  assert.match(copy.body, /"day":"i går"/);
  assert.match(copy.body, /"time":"14:00"/);
  assert.match(copy.rider, /riderEarlier/);
});
