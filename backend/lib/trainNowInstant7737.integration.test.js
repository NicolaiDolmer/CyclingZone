// #7737: the real commit_training_date_tick on PGlite (PostgreSQL 17, one connection). Without
// a stamp the migrated function behaves as the frozen 2026-10-10-6439 definition, on a replay of
// the same calls against both. With a stamp a rider may fill his race days out of order and
// closes his date exactly once. Concurrency is in trainNowInstant7737.pg17.test.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const file = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
const MIGRATION = "2026-11-09-7737-train-now-instant.sql";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), SEASON = id(900), RACE = id(800), A = id(11), B = id(12);
const DATE = "2026-11-09", DAYS = [41, 42, 43, 44, 45];
const AT = (minute) => `2026-11-09T06:${String(minute).padStart(2, "0")}:00Z`;

async function newDb({ migrated = true } = {}) {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))");
  if (migrated) {
    await db.exec(await file(MIGRATION));
    await db.exec(await file(MIGRATION));
  }
  await db.exec(`INSERT INTO riders VALUES('${A}','${TEAM}'),('${B}','${TEAM}');
    INSERT INTO rider_derived_abilities VALUES('${A}',50,'{}'),('${B}',50,'{}');
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES('${A}',50,32,'2026-11-08T20:00:00Z'),('${B}',50,32,'2026-11-08T20:00:00Z');
    INSERT INTO races(id,season_id) VALUES('${RACE}','${SEASON}');
    INSERT INTO race_stage_schedule VALUES('${RACE}',1,43,'2026-11-09T15:00:00Z');
    INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot) VALUES('${RACE}',1,'["${A}"]','[{"rider_id":"${A}","load":9.6}]');`);
  return db;
}

