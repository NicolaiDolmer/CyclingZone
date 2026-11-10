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
  await sql("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text,is_auto_filled boolean DEFAULT false,auto_filled_source text, PRIMARY KEY(race_id,rider_id))");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql", "2026-10-25-6461-train-now-whole-day.sql", "2026-11-09-7737-train-now-instant.sql", "2026-11-09-7737-train-now-instant.sql"]) await sql(await file(name));

  await sql(`ALTER TABLE race_entries ADD CONSTRAINT no_rider_double_booking_day UNIQUE(rider_id,race_id,team_id) DEFERRABLE;
    CREATE TABLE race_withdrawals(race_id uuid,team_id uuid,withdrawn_reason text);
    CREATE TABLE race_entry_overrides(race_id uuid,team_id uuid,had_auto_filled boolean,auto_source text);
    CREATE TABLE race_entry_days(race_id uuid,rider_id uuid,team_id uuid,season_id uuid,game_day integer);
    CREATE FUNCTION race_entry_days_rebuild(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;`);
  await sql(await file("2026-10-28-7153-manager-selection-rejoin.sql"));  let openings;
  const reset = async () => {
    await sql(`TRUNCATE race_results, race_entries, race_withdrawals, race_entry_overrides, race_entry_days, riders, rider_derived_abilities, rider_condition, training_day_runs, races, race_stage_schedule, race_simulation_runs, training_date_work,
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
    // The concurrency cases below describe the switched-on state; the off fast path has its own case.
    await sql(`UPDATE app_config SET value='"on"'::jsonb WHERE key='training_train_now_instant'`);
  };
  const lit = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;
  const commitSql = (day, { abilities = [], conditions = [], loads = [], at = AT(1), intensity = "normal", deadlineReached = false } = {}) => {
    const report = { condition_per_date: true, riders: [{ rider_id: A, game_day: day, intensity, condition_before_date: openings[A], condition_observed: openings[A], missing_evidence: [] }] };
    const snapshotReport = `jsonb_set(${lit(report)},'{riders,0,expected_date_receipt_days}',(SELECT COALESCE(jsonb_agg(game_day ORDER BY game_day),'[]'::jsonb) FROM training_rider_ticks WHERE rider_id='${A}' AND season_id='${SEASON}' AND tick_date='${DATE}'))`;
    return `SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','manager',${snapshotReport},${lit(abilities)},${lit(conditions)},'[]','[]','[]',${lit(loads)},${deadlineReached},'${at}')`;
  };
  const closing = (fatigue) => ({ conditions: [{ rider_id: A, form: 52, fatigue, injured_until: null, injury_cause: null, updated_at: AT(9) }], loads: [{ rider_id: A, race_id: RACE, stage_number: 1, game_day: 43, load: 9.6 }], intensity: "race", at: AT(30) });
  const recordLoad = `SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`;
  const count = async (query) => Number(await sql(query));
  const ticks = () => count(`SELECT count(*) FROM training_rider_ticks WHERE rider_id='${A}'`);
  const settled = () => count(`SELECT count(*) FROM training_condition_settlements WHERE rider_id='${A}'`);

  // Hold the team lock, start every contender, wait until all are queued, then let them go.
  const contend = async (statements, { queued = statements.length } = {}) => {
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
      if (waiting >= queued) break;
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
    assert.match(results.find((r) => r.error).error, /Provisional condition cannot settle|Every final rider receipt|Training receipt snapshot changed/);
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
    // The load takes no team lock, so only the press queues behind the holder.
    const results = await contend([commitSql(45, { conditions: [{ rider_id: A, form: 50, fatigue: 24, provisional: true }] }), recordLoad], { queued: 1 });
    assert.deepEqual(results.filter((r) => r.error), []);
    assert.equal(await count(`SELECT count(*) FROM training_race_loads WHERE rider_id='${A}'`), 1);
    assert.equal(await sql(`SELECT fatigue FROM rider_condition WHERE rider_id='${A}'`), "24");
    assert.equal(await settled(), 0);
  });

  await t.test("different slots cannot acknowledge stale nonempty development updates", async () => {
    await reset();
    for (const day of [41, 42]) await sql(commitSql(day));
    const patch = (progress) => [{ riderId: A, patch: { ability_progress: { climbing: progress } } }];
    const results = await contend([
      commitSql(44, { abilities: patch(0.25) }),
      commitSql(43, { abilities: patch(0.5), intensity: "race" }),
    ]);
    assert.equal(results.filter((r) => r.error).length, 1);
    assert.match(results.find((r) => r.error).error, /Training receipt snapshot changed/);
    assert.equal(await ticks(), 3);
    const retryDay = results[0].error ? 44 : 43;
    await sql(commitSql(retryDay, { abilities: patch(0.75), intensity: retryDay === 43 ? "race" : "normal" }));
    assert.equal(await ticks(), 4);
    assert.equal(await sql(`SELECT ability_progress->>'climbing' FROM rider_derived_abilities WHERE rider_id='${A}'`), "0.75");
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

  const freezeSql = (riders = [A]) => `SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${riders}}','${AT(0)}')`;
  const bulkSql = (race = RACE, riders = [A], role = "leader") => `SELECT replace_manager_race_selections('${TEAM}','${JSON.stringify([{ race_id: race, rider_ids: riders, roles: riders.map(() => role) }])}'::jsonb,'[]','${AT(1)}')`;
  const entry = (race = RACE) => `INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${race}','${A}','${TEAM}')`;
  const ordered = async (first, second) => {
    const holder = spawn(exe, args, { windowsHide: true });
    const held = new Promise((resolve, reject) => {
      let out = "";
      holder.stdout.on("data", (chunk) => { out += chunk; if (out.includes("HELD")) resolve(); });
      holder.once("error", reject);
      holder.stderr.on("data", (chunk) => reject(new Error(String(chunk))));
    });
    holder.stdin.write(`BEGIN; ${first};\n\\echo HELD\n`);
    await held;
    const running = sql(second);
    let waiting = 0;
    for (let i = 0; i < 100; i += 1) {
      waiting = await count("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted");
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const closed = once(holder, "exit");
    holder.stdin.end("COMMIT;\n\\q\n");
    await closed;
    const result = await running;
    assert.ok(waiting > 0, "the second connection was observed waiting on the common lock");
    return result;
  };

  await t.test("entry first: the frozen plan includes a queued save's slots", async () => {
    await reset();
    await sql("DELETE FROM race_simulation_runs");
    const frozen = JSON.parse((await ordered(bulkSql(), freezeSql())).split("\n").at(-1));
    assert.deepEqual(frozen[0].slots.map((slot) => slot.gameDay), [43]);
    assert.equal(await count("SELECT count(*) FROM race_entries"), 1);
  });

  await t.test("freeze first: later membership is filtered and existing bulk roles remain", async () => {
    await reset();
    await sql("DELETE FROM race_simulation_runs");
    await sql(bulkSql());
    const other = id(801);
    await sql(`INSERT INTO races(id,season_id) VALUES('${other}','${SEASON}'); INSERT INTO race_stage_schedule VALUES('${other}',1,44,'2026-11-09T16:00:00Z')`);
    await ordered(freezeSql(), entry(other));
    assert.equal(await count(`SELECT count(*) FROM race_entries WHERE race_id='${other}'`), 0);
    await sql(bulkSql(RACE, [A], "helper"));
    assert.equal(await sql(`SELECT race_role FROM race_entries WHERE race_id='${RACE}'`), "helper");
    await sql(bulkSql(other));
    assert.equal(await count(`SELECT count(*) FROM race_entries WHERE race_id='${other}'`), 0);
    const before = await sql(freezeSql());
    await sql(bulkSql(RACE, []));
    assert.equal(await count("SELECT count(*) FROM race_entries"), 0);
    assert.equal(await sql(freezeSql()), before, "a removal cannot widen a retry's training plan");
  });

  await t.test("bulk role replacement in flight: freeze follows the completed replacement", async () => {
    await reset();
    await sql("DELETE FROM race_simulation_runs");
    await sql(bulkSql());
    const frozen = JSON.parse((await ordered(bulkSql(RACE, [A], "helper"), freezeSql())).split("\n").at(-1));
    assert.deepEqual(frozen[0].slots.map((slot) => slot.gameDay), [43]);
    assert.equal(await sql("SELECT race_role FROM race_entries"), "helper");
    await sql(bulkSql(RACE, [A], "leader"));
    assert.equal(await sql("SELECT race_role FROM race_entries"), "leader");
  });

  await t.test("reversed rider order: repeated freezes and bulk replacements finish", async () => {
    await reset();
    await sql("DELETE FROM race_simulation_runs");
    const b = id(12);
    await sql(`INSERT INTO riders VALUES('${b}','${TEAM}'); INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id) VALUES('${b}','${DATE}','${SEASON}','${TEAM}'); UPDATE training_date_work SET expected_rider_ids=ARRAY['${A}','${b}']::uuid[]`);
    await sql(bulkSql(RACE, [b, A]));
    await ordered(bulkSql(RACE, [A, b]), freezeSql([b, A]));
    const results = await Promise.all([sql(freezeSql([A, b])), sql(freezeSql([b, A]))]);
    assert.deepEqual(JSON.parse(results[0]), JSON.parse(results[1]));
    await sql(bulkSql(RACE, [b, A], "helper"));
    assert.equal(await count("SELECT count(*) FROM race_entries WHERE race_role='helper'"), 2);
  });

  await t.test("removed membership keeps the stage pending until its reinserted entry finishes", async () => {
    await reset();
    await sql(bulkSql());
    await sql(freezeSql());
    for (const day of [41,42,44,45]) await sql(commitSql(day));
    await sql(bulkSql(RACE, []));
    assert.equal(await count("SELECT count(*) FROM race_entries"), 0);
    await assert.rejects(sql(commitSql(43,{...closing(33),intensity:"normal",loads:[]})), /Frozen training slot requires current race evidence/);
    assert.equal(await ticks(), 4);
    assert.equal(await settled(), 0);
    const other=id(813);
    await sql(`INSERT INTO races(id,season_id) VALUES('${other}','${SEASON}'); INSERT INTO race_stage_schedule VALUES('${other}',1,44,'2026-11-09T16:00:00Z')`);
    await sql(bulkSql(other));
    assert.equal(await count(`SELECT count(*) FROM race_entries WHERE race_id='${other}'`), 0);
    await sql(bulkSql(RACE,[A],"helper"));
    assert.equal(await sql("SELECT race_role FROM race_entries"), "helper");
    await sql(`UPDATE races SET stages_completed=1 WHERE id='${RACE}'; INSERT INTO race_results(race_id,stage_number,rider_id,result_type) VALUES('${RACE}',1,'${A}','stage')`);
    await sql(recordLoad);
    await sql(commitSql(43,closing(33)));
    assert.equal(await settled(), 1);
    assert.equal(await ticks(), 5);
    assert.equal(await sql(`SELECT report->>'intensity' FROM training_rider_ticks WHERE rider_id='${A}' AND game_day=43`), "race");
  });

  await t.test("the date deadline retains a recorded pending race load", async () => {
    await reset();
    await sql(bulkSql());
    await sql(freezeSql());
    for(const day of [41,42,44,45]) await sql(commitSql(day));
    await sql(recordLoad);
    await assert.rejects(sql(commitSql(43,closing(33))),/Frozen training slot requires current race evidence/);
    assert.equal(await settled(),0);
    await sql(commitSql(43,{...closing(33),deadlineReached:true,at:"2026-11-10T03:00:00Z"}));
    assert.equal(await settled(),1);
    assert.equal(await ticks(),5);
  });

  await t.test("switch off and no frozen snapshot: a selection write takes no rider lock", async () => {
    await reset();
    await sql(`UPDATE app_config SET value='"off"'::jsonb WHERE key='training_train_now_instant'`);
    const holder = spawn(exe, args, { windowsHide: true });
    const held = new Promise((resolve, reject) => {
      let out = "";
      holder.stdout.on("data", (chunk) => { out += chunk; if (out.includes("HELD")) resolve(); });
      holder.once("error", reject);
    });
    holder.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('train-now-entry-rider:${A}',0));\n\\echo HELD\n`);
    await held;
    try {
      // Advisory locks ignore lock_timeout; statement_timeout turns a wait into a failure.
      const quick = (text) => sql(`SET statement_timeout='2s'; ${text}`);
      await quick(entry());
      await quick(`UPDATE race_entries SET race_role='helper' WHERE rider_id='${A}'`);
      await quick(`DELETE FROM race_entries WHERE rider_id='${A}'`);
    } finally {
      const closed = once(holder, "exit");
      holder.stdin.end("COMMIT;\n\\q\n");
      await closed;
    }
    assert.equal(await count("SELECT count(*) FROM race_entries"), 0);
  });
});
