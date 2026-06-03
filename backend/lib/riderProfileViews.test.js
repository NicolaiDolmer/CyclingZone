import test from "node:test";
import assert from "node:assert/strict";
import { aggregateRiderViews } from "./riderProfileViews.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 1, 12, 0, 0); // fast referencepunkt (epoch ms)

// Hjælper: row n timer før NOW.
const hoursAgo = (userId, hours) => ({
  user_id: userId,
  viewed_at: new Date(NOW - hours * 60 * 60 * 1000).toISOString(),
});
const daysAgo = (userId, days) => hoursAgo(userId, days * 24);

// Systemet har kørt længe (>14d) medmindre andet angives, så trend er beregnelig.
const OLD_SYSTEM = NOW - 60 * DAY_MS;

test("tom tabel → nuller + isNew", () => {
  const agg = aggregateRiderViews([], { nowMs: NOW, oldestViewedAtMs: null });
  assert.deepEqual(agg, {
    views24h: 0,
    views7d: 0,
    trend24hPct: null,
    trend7dPct: null,
    isNew: true,
  });
});

test("unikke besøgende dedupes på tværs af vinduet (samme bruger flere rows = 1)", () => {
  const rows = [
    hoursAgo("u1", 1),
    hoursAgo("u1", 5), // samme bruger igen → tæller stadig 1 i 24t
    hoursAgo("u2", 3),
  ];
  const agg = aggregateRiderViews(rows, { nowMs: NOW, oldestViewedAtMs: OLD_SYSTEM });
  assert.equal(agg.views24h, 2);
  assert.equal(agg.views7d, 2);
});

test("24t er en delmængde af 7d (views24h <= views7d)", () => {
  const rows = [hoursAgo("u1", 2), daysAgo("u2", 3), daysAgo("u3", 6)];
  const agg = aggregateRiderViews(rows, { nowMs: NOW, oldestViewedAtMs: OLD_SYSTEM });
  assert.equal(agg.views24h, 1);
  assert.equal(agg.views7d, 3);
  assert.ok(agg.views24h <= agg.views7d);
});

test("trend7dPct: +100% når 7d har dobbelt så mange som forrige 7d", () => {
  const rows = [
    // aktuel 7d: u1, u2 (2 unikke)
    daysAgo("u1", 1),
    daysAgo("u2", 4),
    // forrige 7d (8-14 dage siden): u3 (1 unik)
    daysAgo("u3", 10),
  ];
  const agg = aggregateRiderViews(rows, { nowMs: NOW, oldestViewedAtMs: OLD_SYSTEM });
  assert.equal(agg.views7d, 2);
  assert.equal(agg.trend7dPct, 100);
});

test("trend7dPct: -50% ved fald", () => {
  const rows = [
    daysAgo("u1", 2), // aktuel 7d: 1
    daysAgo("u2", 9), // forrige 7d: u2, u3 = 2
    daysAgo("u3", 11),
  ];
  const agg = aggregateRiderViews(rows, { nowMs: NOW, oldestViewedAtMs: OLD_SYSTEM });
  assert.equal(agg.trend7dPct, -50);
});

test("trend er null når forrige periode er ægte 0 (men historik findes)", () => {
  const rows = [daysAgo("u1", 1)]; // intet i forrige 7d
  const agg = aggregateRiderViews(rows, { nowMs: NOW, oldestViewedAtMs: OLD_SYSTEM });
  assert.equal(agg.views7d, 1);
  assert.equal(agg.trend7dPct, null);
  assert.equal(agg.isNew, false);
});

test("cold-start: <14d historik → isNew + trends undertrykt selv med data i begge vinduer", () => {
  const rows = [
    daysAgo("u1", 1),
    daysAgo("u2", 9), // ville ellers give en forrige-7d-trend
  ];
  const agg = aggregateRiderViews(rows, {
    nowMs: NOW,
    oldestViewedAtMs: NOW - 5 * DAY_MS, // systemet kun 5 dage gammelt
  });
  assert.equal(agg.isNew, true);
  assert.equal(agg.trend24hPct, null);
  assert.equal(agg.trend7dPct, null);
  // rå-tallene vises stadig (u1 i aktuel 7d; u2 ligger i forrige 7d og tæller ikke)
  assert.equal(agg.views7d, 1);
});

test("vinduesgrænser overlapper ikke (besøg lige på 7d-grænsen havner i forrige)", () => {
  const rows = [
    // præcis 7 dage + 1 ms siden → IKKE i aktuel 7d, men i forrige 7d
    { user_id: "u1", viewed_at: new Date(NOW - 7 * DAY_MS - 1).toISOString() },
  ];
  const agg = aggregateRiderViews(rows, { nowMs: NOW, oldestViewedAtMs: OLD_SYSTEM });
  assert.equal(agg.views7d, 0); // grænse-besøget tæller IKKE med i aktuel 7d
  assert.equal(agg.trend7dPct, -100); // det havnede i forrige 7d: (0-1)/1 = -100
});
