// #6461 B: the shared lock in the database (PGlite, PostgreSQL 17). A rider marked by
// the whole-day press can never be inserted into a race with a stage still to run on
// that date; everything else, and everything with the flag off, inserts as before.
// The two-connection race (mark vs. insert in flight) is serialised by the same
// advisory key on both sides; PGlite has one connection, so that part is reasoned
// in the PR body, not run here.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

let db;
const rider = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const team = "00000000-0000-0000-0000-000000000003";
const season = "00000000-0000-0000-0000-000000000004";
const race = "00000000-0000-0000-0000-000000000005";
const read = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");

before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE app_config(key text PRIMARY KEY, value jsonb, description text, updated_at timestamptz DEFAULT now());
    CREATE TABLE riders(id uuid PRIMARY KEY);
    CREATE TABLE races(id uuid PRIMARY KEY, stages_completed integer DEFAULT 0);
    CREATE TABLE race_stage_schedule(race_id uuid, stage_number integer, scheduled_at timestamptz);
    CREATE TABLE race_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), race_id uuid, rider_id uuid, team_id uuid);`);
  await db.exec(await read("2026-10-01-traen-nu-locks.sql"));
  const migration = await read("2026-10-25-6461-train-now-whole-day.sql");
  await db.exec(migration);
  await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE race_entries, race_stage_schedule, races, training_train_now_locks, riders CASCADE;
    UPDATE app_config SET value='"off"' WHERE key='training_train_now_whole_day';
    INSERT INTO riders VALUES('${rider}'),('${other}');
    INSERT INTO races VALUES('${race}',0);
    INSERT INTO race_stage_schedule VALUES('${race}',1,'2026-10-26T15:00:00Z');`);
});

const entries = async () => (await db.query("SELECT rider_id FROM race_entries ORDER BY rider_id")).rows.map((r) => r.rider_id);
const lock = (id, marked) => db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,whole_day_at)
  VALUES('${id}','2026-10-26','${season}','${team}',${marked ? "now()" : "NULL"})`);
const enter = (...ids) => db.exec(`INSERT INTO race_entries(race_id,rider_id,team_id) VALUES ${ids.map((id) => `('${race}','${id}','${team}')`).join(",")}`);

test("migration: seeds the flag off, is idempotent, adds the mark column", async () => {
  const { rows } = await db.query("SELECT value #>> '{}' AS v FROM app_config WHERE key='training_train_now_whole_day'");
  assert.deepEqual(rows, [{ v: "off" }]);
  const { rows: cols } = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='training_train_now_locks' AND column_name='whole_day_at'");
  assert.equal(cols.length, 1);
});

test("flag off and no mark: every insert goes through (old behaviour, incl. a locked rider)", async () => {
  await lock(rider, false);
  await enter(rider, other);
  assert.deepEqual(await entries(), [rider, other]);
});

test("a marked rider is dropped from an insert into a race with a stage still to run that date; the batch goes on", async () => {
  await db.exec("UPDATE app_config SET value='\"on\"' WHERE key='training_train_now_whole_day'");
  await lock(rider, true);
  await enter(rider, other);
  assert.deepEqual(await entries(), [other]);
});

test("the mark protects even after the flag is switched off again (the mark, not the flag, decides)", async () => {
  // Today's local date, so the fast path's "recent mark" window always covers it.
  await db.exec(`UPDATE race_stage_schedule SET scheduled_at=((now() AT TIME ZONE 'Europe/Copenhagen')::date + time '12:00') AT TIME ZONE 'Europe/Copenhagen';
    INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,whole_day_at)
      VALUES('${rider}',(now() AT TIME ZONE 'Europe/Copenhagen')::date,'${season}','${team}',now());`);
  await enter(rider);
  assert.deepEqual(await entries(), []);
});

test("stage already run on the marked date: a re-save (delete + insert) keeps the rider", async () => {
  await db.exec("UPDATE app_config SET value='\"on\"' WHERE key='training_train_now_whole_day'; UPDATE races SET stages_completed=1");
  await lock(rider, true);
  await enter(rider);
  assert.deepEqual(await entries(), [rider]);
});

test("a mark on another date does not block a race on this date; an unmarked lock never blocks", async () => {
  await db.exec(`UPDATE app_config SET value='"on"' WHERE key='training_train_now_whole_day';
    INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,whole_day_at) VALUES('${rider}','2026-10-25','${season}','${team}',now());`);
  await lock(other, false);
  await enter(rider, other);
  assert.deepEqual(await entries(), [rider, other]);
});

test("Copenhagen date of the stage decides (late-evening UTC stage belongs to the next local date)", async () => {
  await db.exec(`UPDATE app_config SET value='"on"' WHERE key='training_train_now_whole_day';
    UPDATE race_stage_schedule SET scheduled_at='2026-10-25T23:30:00Z';`);
  await lock(rider, true); // 2026-10-26 local
  await enter(rider);
  assert.deepEqual(await entries(), []);
});
