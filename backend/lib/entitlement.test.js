import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./testdb/createTestDb.js";
import { computeIsPro, PRO_GRACE_AFTER_PERIOD_END_MS, PRO_GRACE_NO_PERIOD_END_MS } from "./entitlement.js";

// Minimalt fil-sæt: base-skema (teams = FK-mål) + subscriptions-migration.
const SCHEMA_FILES = ["schema.sql", "2026-06-26-cz-pro-subscriptions.sql"];

test("computeIsPro: aktiv + fremtidig periode = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: opsagt men stadig i perioden = true (æret betalt tid)", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: udløbet ud over respitten = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() - PRO_GRACE_AFTER_PERIOD_END_MS - 1000).toISOString() }), false);
});
test("computeIsPro: ingen række = false", () => {
  assert.equal(computeIsPro(null), false);
});
test("computeIsPro: inaktiv status = false", () => {
  assert.equal(computeIsPro({ status: "inactive", current_period_end: new Date(Date.now() + 86400000).toISOString() }), false);
});

let db;
before(async () => { db = await createTestDb({ files: SCHEMA_FILES }); });
after(async () => { if (db) await db.close(); });

test("subscriptions-row kan upsertes og læses tilbage (DDL-kontrakt)", async () => {
  await db.query("INSERT INTO public.teams (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'T') ON CONFLICT DO NOTHING");
  await db.query(
    `INSERT INTO public.subscriptions (team_id, status, current_period_end)
     VALUES ($1, 'active', now() + interval '30 days')`,
    ["00000000-0000-0000-0000-000000000001"],
  );
  const { rows } = await db.query(
    "SELECT status, current_period_end FROM public.subscriptions WHERE team_id = $1",
    ["00000000-0000-0000-0000-000000000001"],
  );
  assert.equal(rows.length, 1);
  assert.equal(computeIsPro(rows[0]), true);
});

// ── Respit efter periodeslut (#4512/#4541) ───────────────────────────────────
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-02T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("computeIsPro: aktiv, periode udløbet for 1 dag siden = true (respit dækker cache-lag)", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: iso(NOW - DAY) }, NOW), true);
});
test("computeIsPro: past_due, periode udløbet for 2 dage siden = true (Aluntas rykkerproces)", () => {
  assert.equal(computeIsPro({ status: "past_due", current_period_end: iso(NOW - 2 * DAY) }, NOW), true);
});
test("computeIsPro: aktiv, periode udløbet for 3 dage + 1 ms siden = false (respit opbrugt)", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: iso(NOW - PRO_GRACE_AFTER_PERIOD_END_MS - 1) }, NOW), false);
});
test("computeIsPro: opsagt får INGEN respit — falder præcis ved periodeslut", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: iso(NOW - 1) }, NOW), false);
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: iso(NOW + 1) }, NOW), true);
});
test("computeIsPro: inaktiv får ingen respit uanset periode", () => {
  assert.equal(computeIsPro({ status: "inactive", current_period_end: iso(NOW + DAY) }, NOW), false);
});
test("computeIsPro: ulæselig periode = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: "ikke-en-dato" }, NOW), false);
});

// ── #4648: 24h-respit uden current_period_end (checkout.completed-race) ──────
test("computeIsPro: active, intet current_period_end, last_event_at for 1 time siden = true (respit)", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: iso(NOW - 60 * 60 * 1000) }, NOW), true);
});
test("computeIsPro: past_due, intet current_period_end, last_event_at for 23 timer siden = true (respit)", () => {
  assert.equal(computeIsPro({ status: "past_due", current_period_end: null, last_event_at: iso(NOW - 23 * 60 * 60 * 1000) }, NOW), true);
});
test("computeIsPro: active, intet current_period_end, last_event_at for 24 timer + 1 ms siden = false (respit opbrugt)", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: iso(NOW - PRO_GRACE_NO_PERIOD_END_MS - 1) }, NOW), false);
});
test("computeIsPro: active, intet current_period_end OG intet last_event_at = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: null }, NOW), false);
});
test("computeIsPro: cancelled uden current_period_end = false (ingen respit at æres til)", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: null, last_event_at: iso(NOW) }, NOW), false);
});
test("computeIsPro: active, intet current_period_end, ulæseligt last_event_at = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: null, last_event_at: "ikke-en-dato" }, NOW), false);
});
