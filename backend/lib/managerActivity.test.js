// [epic #4592] Inaktiv manager (S3-forberedelse) · Tests for managerActivity.js.
// Dækker grænserne eksplicit (29/30/31 dage), null/ugyldig last_seen, og en
// fremtidig dato (ugyldigt input, men skal ikke fejle eller tælle som dormant).

import test from "node:test";
import assert from "node:assert/strict";

import { daysSinceLastSeen, isDormantManager, dormancyBucket } from "./managerActivity.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-09-02T12:00:00Z");

function daysAgo(days) {
  return { last_seen: new Date(NOW.getTime() - days * DAY_MS).toISOString() };
}

test("daysSinceLastSeen: beregner korrekt antal dage", () => {
  assert.equal(daysSinceLastSeen(daysAgo(10), NOW), 10);
  assert.equal(daysSinceLastSeen({ last_seen: null }, NOW), null);
  assert.equal(daysSinceLastSeen(null, NOW), null);
  assert.equal(daysSinceLastSeen({}, NOW), null);
});

test("daysSinceLastSeen: ugyldig dato-streng giver null, ikke NaN/kast", () => {
  assert.equal(daysSinceLastSeen({ last_seen: "ikke-en-dato" }, NOW), null);
});

test("daysSinceLastSeen: fremtidig last_seen giver negativt tal", () => {
  const future = { last_seen: new Date(NOW.getTime() + 5 * DAY_MS).toISOString() };
  assert.equal(daysSinceLastSeen(future, NOW), -5);
});

test("isDormantManager: grænse 29 dage = aktiv (ikke dormant)", () => {
  assert.equal(isDormantManager(daysAgo(29), NOW), false);
});

test("isDormantManager: grænse 30 dage = dormant (inklusiv)", () => {
  assert.equal(isDormantManager(daysAgo(30), NOW), true);
});

test("isDormantManager: grænse 31 dage = dormant", () => {
  assert.equal(isDormantManager(daysAgo(31), NOW), true);
});

test("isDormantManager: manglende last_seen = dormant", () => {
  assert.equal(isDormantManager({ last_seen: null }, NOW), true);
  assert.equal(isDormantManager(null, NOW), true);
});

test("isDormantManager: fremtidig last_seen = ikke dormant", () => {
  const future = { last_seen: new Date(NOW.getTime() + 3 * DAY_MS).toISOString() };
  assert.equal(isDormantManager(future, NOW), false);
});

test("isDormantManager: respekterer custom days-tærskel", () => {
  assert.equal(isDormantManager(daysAgo(14), NOW, { days: 14 }), true);
  assert.equal(isDormantManager(daysAgo(13), NOW, { days: 14 }), false);
});

test("dormancyBucket: grænser 7/8/29/30/31 dage", () => {
  assert.equal(dormancyBucket(daysAgo(0), NOW), "active_7d");
  assert.equal(dormancyBucket(daysAgo(7), NOW), "active_7d");
  assert.equal(dormancyBucket(daysAgo(8), NOW), "away_8_30d");
  assert.equal(dormancyBucket(daysAgo(29), NOW), "away_8_30d");
  assert.equal(dormancyBucket(daysAgo(30), NOW), "dormant_30d");
  assert.equal(dormancyBucket(daysAgo(31), NOW), "dormant_30d");
});

test("dormancyBucket: manglende last_seen = dormant_30d", () => {
  assert.equal(dormancyBucket({ last_seen: null }, NOW), "dormant_30d");
  assert.equal(dormancyBucket(null, NOW), "dormant_30d");
});

test("dormancyBucket: fremtidig last_seen = active_7d", () => {
  const future = { last_seen: new Date(NOW.getTime() + 2 * DAY_MS).toISOString() };
  assert.equal(dormancyBucket(future, NOW), "active_7d");
});

test("dormancyBucket og isDormantManager er konsistente ved dormantDays-grænsen", () => {
  for (const days of [29, 30, 31]) {
    const bucket = dormancyBucket(daysAgo(days), NOW);
    const dormant = isDormantManager(daysAgo(days), NOW);
    assert.equal(bucket === "dormant_30d", dormant, `dag ${days}: bucket=${bucket} dormant=${dormant}`);
  }
});