const j = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;
const register = async (db) => (await db.query(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}','{${A},${B}}',NULL,'${AT(0)}') AS w`)).rows[0].w;
const stamp = (db, ...riders) => db.exec(riders.map((r) => `INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,instant_at) VALUES('${r}','${DATE}','${SEASON}','${TEAM}','${AT(0)}');`).join(""));
const cond = (rider, fatigue, form, at = AT(5)) => ({ rider_id: rider, form, fatigue, injured_until: null, injury_cause: null, updated_at: at });
const provisional = (rider, fatigue, form) => ({ rider_id: rider, form, fatigue, provisional: true });
const LOAD = (rider = A) => ({ rider_id: rider, race_id: RACE, stage_number: 1, game_day: 43, load: 9.6 });

async function commit(db, day, riders, { abilities = [], expectedDays, conditions = [], loads = [], at = AT(1), intensity = "normal", deadlineReached = false, openings }) {
  const observed = expectedDays ?? Object.fromEntries(await Promise.all(riders.map(async (rider) => [rider, await ticks(db, rider)])));
  const report = { condition_per_date: true, riders: riders.map((rider) => ({ rider_id: rider, game_day: day, intensity, expected_date_receipt_days: observed[rider], condition_before_date: openings[rider], condition_observed: openings[rider], missing_evidence: [] })) };
  return db.query(`SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','manager',${j(report)},${j(abilities)},${j(conditions)},'[]','[]','[]',${j(loads)},${deadlineReached},'${at}') AS r`).then((res) => res.rows[0].r);
}
const attempt = async (fn) => { try { return { ok: await fn() }; } catch (e) { return { raised: e.message }; } };
const scalar = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const ticks = (db, rider) => db.query(`SELECT game_day FROM training_rider_ticks WHERE rider_id='${rider}' ORDER BY 1`).then((r) => r.rows.map((x) => x.game_day));
const condition = async (db, rider) => (await db.query(`SELECT form,fatigue,injured_until,updated_at FROM rider_condition WHERE rider_id='${rider}'`)).rows[0];
const settlements = (db, rider) => scalar(db, `SELECT count(*)::int c FROM training_condition_settlements WHERE rider_id='${rider}'`);
const status = (db) => scalar(db, "SELECT status FROM training_date_work");

async function dump(db) {
  const out = {};
  for (const [table, order] of [["training_rider_ticks", "rider_id,game_day"], ["training_condition_settlements", "rider_id"], ["rider_condition", "rider_id"], ["training_date_work", "team_id"], ["training_day_runs", "game_day"], ["training_race_loads", "rider_id"]]) {
    out[table] = (await db.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows.map(({ id: _id, ...row }) => row);
  }
  return out;
}

let dbs = [];
const fresh = async (opts) => { const db = await newDb(opts); dbs.push(db); return db; };
before(() => { dbs = []; });
after(async () => { for (const db of dbs) await db.close(); });

test("different instant slots reject stale development and retry from the committed snapshot", async () => {
  const db = await fresh();
  const openings = (await register(db)).opening_conditions;
  await stamp(db, A);
  for (const day of [41, 42]) await commit(db, day, [A], { openings });
  const expectedDays = { [A]: [41, 42] };
  const abilities = (progress) => [{ riderId: A, patch: { ability_progress: { climbing: progress } } }];
  await commit(db, 44, [A], { openings, expectedDays, abilities: abilities(0.25) });
  await assert.rejects(commit(db, 43, [A], { openings, expectedDays, abilities: abilities(0.5) }), /Training receipt snapshot changed/);
  assert.deepEqual(await ticks(db, A), [41, 42, 44]);
  assert.equal(await scalar(db, `SELECT (ability_progress->>'climbing')::double precision FROM rider_derived_abilities WHERE rider_id='${A}'`), 0.25);
  await commit(db, 43, [A], { openings, abilities: abilities(0.75) });
  assert.deepEqual(await ticks(db, A), [41, 42, 43, 44]);
  assert.equal(await scalar(db, `SELECT (ability_progress->>'climbing')::double precision FROM rider_derived_abilities WHERE rider_id='${A}'`), 0.75);
  assert.equal((await commit(db, 43, [A], { openings, expectedDays, abilities: abilities(0.5) })).already_ran, true);
});

test("migration: seeds the switch off, is idempotent, adds the stamp column", async () => {
  const db = await fresh();
  assert.equal(await scalar(db, "SELECT value #>> '{}' v FROM app_config WHERE key='training_train_now_instant'"), "off");
  assert.equal(await scalar(db, "SELECT count(*)::int c FROM information_schema.columns WHERE table_name='training_train_now_locks' AND column_name='instant_at'"), 1);
  await db.exec(await file(MIGRATION));
  assert.equal(await scalar(db, "SELECT count(*)::int c FROM app_config WHERE key='training_train_now_instant'"), 1);
  await db.exec("SET ROLE anon");
  await assert.rejects(db.query(`SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',41,'${DATE}','{${DAYS}}','manager','{}','[]','[]','[]','[]','[]','[]',false,'${AT(1)}')`), /permission denied/);
  await db.exec("RESET ROLE");
});

test("without a stamp: the same calls give the same rows and the same errors as the frozen 6439 definition", async () => {
  const replay = async (db) => {
    const work = await register(db);
    const openings = work.opening_conditions;
    const both = [A, B];
    const outcomes = [];
    const push = async (fn) => outcomes.push(await attempt(fn).then((x) => x.raised ?? x.ok?.work_status ?? null));
    await push(() => commit(db, 41, both, { openings }));
    await push(() => commit(db, 41, both, { openings })); // repeat
    await push(() => commit(db, 44, both, { openings })); // out of order
    await push(() => commit(db, 42, both, { openings, conditions: [cond(A, 20, 50)] })); // condition before the close
    await push(() => commit(db, 42, both, { openings, conditions: [provisional(A, 20, 50)] })); // a provisional row without a stamp
    await push(() => commit(db, 42, both, { openings }));
    await push(() => commit(db, 43, [A], { openings, intensity: "race" }));
    await push(() => commit(db, 43, [B], { openings }));
    await push(() => commit(db, 44, both, { openings }));
    await push(() => db.query(`SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`).then(() => null));
    await push(() => commit(db, 45, both, { openings, conditions: [cond(A, 25, 51)] })); // a rider without a settlement row
    await push(() => commit(db, 45, both, { openings, conditions: [cond(A, 25, 51), cond(B, 26, 49)] })); // load snapshot missing
    await push(() => commit(db, 45, both, { openings, conditions: [cond(A, 25, 51), cond(B, 26, 49)], loads: [LOAD()] }));
    await push(() => commit(db, 45, both, { openings, conditions: [cond(A, 25, 51), cond(B, 26, 49)], loads: [LOAD()] })); // the sweep again
    return { outcomes, rows: await dump(db) };
  };
  const frozen = await replay(await fresh({ migrated: false }));
  const migrated = await replay(await fresh());
  assert.deepEqual(migrated.outcomes, frozen.outcomes);
  assert.deepEqual(migrated.rows, frozen.rows);
  assert.ok(frozen.outcomes.some((o) => /Earlier rider date ticks/.test(o)), "the replay reaches the order guard");
  assert.ok(frozen.outcomes.some((o) => /Condition writes only/.test(o)), "the replay reaches the condition guard");
  assert.equal(frozen.rows.training_condition_settlements.length, 2);
});

test("a changed condition without a stamp is still unsafe, and a stamped rider's provisional numbers are not", async () => {
  const db = await fresh();
  const { opening_conditions: openings } = await register(db);
  await stamp(db, A);
  await db.exec(`UPDATE rider_condition SET fatigue=24 WHERE rider_id IN ('${A}','${B}')`);
  const result = await commit(db, 41, [A, B], { openings });
  assert.deepEqual(result.applied_rider_ids, [A]);
  assert.deepEqual(result.quarantined_rider_ids ?? (await scalar(db, "SELECT to_jsonb(quarantined_rider_ids) q FROM training_date_work")), [B]);
});

test("a stamped rider fills his race days out of order and keeps his race slot open", async () => {
  const db = await fresh();
  const { opening_conditions: openings } = await register(db);
  await stamp(db, A);
  for (const day of [41, 42, 44]) await commit(db, day, [A], { openings });
  assert.deepEqual(await ticks(db, A), [41, 42, 44]);
  assert.equal(await status(db), "partial");
  const blocked = await attempt(() => commit(db, 44, [B], { openings }));
  assert.match(blocked.raised, /Earlier rider date ticks/, "the unstamped rider keeps the order guard");
});

test("provisional numbers change form and fatigue only, close nothing, and cannot run before a stamp", async () => {
  const db = await fresh();
  await db.exec(`UPDATE rider_condition SET injured_until='2026-11-20',injury_cause='race_crash' WHERE rider_id='${A}'`);
  const { opening_conditions: reopened } = await register(db);
  const before = await condition(db, A);
  await stamp(db, A);
  for (const day of [41, 42, 44]) await commit(db, day, [A], { openings: reopened });
  await commit(db, 45, [A], { openings: reopened, conditions: [provisional(A, 24, 53)] });
  const after = await condition(db, A);
  assert.deepEqual({ form: after.form, fatigue: after.fatigue }, { form: 53, fatigue: 24 });
  assert.deepEqual(after.injured_until, before.injured_until);
  assert.deepEqual(after.updated_at, before.updated_at);
  assert.equal(await settlements(db, A), 0);
});

test("full day: press, stage load, closing tick, one settlement, one consumed load, then already_ran", async () => {
  const db = await fresh();
  const { opening_conditions: openings } = await register(db);
  await stamp(db, A);
  for (const day of [41, 42, 44]) await commit(db, day, [A], { openings });
  await commit(db, 45, [A], { openings, conditions: [provisional(A, 24, 50)] });
  // The load is accepted after the press: the date is not closed.
  await db.query(`SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`);
  // Evening: his race slot is the last missing tick and closes the date.
  const closing = await commit(db, 43, [A], { openings, intensity: "race", conditions: [cond(A, 33, 52, "2026-11-09T19:00:00Z")], loads: [LOAD()], at: "2026-11-09T19:00:00Z" });
  assert.equal(closing.already_ran, false);
  assert.equal(await settlements(db, A), 1);
  assert.equal((await condition(db, A)).fatigue, 33);
  assert.equal(await scalar(db, `SELECT count(*)::int c FROM training_race_loads WHERE rider_id='${A}' AND consumed_at IS NOT NULL`), 1);
  const again = await commit(db, 43, [A], { openings, intensity: "race", conditions: [cond(A, 99, 1, "2026-11-09T19:05:00Z")], loads: [LOAD()], at: "2026-11-09T19:05:00Z" });
  assert.equal(again.already_ran, true);
  assert.equal((await condition(db, A)).fatigue, 33, "a repeat never moves the closed numbers");
  assert.equal(await settlements(db, A), 1);
});

test("the closing tick cannot be provisional, and it must carry the rider's numbers and his loads", async () => {
  const db = await fresh();
  const { opening_conditions: openings } = await register(db);
  await stamp(db, A);
  for (const day of [41, 42, 44, 45]) await commit(db, day, [A], { openings });
  await db.query(`SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`);
  assert.match((await attempt(() => commit(db, 43, [A], { openings, conditions: [provisional(A, 24, 50)], loads: [LOAD()] }))).raised, /Provisional condition cannot settle/);
  assert.match((await attempt(() => commit(db, 43, [A], { openings, loads: [LOAD()] }))).raised, /Every final rider receipt/);
  assert.match((await attempt(() => commit(db, 43, [A], { openings, conditions: [cond(A, 33, 52)] }))).raised, /Race load snapshot changed/);
  assert.equal(await settlements(db, A), 0);
  assert.deepEqual(await ticks(db, A), [41, 42, 44, 45], "every refused call left nothing behind");
});

test("a mixed batch on the last race day closes the unstamped rider and leaves the stamped one open", async () => {
  const db = await fresh();
  const { opening_conditions: openings } = await register(db);
  await stamp(db, A);
  for (const day of [41, 42, 43, 44]) await commit(db, day, day === 43 ? [B] : [A, B], { openings });
  const mixed = await commit(db, 45, [A, B], { openings, conditions: [provisional(A, 24, 50), cond(B, 26, 49)] });
  assert.deepEqual([...mixed.applied_rider_ids].sort(), [A, B]);
  assert.equal(await settlements(db, B), 1);
  assert.equal(await settlements(db, A), 0);
  assert.equal(await status(db), "partial");
});

test("switch off mid-date: the stamp in the table decides, not app_config", async () => {
  const db = await fresh();
  const { opening_conditions: openings } = await register(db);
  await stamp(db, A);
  await db.exec("UPDATE app_config SET value='\"off\"' WHERE key='training_train_now_instant'");
  for (const day of [41, 42, 44, 45]) await commit(db, day, [A], { openings });
  const closing = await commit(db, 43, [A], { openings, intensity: "race", conditions: [cond(A, 33, 52)], at: AT(30) });
  assert.equal(closing.already_ran, false);
  assert.equal(await settlements(db, A), 1);
});

test("instant date eligibility keeps existing entries and reserves its remaining slots", async () => {
  const db = await fresh();
  await register(db);
  await db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id) VALUES('${A}','${DATE}','${SEASON}','${TEAM}');
    INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${RACE}','${A}','${TEAM}');`);
  const freeze = () => db.query(`SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${A}}','${AT(0)}') AS frozen`);
  const first = (await freeze()).rows[0].frozen;
  assert.deepEqual(first[0].slots.map(s => s.gameDay), [43]);
  await db.exec(`DELETE FROM race_entries WHERE rider_id='${A}'; INSERT INTO race_entries(race_id,rider_id,team_id,race_role) VALUES('${RACE}','${A}','${TEAM}','leader');`);
  assert.equal(await scalar(db, `SELECT race_role FROM race_entries WHERE rider_id='${A}'`), 'leader');
  assert.deepEqual((await freeze()).rows[0].frozen, first);
  const secondRace = id(801);
  await db.exec(`INSERT INTO races(id,season_id) VALUES('${secondRace}','${SEASON}'); INSERT INTO race_stage_schedule VALUES('${secondRace}',1,44,'2026-11-09T16:00:00Z');
    INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${secondRace}','${A}','${TEAM}');`);
  assert.equal(await scalar(db, `SELECT count(*)::int FROM race_entries WHERE race_id='${secondRace}'`), 0);
});

test("frozen eligibility follows season and binding spans and remains after switch off", async () => {
  const db = await fresh();
  await register(db);
  await db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id) VALUES('${A}','${DATE}','${SEASON}','${TEAM}');
    SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${A}}','${AT(0)}');
    UPDATE app_config SET value='"off"' WHERE key='training_train_now_instant';`);
  const span = id(810), later = id(811), otherSeason = id(812);
  await db.exec(`INSERT INTO races(id,season_id) VALUES('${span}','${SEASON}'),('${later}','${SEASON}'),('${otherSeason}','${id(901)}');
    INSERT INTO race_stage_schedule VALUES('${span}',1,40,'2026-11-08T15:00:00Z'),('${span}',2,46,'2026-11-10T15:00:00Z'),('${later}',1,46,'2026-11-10T16:00:00Z'),('${otherSeason}',1,44,'2026-11-09T16:00:00Z');
    INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${span}','${A}','${TEAM}'),('${later}','${A}','${TEAM}'),('${otherSeason}','${A}','${TEAM}');`);
  assert.deepEqual((await db.query("SELECT race_id FROM race_entries ORDER BY race_id")).rows.map(row => row.race_id), [later, otherSeason]);
  await assert.rejects(db.query(`SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${id(99)}}','${AT(0)}')`), /Registered date roster required/);
});

