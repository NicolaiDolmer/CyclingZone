import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, columnExists } from "./testdb/createTestDb.js";

// Minimalt fil-sæt: base-skema (teams = FK-mål) + den nye migration.
// Hele database/-sættet kan IKKE loades i PGlite — nogle migrationer ALTER'er
// tabeller hvis CREATE ikke er med i et load (jf. RACE_HUB_SCHEMA_FILES-mønstret).
const SCHEMA_FILES = ["schema.sql", "2026-06-26-cz-pro-subscriptions.sql"];

let db;
before(async () => {
  db = await createTestDb({ files: SCHEMA_FILES });
});
after(async () => {
  if (db) await db.close();
});

test("subscriptions-tabellen findes efter migration", async () => {
  const { rows } = await db.query("SELECT to_regclass('public.subscriptions') AS reg");
  assert.ok(rows[0].reg, "public.subscriptions skal findes");
});

test("subscriptions HAR de kolonner entitlement-laget bruger", async () => {
  const required = [
    "id", "team_id", "alunta_customer_id", "alunta_subscription_id",
    "status", "plan_interval", "is_founder", "current_period_end",
    "last_event_id", "created_at", "updated_at",
  ];
  for (const col of required) {
    assert.ok(await columnExists(db, "subscriptions", col), `subscriptions.${col} skal findes`);
  }
});
