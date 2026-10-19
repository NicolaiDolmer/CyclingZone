// #6504 (del A) · Triggeren trg_record_rider_team_exit skriver præcis én
// ejerskifte-hændelse, når en rytter går fra et hold til intet hold, og ingen
// ellers. Migrationen køres to gange mod en PGlite-database (idempotens).

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const TEAM_A = "00000000-0000-0000-0000-00000000000a";
const TEAM_B = "00000000-0000-0000-0000-00000000000b";
const RIDER = "00000000-0000-0000-0000-000000000001";

let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE teams(id uuid PRIMARY KEY);
    CREATE TABLE riders(id uuid PRIMARY KEY, firstname text, lastname text,
      team_id uuid REFERENCES teams(id), is_retired boolean DEFAULT false, salary integer);
    CREATE TABLE rider_ownership_events(
      id bigserial PRIMARY KEY, rider_id uuid NOT NULL, rider_firstname text, rider_lastname text,
      from_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
      to_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
      reason text NOT NULL, related_entity_type text, related_entity_id uuid,
      actor_type text, actor_id uuid, occurred_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), idempotency_key text,
      CONSTRAINT rider_ownership_events_reason_check CHECK (reason IN ('release','trade')));
    INSERT INTO teams VALUES ('${TEAM_A}'), ('${TEAM_B}');
  `);
  const migration = await readFile(
    new URL("../../database/2026-10-19-6504-release-ownership-trigger.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration); // idempotent
});

after(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`DELETE FROM rider_ownership_events; DELETE FROM riders;
    INSERT INTO riders(id, firstname, lastname, team_id) VALUES ('${RIDER}', 'Ada', 'Rytter', '${TEAM_A}');`);
});

const events = async () => (await db.query(
  "SELECT from_team_id, to_team_id, reason, actor_type, rider_firstname FROM rider_ownership_events ORDER BY id")).rows;

test("frigivelse (hold -> intet hold) skriver én release-hændelse med navne-snapshot", async () => {
  await db.exec(`UPDATE riders SET team_id = NULL, salary = NULL WHERE id = '${RIDER}'`);
  assert.deepEqual(await events(), [{
    from_team_id: TEAM_A, to_team_id: null, reason: "release", actor_type: "system", rider_firstname: "Ada",
  }]);
});

test("pension i samme række giver reason = retirement", async () => {
  await db.exec(`UPDATE riders SET is_retired = true WHERE id = '${RIDER}'`);
  await db.exec(`UPDATE riders SET team_id = NULL WHERE id = '${RIDER}'`);
  assert.equal((await events())[0].reason, "retirement");
});

test("hold -> hold, fri -> hold og ændringer uden holdskifte skriver intet (dem logger koden selv)", async () => {
  await db.exec(`UPDATE riders SET team_id = '${TEAM_B}' WHERE id = '${RIDER}'`);
  await db.exec(`UPDATE riders SET salary = 5 WHERE id = '${RIDER}'`);
  await db.exec(`INSERT INTO riders(id, team_id) VALUES ('00000000-0000-0000-0000-000000000002', NULL)`);
  await db.exec(`UPDATE riders SET team_id = '${TEAM_A}' WHERE id = '00000000-0000-0000-0000-000000000002'`);
  assert.deepEqual(await events(), []);
});

test("cz.ownership_reason = admin bruges; en ukendt værdi falder tilbage til release", async () => {
  await db.exec(`BEGIN; SELECT set_config('cz.ownership_reason', 'admin', true);
    UPDATE riders SET team_id = NULL WHERE id = '${RIDER}'; COMMIT;`);
  await db.exec(`UPDATE riders SET team_id = '${TEAM_A}' WHERE id = '${RIDER}'`);
  await db.exec(`BEGIN; SELECT set_config('cz.ownership_reason', 'nonsense', true);
    UPDATE riders SET team_id = NULL WHERE id = '${RIDER}'; COMMIT;`);
  assert.deepEqual((await events()).map((e) => e.reason), ["admin", "release"]);
});

test("best-effort: en fejl i loggen ruller aldrig frigivelsen tilbage", async () => {
  await db.exec(`ALTER TABLE rider_ownership_events RENAME TO rider_ownership_events_off`);
  try {
    await db.exec(`UPDATE riders SET team_id = NULL WHERE id = '${RIDER}'`);
    const { rows } = await db.query(`SELECT team_id FROM riders WHERE id = '${RIDER}'`);
    assert.equal(rows[0].team_id, null);
  } finally {
    await db.exec(`ALTER TABLE rider_ownership_events_off RENAME TO rider_ownership_events`);
  }
});

test("CHECK-constrainten er udvidet med retirement og beholder de gamle værdier", async () => {
  const { rows } = await db.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'rider_ownership_events_reason_check'");
  for (const reason of ["auction_win", "trade", "swap", "release", "stage_race_deferred_flush", "retirement"]) {
    assert.match(rows[0].def, new RegExp(`'${reason}'`));
  }
});
