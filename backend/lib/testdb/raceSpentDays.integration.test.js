import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const season = '00000000-0000-0000-0000-000000000001';
const oldRace = '00000000-0000-0000-0000-000000000002';
const newRace = '00000000-0000-0000-0000-000000000003';
const laterRace = '00000000-0000-0000-0000-000000000004';
const rider = '00000000-0000-0000-0000-000000000005';
const buyer = '00000000-0000-0000-0000-000000000006';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,status text,stages_completed integer DEFAULT 0,finalize_state jsonb);
    CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,game_day integer,scheduled_at timestamptz);
    CREATE TABLE race_simulation_runs(race_id uuid,stage_number integer,entrant_snapshot jsonb,created_at timestamptz DEFAULT '2026-09-30T10:00:00Z',PRIMARY KEY(race_id,stage_number));
    CREATE TABLE race_results(race_id uuid,stage_number integer,rider_id uuid,result_type text,imported_at timestamptz DEFAULT '2026-09-30T10:00:00Z');
    CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,PRIMARY KEY(race_id,rider_id));`);
  const migration = await readFile(new URL('../../../database/2026-09-30-5860-spent-race-days.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('TRUNCATE race_day_participation,race_entries,race_simulation_runs,race_results,race_stage_schedule,races CASCADE');
  for (const [id, status, day, hour] of [[oldRace, 'completed', 12, 10], [newRace, 'scheduled', 12, 13], [laterRace, 'scheduled', 13, 16]]) {
    await db.query('INSERT INTO races(id,season_id,status) VALUES($1,$2,$3)', [id, season, status]);
    await db.query('INSERT INTO race_stage_schedule VALUES($1,1,$2,$3)', [id, day, `2026-09-30T${hour}:00:00Z`]);
  }
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)', [oldRace, JSON.stringify([{rider_id: rider}])]);
});
const save = (raceId = newRace) => db.query('INSERT INTO race_entries VALUES($1,$2,$3)', [raceId, rider, buyer]);

test('a finished race and a transfer do not release its spent game day', async () => {
  await assert.rejects(() => save(), /selection_rider_bound/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM race_entries')).rows[0].n, 0);
});
test('snapshot backstop rejects a second race even if its selection predates the first result', async () => {
  await assert.rejects(() => db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)', [newRace, JSON.stringify([{rider_id:rider}])]), /no_rider_double_booking/);
});
test('the next game day remains available after transfer', async () => {
  await save(laterRace);
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)', [laterRace, JSON.stringify([{rider_id:rider}])]);
});
test('the same day number in another season is independent', async () => {
  await db.query('UPDATE races SET season_id=$1 WHERE id=$2', [buyer, newRace]);
  await save();
});
test('legacy string snapshots also retain the spent day', async () => {
  await db.query('UPDATE race_simulation_runs SET entrant_snapshot=$1 WHERE race_id=$2', [JSON.stringify([rider]), oldRace]);
  await assert.rejects(() => save(), /selection_rider_bound/);
});
test('repeating an unchanged snapshot within its own race remains idempotent', async () => {
  await db.query('UPDATE race_simulation_runs SET entrant_snapshot=$1 WHERE race_id=$2', [JSON.stringify([{rider_id:rider}]), oldRace]);
});

test('deleting a legacy snapshot cannot release its spent day', async () => {
  await db.query('DELETE FROM race_simulation_runs WHERE race_id=$1',[oldRace]);
  await assert.rejects(() => save(), /selection_rider_bound/);
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[oldRace,JSON.stringify([{rider_id:rider}])]);
});
test('results-before-snapshot path cannot commit a second official result', async () => {
  await assert.rejects(() => db.query("INSERT INTO race_results VALUES($1,1,$2,'stage')",[newRace,rider]), /no_rider_double_booking/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM race_results')).rows[0].n,0);
});
test('bootstrap retains stage-result evidence without an enrichment snapshot',async()=>{
  await db.exec('DROP TRIGGER race_results_guard_spent_day ON race_results');
  await db.exec('DELETE FROM race_simulation_runs; DELETE FROM race_day_participation');
  await db.query("INSERT INTO race_results VALUES($1,1,$2,'stage')",[oldRace,rider]);
  await db.exec(await readFile(new URL('../../../database/2026-09-30-5860-spent-race-days.sql',import.meta.url),'utf8'));
  await assert.rejects(()=>save(),/selection_rider_bound/);
});
test('already recorded historical overlaps survive unchanged upsert and legacy snapshot replacement',async()=>{
  await db.exec('DROP TRIGGER race_runs_guard_spent_day ON race_simulation_runs');
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[newRace,JSON.stringify([rider])]);
  await db.query("INSERT INTO race_results VALUES($1,1,$2,'stage')",[newRace,rider]);
  await db.exec(await readFile(new URL('../../../database/2026-09-30-5860-spent-race-days.sql',import.meta.url),'utf8'));
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2) ON CONFLICT DO NOTHING',[newRace,JSON.stringify([rider])]);
  await db.query('DELETE FROM race_simulation_runs WHERE race_id=$1',[newRace]);
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[newRace,JSON.stringify([rider])]);
});
test('authenticated admin table writes retain validation access without direct helper access',async()=>{
  await db.exec('GRANT INSERT ON race_entries TO authenticated; SET ROLE authenticated');
  try {
    await save(laterRace);
    await assert.rejects(()=>save(),/selection_rider_bound/);
    await assert.rejects(()=>db.query('SELECT * FROM find_spent_race_days($1,$2)',[newRace,[rider]]),/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});
test('pruning removes only stale unrecorded selections and is idempotent',async()=>{
  await db.exec('DROP TRIGGER race_entries_guard_spent_day ON race_entries');
  await save();
  const result=await db.query('SELECT prune_spent_race_entries($1,$2) AS n',[newRace,[rider]]);
  assert.equal(result.rows[0].n,1);
  assert.equal((await db.query('SELECT prune_spent_race_entries($1,$2) AS n',[newRace,[rider]])).rows[0].n,0);
  await db.exec(await readFile(new URL('../../../database/2026-09-30-5860-spent-race-days.sql',import.meta.url),'utf8'));
});
test('pruning refuses an already recorded field even with stale caller metadata',async()=>{
  await save(laterRace);
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[laterRace,JSON.stringify([rider])]);
  await assert.rejects(()=>db.query('SELECT prune_spent_race_entries($1,$2)',[laterRace,[rider]]),/Recorded race selection/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM race_entries')).rows[0].n,1);
});
