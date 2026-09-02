import test from "node:test";
import assert from "node:assert/strict";
import { computeIsPro, PRO_GRACE_AFTER_PERIOD_END_MS, PRO_GRACE_NO_PERIOD_END_MS } from "./proEntitlement.js";

test("computeIsPro: aktiv + fremtid = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: opsagt men i perioden = true", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: udløbet ud over respitten = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() - PRO_GRACE_AFTER_PERIOD_END_MS - 1000).toISOString() }), false);
});
test("computeIsPro: null = false", () => {
  assert.equal(computeIsPro(null), false);
});
test("computeIsPro: inaktiv = false", () => {
  assert.equal(computeIsPro({ status: "inactive", current_period_end: new Date(Date.now() + 86400000).toISOString() }), false);
});

// ── Respit efter periodeslut (#4512/#4541) — spejler backend/lib/entitlement.test.js ──
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-02T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("computeIsPro: aktiv, udløbet for 1 dag siden = true (respit)", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: iso(NOW - DAY) }, NOW), true);
});
test("computeIsPro: aktiv, respit opbrugt = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: iso(NOW - PRO_GRACE_AFTER_PERIOD_END_MS - 1) }, NOW), false);
});
test("computeIsPro: opsagt får ingen respit", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: iso(NOW - 1) }, NOW), false);
});
test("computeIsPro: respit-konstanten er 3 døgn (skal matche backend)", () => {
  assert.equal(PRO_GRACE_AFTER_PERIOD_END_MS, 3 * DAY);
});

// ── #4648: 24h-respit uden current_period_end (checkout.completed-race) ──────
test("computeIsPro: active, intet current_period_end, last_event_at for 1 time siden = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: iso(NOW - 60 * 60 * 1000) }, NOW), true);
});
test("computeIsPro: active, intet current_period_end, respit opbrugt = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: iso(NOW - PRO_GRACE_NO_PERIOD_END_MS - 1) }, NOW), false);
});
test("computeIsPro: active, hverken current_period_end eller last_event_at = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: null }, NOW), false);
});
test("computeIsPro: no-period-end-respit-konstanten er 24 timer (skal matche backend)", () => {
  assert.equal(PRO_GRACE_NO_PERIOD_END_MS, DAY);
});
