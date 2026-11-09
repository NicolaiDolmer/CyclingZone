// #7737: concurrency on real PostgreSQL 17, with one psql connection per contender. The team
// advisory lock is held first, so every contender is queued on the same lock before any runs.
// Skipped without TRAIN_NOW_INSTANT_PG_PORT and TRAIN_NOW_INSTANT_PG_BIN (a throwaway cluster).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const port = process.env.TRAIN_NOW_INSTANT_PG_PORT;
const bin = process.env.TRAIN_NOW_INSTANT_PG_BIN;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), SEASON = id(900), RACE = id(800), A = id(11);
const DATE = "2026-11-09", DAYS = [41, 42, 43, 44, 45];
const AT = (minute) => `2026-11-09T06:${String(minute).padStart(2, "0")}:00Z`;

test("#7737 PG17: double press, sweep and retry never settle twice", { skip: !port || !bin }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "train-now-instant-"));
  const exe = join(bin, "psql.exe");
  const args = ["-X", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"];
  let seq = 0;
  const sql = async (text) => {
    const path = join(scratch, `${seq++}.sql`);
    await writeFile(path, text);
    return (await promisify(execFile)(exe, [...args, "-f", path], { windowsHide: true })).stdout.trim();
  };
  const file = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");

  assert.match(await sql("SELECT version()"), /PostgreSQL 17\./);
  await sql(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await sql(await file(name));
  await sql("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql", "2026-11-09-7737-train-now-instant.sql", "2026-11-09-7737-train-now-instant.sql"]) await sql(await file(name));

  let openings;
  const reset = async () => {
    await sql(`TRUNCATE riders, rider_derived_abilities, rider_condition, training_day_runs, races, race_stage_schedule, race_simulation_runs, training_date_work,
        training_train_now_locks, training_race_loads, training_rider_ticks, training_condition_settlements, training_condition_timeout_outbox CASCADE;
      INSERT INTO riders VALUES('${A}','${TEAM}');
      INSERT INTO rider_derived_abilities VALUES('${A}',50,'{}');
      INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES('${A}',50,32,'2026-11-08T20:00:00Z');
      INSERT INTO races(id,season_id) VALUES('${RACE}','${SEASON}');
      INSERT INTO race_stage_schedule VALUES('${RACE}',1,43,'2026-11-09T15:00:00Z');
      INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot) VALUES('${RACE}',1,'["${A}"]','[{"rider_id":"${A}","load":9.6}]');`);
    const work = JSON.parse(await sql(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}','{${A}}',NULL,'${AT(0)}')`));
    openings = work.opening_conditions;
    await sql(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,instant_at) VALUES('${A}','${DATE}','${SEASON}','${TEAM}','${AT(0)}')`);
  };
  const lit = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;
  const commitSql = (day, { conditions = [], loads = [], at = AT(1), intensity = "normal" } = {}) => {
    const report = { condition_per_date: true, riders: [{ rider_id: A, game_day: day, intensity, condition_before_date: openings[A], condition_observed: openings[A], missing_evidence: [] }] };
    return `SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','manager',${lit(report)},'[]',${lit(conditions)},'[]','[]','[]',${lit(loads)},false,'${at}')`;
  };
  const closing = (fatigue) => ({ conditions: [{ rider_id: A, form: 52, fatigue, injured_until: null, injury_cause: null, updated_at: AT(9) }], loads: [{ rider_id: A, race_id: RACE, stage_number: 1, game_day: 43, load: 9.6 }], intensity: "race", at: AT(30) });
  const recordLoad = `SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`;
  const count = async (query) => Number(await sql(query));
  const ticks = () => count(`SELECT count(*) FROM training_rider_ticks WHERE rider_id='${A}'`);
  const settled = () => count(`SELECT count(*) FROM training_condition_settlements WHERE rider_id='${A}'`);

  // Hold the team lock, start every contender, wait until all are queued, then let them go.
  const contend = async (statements) => {
    const holder = spawn(exe, args, { windowsHide: true });
    const held = new Promise((resolve, reject) => {
      let out = "";
      holder.stdout.on("data", (chunk) => { out += chunk; if (out.includes("HELD")) resolve(); });
      holder.once("error", reject);
      holder.stderr.on("data", (chunk) => reject(new Error(String(chunk))));
    });
    holder.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('training-date:${TEAM}',0));\n\\echo HELD\n`);
    await held;
    const running = statements.map((text) => sql(text).then((out) => ({ out }), (error) => ({ error: String(error.stderr ?? error.message) })));
    for (let i = 0; i < 200; i += 1) {
      const waiting = await count("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted");
      if (waiting >= statements.length) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const closed = once(holder, "exit");
    holder.stdin.end("COMMIT;\n\\q\n");
    await closed;
    return Promise.all(running);
  };
  const parse = (result) => (result.out ? JSON.parse(result.out.split("\n").at(-1)) : null);

  await t.test("six connections press the same race day: one receipt", async () => {
    await reset();
    const results = await contend(Array.from({ length: 6 }, () => commitSql(41)));
    assert.deepEqual(results.filter((r) => r.error), []);
    assert.equal(results.map(parse).filter((r) => r.already_ran === false).length, 1);
    assert.equal(await ticks(), 1);
  });

  await t.test("press, sweep and retry race for the closing tick: one settlement, one consumed load", async () => {
    await reset();
    for (const day of [41, 42, 44, 45]) await sql(commitSql(day));
    await sql(recordLoad);
    const results = await contend([commitSql(43, closing(33)), commitSql(43, closing(34)), commitSql(43, closing(35)), commitSql(43, closing(36))]);
    assert.deepEqual(results.filter((r) => r.error), []);
    assert.equal(results.map(parse).filter((r) => r.already_ran === false).length, 1);
    assert.equal(await settled(), 1);
    assert.equal(await count(`SELECT count(*) FROM training_race_loads WHERE rider_id='${A}' AND consumed_at IS NOT NULL`), 1);
    assert.equal(await sql("SELECT status FROM training_date_work"), "complete");
  });

  await t.test("a provisional press against the race slot's tick: never a provisional settlement, and it recovers", async () => {
    await reset();
    for (const day of [41, 42, 44]) await sql(commitSql(day));
    await sql(recordLoad);
    const results = await contend([commitSql(45, { conditions: [{ rider_id: A, form: 50, fatigue: 24, provisional: true }] }), commitSql(43, { intensity: "race" })]);
    assert.equal(results.filter((r) => r.error).length, 1, "the later of the two sees a closing tick it was not built for");
    assert.match(results.find((r) => r.error).error, /Provisional condition cannot settle|Every final rider receipt/);
    assert.equal(await settled(), 0);
    assert.equal(await ticks(), 4);
    const missing = Number(await sql(`SELECT d FROM unnest(ARRAY[${DAYS}]) d WHERE d NOT IN (SELECT game_day FROM training_rider_ticks WHERE rider_id='${A}')`));
    await sql(commitSql(missing, closing(33)));
    assert.equal(await settled(), 1);
    assert.equal(await ticks(), 5);
  });

  await t.test("a stage load recorded while the press commits: no deadlock, both land", async () => {
    await reset();
    for (const day of [41, 42, 44]) await sql(commitSql(day));
    const results = await contend([commitSql(45, { conditions: [{ rider_id: A, form: 50, fatigue: 24, provisional: true }] }), recordLoad]);
    assert.deepEqual(results.filter((r) => r.error), []);
    assert.equal(await count(`SELECT count(*) FROM training_race_loads WHERE rider_id='${A}'`), 1);
    assert.equal(await sql(`SELECT fatigue FROM rider_condition WHERE rider_id='${A}'`), "24");
    assert.equal(await settled(), 0);
  });

  await t.test("two presses stamp the same rider: the first time stays", async () => {
    await reset();
    await sql(`UPDATE training_train_now_locks SET instant_at=NULL WHERE rider_id='${A}'`);
    const stamp = (minute) => `UPDATE training_train_now_locks SET instant_at='${AT(minute)}' WHERE tick_date='${DATE}' AND instant_at IS NULL AND rider_id='${A}'`;
    const results = await Promise.all([sql(stamp(1)), sql(stamp(2)), sql(stamp(3))]);
    assert.equal(results.length, 3);
    const stored = await sql(`SELECT to_char(instant_at AT TIME ZONE 'UTC','HH24:MI') FROM training_train_now_locks WHERE rider_id='${A}'`);
    assert.ok(["06:01", "06:02", "06:03"].includes(stored));
    await sql(stamp(9));
    assert.equal(await sql(`SELECT to_char(instant_at AT TIME ZONE 'UTC','HH24:MI') FROM training_train_now_locks WHERE rider_id='${A}'`), stored, "a later press never moves it");
  });
});
