import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateTraffic } from "./trafficMetrics.js";

// rows: pre-grupperet pr. visit_hash: { visit_hash, is_bot, pageviews, engaged_events }
test("bounce = visits med 1 pageview og ingen engaged", () => {
  const r = aggregateTraffic([
    { visit_hash: "a", is_bot: false, pageviews: 1, engaged_events: 0 }, // bounce
    { visit_hash: "b", is_bot: false, pageviews: 3, engaged_events: 0 }, // engaged (≥2 pv)
    { visit_hash: "c", is_bot: false, pageviews: 1, engaged_events: 1 }, // engaged (event)
    { visit_hash: "d", is_bot: true, pageviews: 1, engaged_events: 0 }, // bot, ekskluderet
  ]);
  assert.equal(r.humanVisits, 3);
  assert.equal(r.engagedVisits, 2);
  assert.equal(r.bounceRate, 1 / 3);
  assert.equal(r.engagedRate, 2 / 3);
  assert.equal(r.botVisits, 1);
  assert.equal(r.botShare, 1 / 4);
});

test("tom input", () => {
  const r = aggregateTraffic([]);
  assert.equal(r.humanVisits, 0);
  assert.equal(r.bounceRate, 0);
  assert.equal(r.engagedRate, 0);
  assert.equal(r.botShare, 0);
});

test("ikke-array input håndteres", () => {
  const r = aggregateTraffic(null);
  assert.equal(r.humanVisits, 0);
});
