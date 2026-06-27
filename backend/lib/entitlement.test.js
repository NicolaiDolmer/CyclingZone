import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./testdb/createTestDb.js";
import { computeIsPro } from "./entitlement.js";

// Minimalt fil-sæt: base-skema (teams = FK-mål) + subscriptions-migration.
const SCHEMA_FILES = ["schema.sql", "2026-06-26-cz-pro-subscriptions.sql"];

test("computeIsPro: aktiv + fremtidig periode = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: opsagt men stadig i perioden = true (æret betalt tid)", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: udløbet periode = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() - 1000).toISOString() }), false);
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