test("frozen eligibility uses selected riders when a stored entrant list is incomplete", async () => {
  const db = await fresh();
  await register(db);
  await db.exec(`UPDATE race_simulation_runs SET entrant_snapshot='[{"missing":"rider"}]';
    INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${RACE}','${A}','${TEAM}');
    INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id) VALUES('${A}','${DATE}','${SEASON}','${TEAM}');`);
  const frozen = await scalar(db, `SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${A}}','${AT(0)}')`);
  assert.deepEqual(frozen[0].slots.map(slot => slot.gameDay), [43]);
});

test("frozen pending slots require stage evidence at the commit boundary", async () => {
  const db = await fresh();
  const openings = (await register(db)).opening_conditions;
  await stamp(db, A);
  await db.exec(`INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${RACE}','${A}','${TEAM}');
    SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${A}}','${AT(0)}');
    DELETE FROM race_entries WHERE rider_id='${A}';`);
  for (const day of [41,42,44,45]) await commit(db, day, [A], { openings });
  await assert.rejects(commit(db, 43, [A], { openings, conditions: [cond(A,33,52)] }), /Frozen training slot requires current race evidence/);
  assert.deepEqual(await ticks(db,A), [41,42,44,45]);
  assert.equal(await settlements(db,A), 0);
  await db.exec(`INSERT INTO race_entries(race_id,rider_id,team_id,race_role) VALUES('${RACE}','${A}','${TEAM}','leader');
    UPDATE races SET stages_completed=1 WHERE id='${RACE}';
    INSERT INTO race_results(race_id,stage_number,rider_id,result_type) VALUES('${RACE}',1,'${A}','stage');`);
  await db.query(`SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`);
  await commit(db,43,[A],{openings,intensity:"race",conditions:[cond(A,33,52)],loads:[LOAD()],at:AT(30)});
  assert.equal(await settlements(db,A), 1);
});

