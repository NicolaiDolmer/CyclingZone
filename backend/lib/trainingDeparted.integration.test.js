// #6504 (del B): a rider who provably left the team is taken out of the date
// without alarm. Runs the live RPC bodies (5928/6439 + 6504) on PGlite.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const oldTeam = '00000000-0000-0000-0000-000000000001';
const newTeam = '00000000-0000-0000-0000-000000000099';
const stay = '00000000-0000-0000-0000-000000000002';
const mover = '00000000-0000-0000-0000-000000000005';
const buyerOwn = '00000000-0000-0000-0000-000000000006';
const season = '00000000-0000-0000-0000-000000000003';
const DATE = '2026-09-29', DAYS = [5, 6, 7, 8, 9];

before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE app_config(key text PRIMARY KEY, value jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE riders(id uuid PRIMARY KEY, team_id uuid,is_retired boolean DEFAULT false);
    CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,status text DEFAULT 'scheduled',stages_completed integer DEFAULT 0,finalize_state jsonb,finalize_updated_at timestamptz,stages integer DEFAULT 5,race_type text DEFAULT 'stage_race');
    CREATE TABLE race_results(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),race_id uuid,stage_number integer,result_type text);
    CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,game_day integer,scheduled_at timestamptz);
    CREATE TABLE race_incidents(race_id uuid,stage_number integer,rider_id uuid,kind text,outcome text,injury_days integer);
    CREATE TABLE race_simulation_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),race_id uuid,stage_number integer,entrant_snapshot jsonb,seed bigint DEFAULT 0,engine_version integer DEFAULT 1,input_checksum bigint DEFAULT 0,source text,salt_version text,UNIQUE(race_id,stage_number));
    CREATE TABLE race_simulation_rider_scores(run_id uuid REFERENCES race_simulation_runs(id) ON DELETE CASCADE,rider_id uuid,rank integer,components jsonb NOT NULL,PRIMARY KEY(run_id,rider_id));
    CREATE TABLE rider_derived_abilities(rider_id uuid PRIMARY KEY, climbing integer, ability_progress jsonb);
    CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY, form smallint, fatigue smallint CHECK(fatigue BETWEEN 0 AND 100), injured_until date, injury_cause text, updated_at timestamptz, injury_end_game_day integer, injury_season_id uuid, injury_race_days_left integer);
    CREATE TABLE training_day_runs(team_id uuid, season_id uuid, squad text, game_day integer, tick_date date, executed_by text, bonus_applied boolean, report jsonb, UNIQUE(team_id, season_id, squad, game_day));
    CREATE TABLE rider_derived_ability_history(rider_id uuid, snapshot_date date, source text, season_number integer, abilities jsonb, UNIQUE(rider_id,snapshot_date,source));
    CREATE TABLE rider_ability_race_day_history(rider_id uuid, season_id uuid, game_day integer, source text, season_number integer, snapshot_date date, abilities jsonb, UNIQUE(rider_id,season_id,game_day,source));
    CREATE TABLE rider_training_scores(rider_id uuid, team_id uuid, season_id uuid, tick_date date, game_day integer, score integer, session text, day_type text, was_race_day boolean, intention text, contributions jsonb);
  `);
  const load = async name => db.exec(await readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8'));
  for (const name of ['2026-09-29-5928-training-condition-date.sql', '2026-09-29-5928-training-condition-partial.sql',
    '2026-09-29-5928-training-condition-recovery.sql', '2026-09-29-5928-training-condition-initialization.sql']) await load(name);
  await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid');
  await load('2026-09-30-5860-shared-race-day-recovery.sql');
  // Twice: the migration must be idempotent.
  await load('2026-10-10-6439-training-follows-rider.sql');
  // Twice: the #6504 migration must be idempotent too.
  await load('2026-10-19-6504-departed-training-riders.sql');
  await load('2026-10-19-6504-departed-training-riders.sql');
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE riders, rider_derived_abilities, rider_condition, training_day_runs, races, race_results, race_stage_schedule,
    race_simulation_runs, race_incidents, training_date_work, training_condition_timeout_outbox CASCADE;`);
  for (const [id, team] of [[stay, oldTeam], [mover, oldTeam], [buyerOwn, newTeam]]) {
    await db.query('INSERT INTO riders VALUES($1,$2)', [id, team]);
    await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}')", [id]);
    await db.query('INSERT INTO rider_condition(rider_id,form,fatigue) VALUES($1,50,60)', [id]);
  }
});