test("frozen slots retain deadline race-load and unknown-activity settlement semantics", async () => {
  for (const recorded of [false,true]) {
    const db=await fresh();
    const openings=(await register(db)).opening_conditions;
    await stamp(db,A);
    await db.exec(`INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${RACE}','${A}','${TEAM}'); SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${A}}','${AT(0)}')`);
    for(const day of [41,42,44,45]) await commit(db,day,[A],{openings});
    if(recorded) await db.query(`SELECT record_training_race_load('${RACE}',1,'[{"rider_id":"${A}","load":9.6}]')`);
    await assert.rejects(commit(db,43,[A],{openings,intensity:recorded?"race":"normal",conditions:[cond(A,33,52)],loads:recorded?[LOAD()]:[]}),/Frozen training slot requires current race evidence/);
    await commit(db,43,[A],{openings,intensity:recorded?"race":"unknown_pending",conditions:[cond(A,33,52)],loads:recorded?[LOAD()]:[],deadlineReached:true,at:"2026-11-10T03:00:00Z"});
    assert.equal(await settlements(db,A),1);
  }
});

test("frozen slot terminal evidence releases absent entrants and removed stages", async () => {
  for(const terminal of ["entrant","stage"]) {
    const db=await fresh();
    const openings=(await register(db)).opening_conditions;
    await stamp(db,A);
    await db.exec(`UPDATE race_simulation_runs SET entrant_snapshot=NULL; INSERT INTO race_entries(race_id,rider_id,team_id) VALUES('${RACE}','${A}','${TEAM}'); SELECT freeze_train_now_date_entries('${TEAM}','${SEASON}','${DATE}','{${A}}','${AT(0)}')`);
    if(terminal==="entrant") await db.exec("UPDATE race_simulation_runs SET entrant_snapshot='[]'");
    else await db.exec("DELETE FROM race_stage_schedule");
    await commit(db,43,[A],{openings});
    assert.deepEqual(await ticks(db,A),[43]);
  }
});

test("a refused migration preserves the previously published training function", async () => {
  const db=await fresh({migrated:false});
  const definition=()=>scalar(db,"SELECT pg_get_functiondef('public.commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz)'::regprocedure)");
  const before=await definition();
  const migration=(await file(MIGRATION)).replace('CREATE OR REPLACE FUNCTION public.race_entries_train_now_instant_guard()', 'SELECT missing_migration_fixture_function();\nCREATE OR REPLACE FUNCTION public.race_entries_train_now_instant_guard()');
  await assert.rejects(db.exec(migration),/missing_migration_fixture_function/);
  await db.exec("ROLLBACK");
  assert.equal((await definition())===before,true,"the previous function remains published");
});