async function register(team, ids) {
  return (await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [team, season, DATE, DAYS, ids, `${DATE}T17:00:00Z`])).rows[0].work;
}
async function commit(team, day, ids) {
  const final = day === DAYS.at(-1);
  const current = (await db.query('SELECT * FROM rider_condition WHERE rider_id=ANY($1)', [ids])).rows;
  const reports = ids.map(id => ({ rider_id: id, game_day: day, intensity: 'normal', condition_before_date: { form: 50, fatigue: 60 },
    condition_observed: current.find(row => row.rider_id === id), form: 53, fatigue: 55, missing_evidence: [] }));
  const abilities = ids.map(id => ({ riderId: id, patch: { climbing: 50 + day } }));
  const conditions = final ? reports.map(row => ({ ...row.condition_observed, rider_id: row.rider_id, form: 53, fatigue: 55 })) : [];
  const values = [team, season, 'senior', day, DATE, DAYS, 'assistant', JSON.stringify({ riders: reports, condition_per_date: true, condition_settled: final }),
    JSON.stringify(abilities), JSON.stringify(conditions), '[]', '[]', '[]', '[]', false, `${DATE}T18:00:00Z`];
  return (await db.query(`SELECT commit_training_date_tick(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`, values)).rows[0].result;
}
const depart = async (team, ids) => (await db.query('SELECT depart_training_date_riders($1,$2,$3,$4,$5) AS r',
  [team, season, DATE, ids, `${DATE}T18:30:00Z`])).rows[0].r;
const work = async team => (await db.query('SELECT * FROM training_date_work WHERE team_id=$1', [team])).rows[0];
const outbox = async () => (await db.query('SELECT count(*)::int AS n FROM training_condition_timeout_outbox')).rows[0].n;

test('a rider released after four race days departs; the date ends complete with no alarm', async () => {
  await register(oldTeam, [stay, mover]);
  for (const day of [5, 6, 7, 8]) await commit(oldTeam, day, [stay, mover]);
  await db.query('UPDATE riders SET team_id=NULL WHERE id=$1', [mover]);
  assert.deepEqual((await depart(oldTeam, [mover])).departed_rider_ids, [mover]);
  await commit(oldTeam, 9, [stay]);
  const w = await work(oldTeam);
  assert.equal(w.status, 'complete');
  assert.deepEqual(w.quarantined_rider_ids, [mover]);
  assert.deepEqual(w.quarantine_evidence, []);
  assert.deepEqual(w.missing_evidence, []);
  assert.equal(w.departure_evidence.length, 1);
  assert.equal(w.departure_evidence[0].reason, 'left_team');
  assert.deepEqual(w.departure_evidence[0].applied_receipt_days, [5, 6, 7, 8]);
  assert.equal(await outbox(), 0);
  // Retrying is a no-op.
  assert.deepEqual((await depart(oldTeam, [mover])).departed_rider_ids, []);
});

test('a rider still on a team is never departed; the work row is unchanged', async () => {
  await register(oldTeam, [stay, mover]);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [newTeam, mover]);
  const before = await work(oldTeam);
  assert.deepEqual((await depart(oldTeam, [mover])).departed_rider_ids, []);
  const afterRow = await work(oldTeam);
  assert.deepEqual(afterRow.quarantined_rider_ids, before.quarantined_rider_ids);
  assert.equal(afterRow.status, before.status);
});

test('a departed rider who is quarantined next to a real finding still leaves the real alarm intact', async () => {
  await register(oldTeam, [stay, mover]);
  await db.query('UPDATE riders SET team_id=NULL WHERE id=$1', [mover]);
  await depart(oldTeam, [mover]);
  await db.query("SELECT quarantine_training_date_riders($1,$2,$3,$4,'roster_or_opening_evidence_unavailable',$5)",
    [oldTeam, season, DATE, [stay], `${DATE}T18:31:00Z`]);
  const w = await work(oldTeam);
  assert.equal(w.status, 'needs_reconciliation');
  assert.deepEqual(w.missing_evidence.map(e => e.rider_id), [stay]);
  assert.equal(await outbox(), 1);
});

test('when every rider departs before any tick, the date is complete at once', async () => {
  await register(oldTeam, [stay, mover]);
  await db.query('UPDATE riders SET team_id=NULL WHERE id = ANY($1)', [[stay, mover]]);
  const r = await depart(oldTeam, [stay, mover]);
  assert.deepEqual([...r.departed_rider_ids].sort(), [stay, mover].sort());
  assert.equal((await work(oldTeam)).status, 'complete');
  assert.equal(await outbox(), 0);
});

test('only service_role may execute the departure RPC', async () => {
  const { rows } = await db.query(`SELECT has_function_privilege('authenticated',
    'public.depart_training_date_riders(uuid,uuid,date,uuid[],timestamptz)','EXECUTE') AS auth,
    has_function_privilege('service_role','public.depart_training_date_riders(uuid,uuid,date,uuid[],timestamptz)','EXECUTE') AS svc`);
  assert.equal(rows[0].auth, false);
  assert.equal(rows[0].svc, true);
});
