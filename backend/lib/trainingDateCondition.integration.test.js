import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const team = '00000000-0000-0000-0000-000000000001';
const rider = '00000000-0000-0000-0000-000000000002';
const season = '00000000-0000-0000-0000-000000000003';
const race = '00000000-0000-0000-0000-000000000004';
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
  const migration = await readFile(new URL('../../database/2026-09-29-5928-training-condition-date.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const partial=await readFile(new URL('../../database/2026-09-29-5928-training-condition-partial.sql',import.meta.url),'utf8');
  await db.exec(partial);
  await db.exec(partial);
  const recovery=await readFile(new URL('../../database/2026-09-29-5928-training-condition-recovery.sql',import.meta.url),'utf8');
  await db.exec(recovery);await db.exec(recovery);
  const initialization = await readFile(new URL('../../database/2026-09-29-5928-training-condition-initialization.sql', import.meta.url), 'utf8');
  await db.exec(initialization); await db.exec(initialization);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE riders, rider_derived_abilities, rider_condition, training_day_runs, races, race_results,race_stage_schedule, race_simulation_runs,race_incidents,training_date_work,training_condition_timeout_outbox CASCADE;
    UPDATE app_config SET value='"off"' WHERE key='training_condition_per_date';
    INSERT INTO app_config VALUES('training_tick_per_race_day','"on"') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
    INSERT INTO riders VALUES('${rider}','${team}');
    INSERT INTO rider_derived_abilities VALUES('${rider}',50,'{}');
    INSERT INTO rider_condition(rider_id,form,fatigue) VALUES('${rider}',50,60);`);
});
async function commit(day, fatigue = 55, raceLoads = [], dateDays = [1,2,3,4,5]) {
  const registration = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',[team,season,'2026-09-29',dateDays,[rider],'2026-09-29T19:00:00Z']);
  const opening = registration.rows[0].work.opening_conditions[rider];
  const observed=(await db.query('SELECT * FROM rider_condition WHERE rider_id=$1',[rider])).rows[0];
  const final=day===dateDays.at(-1);
  const values = [team, season, 'senior', day, '2026-09-29', dateDays, 'assistant',
    JSON.stringify({condition_per_date:true, condition_settled:final, riders:[{rider_id:rider,game_day:day,intensity:'normal',form:53,fatigue,condition_before_date:opening,condition_observed:observed,missing_evidence:[]}]}), JSON.stringify([{riderId:rider,patch:{climbing:50+day}}]),
    JSON.stringify(final ? [{...observed,rider_id:rider,form:53,fatigue}] : []), '[]','[]','[]',JSON.stringify(raceLoads),false,'2026-09-29T19:00:00Z'];
  return (await db.query(`SELECT commit_training_date_tick(${values.map((_,i)=>`$${i+1}`).join(',')}) AS result`, values)).rows[0].result;
}

test('first date registration materializes the existing neutral fallback for an owned rider', async () => {
  await db.exec('DELETE FROM rider_condition');
  const args = [team, season, '2026-09-29', [1,2,3,4,5], [rider], '2026-09-29T18:00:00Z'];
  const result = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work', args);
  assert.deepEqual(result.rows[0].work.opening_conditions[rider]?.form, 50);
  assert.equal(result.rows[0].work.opening_conditions[rider]?.fatigue, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 1);
  await db.exec('UPDATE rider_condition SET fatigue=20');
  const retry = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work', args);
  assert.equal(retry.rows[0].work.opening_conditions[rider].fatigue, 0, 'frozen opening survives retry');
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue, 20);
});

test('historical registration does not fabricate a missing condition after its deadline', async () => {
  await db.exec('DELETE FROM rider_condition');
  const result = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [team, season, '2026-09-29', [1,2,3,4,5], [rider], '2026-09-30T08:00:00Z']);
  assert.deepEqual(result.rows[0].work.opening_conditions, {});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 0);
});

test('registration does not initialize a rider now owned by a different team', async () => {
  await db.exec('DELETE FROM rider_condition');
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [race, rider]);
  const result = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [team, season, '2026-09-29', [1,2,3,4,5], [rider], '2026-09-29T18:00:00Z']);
  assert.deepEqual(result.rows[0].work.opening_conditions, {});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 0);
});

test('a first-use rider receives all five receipts and one settlement; retries do not credit twice', async () => {
  await db.exec('DELETE FROM rider_condition');
  for (const day of [1,2,3,4,5]) await commit(day);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_rider_ticks')).rows[0].n, 5);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_condition_settlements')).rows[0].n, 1);
  const before = (await db.query('SELECT * FROM rider_condition')).rows;
  for (const day of [1,2,3,4,5]) assert.equal((await commit(day)).already_ran, true);
  assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows, before);
});

test('a missing row with a saved legacy report is not reset to a neutral condition', async () => {
  await db.exec('DELETE FROM rider_condition');
  await db.query('INSERT INTO training_day_runs(team_id,season_id,game_day,tick_date,report) VALUES($1,$2,0,$3,$4)',
    [team, season, '2026-09-28', JSON.stringify({ riders: [{ rider_id: rider, form: 65, fatigue: 40 }] })]);
  const result = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [team, season, '2026-09-29', [1,2,3,4,5], [rider], '2026-09-29T18:00:00Z']);
  assert.deepEqual(result.rows[0].work.opening_conditions, {});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 0);
});

test('legacy history from a previous owner prevents neutral initialization after transfer', async () => {
  await db.exec('DELETE FROM rider_condition');
  await db.query('INSERT INTO training_day_runs(team_id,season_id,game_day,tick_date,report) VALUES($1,$2,0,$3,$4)',
    [race, season, '2026-09-28', JSON.stringify({ riders: [{ rider_id: rider, form: 65, fatigue: 40 }] })]);
  const result = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [team, season, '2026-09-29', [1,2,3,4,5], [rider], '2026-09-29T18:00:00Z']);
  assert.deepEqual(result.rows[0].work.opening_conditions, {});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 0);
});

test('a repeated registration with an extra rider cannot initialize outside the frozen roster', async () => {
  const extra = '00000000-0000-0000-0000-000000000097';
  await db.query('INSERT INTO riders(id,team_id) VALUES($1,$2)', [extra, team]);
  const args = [team, season, '2026-09-29', [1,2,3,4,5], [rider], '2026-09-29T18:00:00Z'];
  await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6)', args);
  args[4] = [rider, extra];
  const result = await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work', args);
  assert.deepEqual(result.rows[0].work.expected_rider_ids, [rider]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition WHERE rider_id=$1',[extra])).rows[0].n, 0);
});
test('five atomic commits settle once; duplicate and restart replay cannot change state', async () => {
  for(let day=1;day<=4;day++) await commit(day);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,60);
  await commit(5);
  assert.equal((await commit(5,99)).already_ran,true);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,55);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_day_runs')).rows[0].count,5);
});
test('partial commit rolls back ability and report; retry completes once', async () => {
  for(let day=1;day<=4;day++) await commit(day);
  await assert.rejects(commit(5,101), /check constraint/);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing,54);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_day_runs')).rows[0].count,4);
  await commit(5);
});
test('out of order is rejected and new flag remains off after repeated migration', async () => {
  await assert.rejects(commit(2), /Earlier rider date ticks/);
  assert.equal((await db.query("SELECT value FROM app_config WHERE key='training_condition_per_date'")).rows[0].value,'off');
});
test('public roles cannot call privileged tick commit', async () => {
  await db.exec('SET ROLE authenticated');
  try { await assert.rejects(commit(1), /permission denied for function/); }
  finally { await db.exec('RESET ROLE'); }
});

test('an unfinished previous date cannot silently lose condition settlement', async () => {
  await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6)',[team,season,'2026-09-28',[0,1,2,3,4],[rider],'2026-09-28T19:00:00Z']);
  await db.query(`INSERT INTO training_day_runs VALUES($1,$2,'senior',0,'2026-09-28','assistant',false,'{"condition_per_date":true,"condition_settled":false}')`,[team,season]);
  await assert.rejects(commit(1),/Earlier rider date condition settlement is incomplete/);
});

test('service_role commits through invoker rights with explicit table grants', async () => {
  await db.exec(`GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT ON riders, rider_derived_abilities, rider_condition, training_day_runs,race_incidents,race_stage_schedule TO service_role;
    GRANT UPDATE ON riders,rider_derived_abilities, rider_condition, training_day_runs TO service_role;
    GRANT INSERT ON rider_condition, training_day_runs, rider_derived_ability_history, rider_ability_race_day_history, rider_training_scores TO service_role;
    SET ROLE service_role;`);
  try {
    for(const day of [1,2,3,4,5]) assert.equal((await commit(day)).already_ran,false);
    assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,55);
  } finally { await db.exec('RESET ROLE'); }
});

async function seedRace() {
  await db.query('INSERT INTO races VALUES($1,$2)',[race,season]);
  await db.query(`INSERT INTO race_stage_schedule SELECT $1,i,i,'2026-09-29T09:00:00Z'::timestamptz FROM generate_series(1,5)i`,[race]);
}
async function record(stageNumber,load=12) {
  await db.query(`INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot)
    SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM race_simulation_runs WHERE race_id=$1 AND stage_number=$2)`,[race,stageNumber,JSON.stringify([rider]),JSON.stringify([{rider_id:rider,load:12}])]);
  return (await db.query('SELECT record_training_race_load($1,$2,$3) AS result',[race,stageNumber,JSON.stringify([{rider_id:rider,load}])])).rows[0].result;
}
async function ledger() {return (await db.query('SELECT rider_id,race_id,stage_number,game_day,load::float AS load FROM training_race_loads ORDER BY game_day')).rows;}
test('race ledger is idempotent, immutable and does not write live fatigue', async()=>{
  await seedRace();
  assert.deepEqual(await record(1),{recorded:1});
  assert.deepEqual(await record(1),{recorded:0});
  await assert.rejects(record(1,20),/immutable effort snapshot/);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,60);
});
test('settlement rejects stale ledger snapshot then consumes exact loads atomically',async()=>{
  await seedRace();
  for(const day of [1,2,3,4]) await commit(day);
  await record(1);
  await assert.rejects(commit(5),/snapshot changed/);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing,54);
  await commit(5,55,await ledger());
  assert.ok((await db.query('SELECT consumed_at FROM training_race_loads')).rows[0].consumed_at);
  await assert.rejects(record(2),/after date settlement/);
  assert.deepEqual(await record(1),{recorded:0});
});
async function bootstrap(overrides={}) {
  const openings=[{rider_id:rider,opening_form:50,opening_fatigue:40,expected_form:50,expected_fatigue:60,source:'verified-yesterday-final-report',...overrides}];
  const loads=[{rider_id:rider,race_id:race,stage_number:1,load:12}];
  return db.query('SELECT bootstrap_training_condition_date($1,$2,$3,$4) AS result',[season,'2026-09-29',JSON.stringify(openings),JSON.stringify(loads)]);
}
test('approved cutover compares current state, preserves injuries and atomically seeds loads and flag',async()=>{
  await seedRace();
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[race,JSON.stringify([rider])]);
  await db.exec("UPDATE rider_condition SET injury_cause='race_crash',injured_until='2026-10-01'");
  await assert.rejects(bootstrap({expected_fatigue:61}),/current condition changed/);
  assert.equal((await db.query("SELECT value FROM app_config WHERE key='training_condition_per_date'")).rows[0].value,'off');
  assert.equal((await ledger()).length,0);
  await bootstrap();
  const condition=(await db.query('SELECT * FROM rider_condition')).rows[0];
  assert.equal(condition.fatigue,40);
  assert.equal(condition.injury_cause,'race_crash');
  assert.equal((await ledger()).length,1);
  assert.equal((await db.query("SELECT value FROM app_config WHERE key='training_condition_per_date'")).rows[0].value,'on');
  await assert.rejects(bootstrap(),/existing off flag/);
});
test('cutover rejects omitted actual starters without writing anything',async()=>{
  await seedRace();
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[race,JSON.stringify([rider,'00000000-0000-0000-0000-000000000099'])]);
  await assert.rejects(bootstrap(),/exactly cover immutable date starters/);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,60);
  assert.equal((await db.query("SELECT value FROM app_config WHERE key='training_condition_per_date'")).rows[0].value,'off');
});

test('service-only cutover supports unchanged openings and forbids authenticated execution',async()=>{
  await seedRace();
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[race,JSON.stringify([rider])]);
  await db.exec('SET ROLE authenticated');
  try {await assert.rejects(bootstrap({opening_fatigue:60}),/permission denied for function/);}
  finally {await db.exec('RESET ROLE');}
  await db.exec(`GRANT SELECT,UPDATE ON app_config,rider_condition TO service_role;
    GRANT INSERT ON app_config TO service_role;
    GRANT SELECT ON riders,races,race_stage_schedule,race_simulation_runs,training_day_runs TO service_role;
    GRANT UPDATE ON race_simulation_runs TO service_role;
    SET ROLE service_role;`);
  try {await bootstrap({opening_fatigue:60});}
  finally {await db.exec('RESET ROLE');}
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,60);
  assert.equal((await ledger()).length,1);
});

test('bootstrap rejects disabled race-day prerequisite without writes',async()=>{
  await seedRace();
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot) VALUES($1,1,$2)',[race,JSON.stringify([rider])]);
  await db.exec(`INSERT INTO app_config VALUES('training_tick_per_race_day','"off"') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  await assert.rejects(bootstrap(),/requires training_tick_per_race_day/);
  assert.equal((await ledger()).length,0);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,60);
});

test('zero-based game-day date settles and canonical ledger accepts game day zero',async()=>{
  await seedRace();
  await db.query('UPDATE race_stage_schedule SET game_day=0 WHERE race_id=$1 AND stage_number=1',[race]);
  await record(1);
  assert.equal((await ledger())[0].game_day,0);
  for(const day of [0,1,2,3]) await commit(day,55,[],[0,1,2,3,4]);
  await commit(4,55,await ledger(),[0,1,2,3,4]);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition')).rows[0].fatigue,55);
});

test('atomic immutable run preserves ID, snapshots and score foreign keys through failed retries',async()=>{
  await seedRace();
  const run={race_id:race,stage_number:1,seed:123,engine_version:3,input_checksum:456,entrant_snapshot:[rider],condition_load_snapshot:[{rider_id:rider,load:12}]};
  const scores=[{rider_id:rider,rank:1,components:{terrain:1}}];
  async function persist(row, scoreRows) {return (await db.query('SELECT persist_training_condition_run($1,$2) AS result',[JSON.stringify(row),JSON.stringify(scoreRows)])).rows[0].result;}
  const first=await persist(run,scores);
  const repeated=await persist(run,[{...scores[0],components:null}]);
  assert.equal(repeated.id,first.id);
  assert.equal(repeated.already_saved,true);
  await assert.rejects(persist({...run,condition_load_snapshot:[]},scores),/Conflicting immutable/);
  const preserved=(await db.query('SELECT * FROM race_simulation_runs WHERE id=$1',[first.id])).rows[0];
  assert.deepEqual(preserved.condition_load_snapshot,run.condition_load_snapshot);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM race_simulation_rider_scores WHERE run_id=$1',[first.id])).rows[0].count,1);
  await assert.rejects(persist({...run,stage_number:2},[{...scores[0],components:null}]),/not-null constraint/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM race_simulation_runs WHERE stage_number=2')).rows[0].count,0);
});

const rider2='00000000-0000-0000-0000-000000000005';
async function registerPair(date='2026-09-29',days=[5,6,7,8,9]) {
  await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6)',[team,season,date,days,[rider,rider2],`${date}T19:00:00Z`]);
}
async function commitSubset(day,ids,{deadline=false,date='2026-09-29',days=[5,6,7,8,9],now='2026-09-29T19:00:00Z',unknown=false,forceUnknownGrowth=false}={}) {
  const final=day===days.at(-1);
  const current=(await db.query('SELECT * FROM rider_condition WHERE rider_id=ANY($1)',[ids])).rows;
  const reports=ids.map(id=>({rider_id:id,game_day:day,intensity:unknown&&id===rider2&&day===6?'unknown_pending':'normal',condition_before_date:{form:50,fatigue:60},condition_observed:current.find(row=>row.rider_id===id),form:53,fatigue:55,
    missing_evidence:unknown&&id===rider2&&day>=6?[{raceId:race,stageNumber:1,gameDay:6}]:[]}));
  const abilities=reports.filter(row=>row.intensity!=='unknown_pending'||forceUnknownGrowth).map(row=>({riderId:row.rider_id,patch:{climbing:row.rider_id===rider&&deadline?99:50+day}}));
  const conditions=final?reports.map(row=>({...row.condition_observed,rider_id:row.rider_id,form:53,fatigue:55})):[];
  const report={riders:reports,condition_per_date:true,condition_settled:final};
  const values=[team,season,'senior',day,date,days,'assistant',JSON.stringify(report),JSON.stringify(abilities),JSON.stringify(conditions),'[]','[]','[]','[]',deadline,now];
  return (await db.query(`SELECT commit_training_date_tick(${values.map((_,i)=>`$${i+1}`).join(',')}) AS result`,values)).rows[0].result;
}
test('one pending rider cannot block teammate; deadline merges receipts once and retains late load evidence',async()=>{
  await db.query('INSERT INTO riders VALUES($1,$2)',[rider2,team]);
  await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}')",[rider2]);
  await db.query('INSERT INTO rider_condition(rider_id,form,fatigue) VALUES($1,50,60)',[rider2]);
  await registerPair();
  for(const day of [5,6,7,8,9]) await commitSubset(day,[rider]);
  assert.equal((await db.query('SELECT status FROM training_date_work')).rows[0].status,'partial');
  assert.equal((await db.query('SELECT fatigue FROM rider_condition WHERE rider_id=$1',[rider2])).rows[0].fatigue,60);
  for(const day of [5,6,7,8,9]) {
    await commitSubset(day,[rider,rider2],{deadline:true,unknown:true,now:'2026-09-30T00:00:00Z'});
    if(day===6) assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider2])).rows[0].climbing,55);
  }
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_rider_ticks')).rows[0].count,10);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider])).rows[0].climbing,59);
  const work=(await db.query('SELECT * FROM training_date_work')).rows[0];
  assert.equal(work.status,'needs_reconciliation');
  assert.equal(work.missing_evidence.length,1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_condition_timeout_outbox')).rows[0].count,1);
  assert.equal((await db.query('SELECT report FROM training_day_runs WHERE game_day=9')).rows[0].report.riders.length,2);
  await seedRace();await db.query('UPDATE race_stage_schedule SET game_day=6 WHERE stage_number=1');
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot) VALUES($1,1,$2,$3)',[race,JSON.stringify([rider2]),JSON.stringify([{rider_id:rider2,load:12}])]);
  await db.query('SELECT record_training_race_load($1,1,$2)',[race,JSON.stringify([{rider_id:rider2,load:12}])]);
  const late=(await db.query('SELECT * FROM training_race_loads')).rows[0];
  assert.equal(late.reconciliation_required,true);assert.equal(late.consumed_at,null);
  assert.equal((await db.query('SELECT fatigue FROM rider_condition WHERE rider_id=$1',[rider2])).rows[0].fatigue,55);
  await registerPair('2026-09-30',[10,11,12,13,14]);
  assert.equal((await commitSubset(10,[rider2],{date:'2026-09-30',days:[10,11,12,13,14],now:'2026-09-30T19:00:00Z'})).already_ran,false);
});

test('registration freezes roster and selects earliest valid Copenhagen deadline across DST',async()=>{
  for(const [date,expected] of [['2026-10-24','2026-10-25T00:00:00.000Z'],['2027-03-27','2027-03-28T01:00:00.000Z']]) {
    const first=(await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',[team,season,date,[0,1,2,3,4],[rider],`${date}T12:00:00Z`])).rows[0].work;
    assert.equal(new Date(first.deadline_at).toISOString(),expected);
    const retry=(await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',[team,season,date,[0,1,2,3,4],[rider,rider2],`${date}T12:00:00Z`])).rows[0].work;
    assert.deepEqual(retry.expected_rider_ids,[rider]);
  }
});

test('alert acknowledgement retries atomically without acknowledging a newer payload version',async()=>{
  await db.query(`INSERT INTO training_condition_timeout_outbox(team_id,season_id,tick_date,payload,updated_at) VALUES($1,$2,'2026-09-29','{}','2026-09-30T00:00:00Z')`,[team,season]);
  const ack=async(cutoff,delivered)=>(await db.query('SELECT mark_training_condition_alert_attempt($1,$2,$3,$4,$5) AS affected',['2026-09-29',cutoff,'2026-09-30T00:02:00Z',delivered,delivered?null:'ops unavailable'])).rows[0].affected;
  assert.equal(await ack('2026-09-30T00:00:00Z',false),1);
  await db.exec("UPDATE training_condition_timeout_outbox SET updated_at='2026-09-30T00:01:00Z',payload='{\"new\":true}'");
  assert.equal(await ack('2026-09-30T00:00:00Z',true),0);
  assert.equal(await ack('2026-09-30T00:02:00Z',true),1);
  const row=(await db.query('SELECT * FROM training_condition_timeout_outbox')).rows[0];
  assert.equal(row.attempts,2);assert.ok(row.delivered_at);
  assert.equal(new Date(row.updated_at).toISOString(),'2026-09-30T00:01:00.000Z');
  assert.equal(await ack('2026-09-30T00:02:00Z',true),0);
});

test('SQL rejects premature unknown settlement and accidental unknown ability growth without receipts',async()=>{
  await db.query('INSERT INTO riders VALUES($1,$2)',[rider2,team]);
  await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}')",[rider2]);
  await db.query('INSERT INTO rider_condition(rider_id,form,fatigue) VALUES($1,50,60)',[rider2]);
  await registerPair();await commitSubset(5,[rider2]);
  await assert.rejects(commitSubset(6,[rider2],{unknown:true}),/only at date deadline/);
  await assert.rejects(commitSubset(6,[rider2],{unknown:true,deadline:true,forceUnknownGrowth:true,now:'2026-09-30T00:00:00Z'}),/cannot award ability growth/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_rider_ticks')).rows[0].count,1);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider2])).rows[0].climbing,55);
});

test('historical load recovery across dates is idempotent and preserves newer injury and condition',async()=>{
  await seedRace();
  await db.exec("UPDATE app_config SET value='\"on\"' WHERE key='training_condition_per_date'; UPDATE races SET status='completed',stages_completed=2; UPDATE race_stage_schedule SET scheduled_at='2026-09-28T09:00:00Z' WHERE stage_number=1; UPDATE rider_condition SET fatigue=79,form=66,injury_cause='newer_crash',injured_until='2026-10-09'");
  for(const stage of [1,2]) await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot) VALUES($1,$2,$3,$4)',[race,stage,JSON.stringify([rider]),JSON.stringify([{rider_id:rider,load:12}])]);
  const before=(await db.query('SELECT * FROM rider_condition')).rows;
  for(const stage of [1,2]) {
    const recovered=(await db.query('SELECT recover_training_race_load_stage($1,$2,NULL,$3) AS result',[race,stage,'2026-10-01T10:00:00Z'])).rows[0].result;
    assert.equal(recovered.recorded,1);assert.equal(recovered.marker_updated,false);
  }
  for(const stage of [1,2]) assert.equal((await db.query('SELECT recover_training_race_load_stage($1,$2,NULL,$3) AS result',[race,stage,'2026-10-01T11:00:00Z'])).rows[0].result.recorded,0);
  assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows,before);
  assert.deepEqual((await db.query('SELECT tick_date::text FROM training_race_loads ORDER BY stage_number')).rows.map(row=>row.tick_date),['2026-09-28','2026-09-29']);
});

test('recovery advances only fatigue marker and holds unfinished historical race for reviewed completion',async()=>{
  await seedRace();await db.exec("UPDATE app_config SET value='\"on\"' WHERE key='training_condition_per_date'; UPDATE races SET stages_completed=2");
  const original={stage_index:1,stage_number:2,final:true,done:['write','enrichment']};
  await db.query('UPDATE races SET finalize_state=$1',[JSON.stringify(original)]);
  await db.query('INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot) VALUES($1,2,$2,$3)',[race,JSON.stringify([rider]),JSON.stringify([{rider_id:rider,load:12}])]);
  const first=(await db.query('SELECT recover_training_race_load_stage($1,2,$2,$3) AS result',[race,JSON.stringify(original),'2026-10-01T10:00:00Z'])).rows[0].result;
  assert.deepEqual(first.finalize_state.done,['write','enrichment','fatigue']);assert.ok(first.finalize_state.condition_recovery_hold);
  const repeated=(await db.query('SELECT recover_training_race_load_stage($1,2,$2,$3) AS result',[race,JSON.stringify(first.finalize_state),'2026-10-01T11:00:00Z'])).rows[0].result;
  assert.equal(repeated.recorded,0);assert.equal(repeated.marker_updated,false);
  assert.equal((await db.query('SELECT status FROM races')).rows[0].status,'scheduled');
  await assert.rejects(db.query('SELECT recover_training_race_load_stage($1,2,$2,$3)',[race,JSON.stringify(original),'2026-10-01T11:00:00Z']),/Finalization changed/);
});

test('a moved expected rider is quarantined without blocking a ready teammate or applying growth',async()=>{
  await db.query('INSERT INTO riders VALUES($1,$2)',[rider2,team]);
  await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}')",[rider2]);
  await db.query('INSERT INTO rider_condition(rider_id,form,fatigue) VALUES($1,50,60)',[rider2]);
  await registerPair();
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',['00000000-0000-0000-0000-000000000099',rider2]);
  await commitSubset(5,[rider,rider2]);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider])).rows[0].climbing,55);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider2])).rows[0].climbing,50);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_rider_ticks WHERE rider_id=$1',[rider2])).rows[0].count,0);
  for(const day of [6,7,8,9]) await commitSubset(day,[rider]);
  const work=(await db.query('SELECT * FROM training_date_work')).rows[0];
  assert.deepEqual(work.quarantined_rider_ids,[rider2]);assert.equal(work.status,'needs_reconciliation');
});

async function addSecondRider() {
  await db.query('INSERT INTO riders VALUES($1,$2)',[rider2,team]);
  await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}')",[rider2]);
  await db.query('INSERT INTO rider_condition(rider_id,form,fatigue) VALUES($1,50,60)',[rider2]);
}
test('unavailable old-season work becomes explicit unapplied reconciliation without touching newer injuries',async()=>{
  await addSecondRider();await registerPair();
  await db.exec("UPDATE rider_condition SET form=72,fatigue=83,injury_cause='newer_crash',injured_until='2026-10-09'");
  const before=(await db.query('SELECT * FROM rider_condition ORDER BY rider_id')).rows;
  const args=[team,season,'2026-09-29',[rider,rider2],'older_season','2026-10-02T10:00:00Z'];
  const result=(await db.query('SELECT quarantine_training_date_riders($1,$2,$3,$4,$5,$6) AS result',args)).rows[0].result;
  assert.equal(result.work_status,'needs_reconciliation');
  assert.deepEqual(result.work.expected_rider_ids,[rider,rider2]);
  assert.deepEqual((await db.query('SELECT * FROM rider_condition ORDER BY rider_id')).rows,before);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_rider_ticks')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_condition_settlements')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM training_condition_timeout_outbox')).rows[0].count,1);
  assert.equal(result.work.quarantine_evidence[0].condition_applied,false);
  const retry=(await db.query('SELECT quarantine_training_date_riders($1,$2,$3,$4,$5,$6) AS result',args)).rows[0].result;
  assert.deepEqual(retry.quarantined_rider_ids,[]);
});

test('same-logical-date crash after registration preserves injury with frozen form and fatigue',async()=>{
  await addSecondRider();await registerPair();await seedRace();
  await db.query("INSERT INTO race_incidents VALUES($1,1,$2,'crash','continue',2)",[race,rider2]);
  await db.query("UPDATE rider_condition SET injury_cause='race_crash',injured_until='2026-10-09',injury_end_game_day=15,injury_season_id=$1 WHERE rider_id=$2",[season,rider2]);
  for(const day of [5,6,7,8,9]) await commitSubset(day,[rider,rider2]);
  const current=(await db.query('SELECT * FROM rider_condition WHERE rider_id=$1',[rider2])).rows[0];
  assert.equal(current.injury_cause,'race_crash');assert.equal(current.injury_end_game_day,15);
  const settlement=(await db.query('SELECT * FROM training_condition_settlements WHERE rider_id=$1',[rider2])).rows[0];
  assert.equal(settlement.opening_condition.injury_cause,null);assert.equal(settlement.applied_condition.injury_cause,'race_crash');
  assert.equal((await db.query('SELECT status FROM training_date_work')).rows[0].status,'complete');
});

test('newer-date crash with stale updated_at is quarantined by canonical incident date',async()=>{
  await addSecondRider();await registerPair();await seedRace();
  await db.exec("UPDATE race_stage_schedule SET scheduled_at='2026-09-30T09:00:00Z' WHERE stage_number=1");
  await db.query("INSERT INTO race_incidents VALUES($1,1,$2,'crash','continue',2)",[race,rider2]);
  await db.query("UPDATE rider_condition SET injury_cause='race_crash',injured_until='2026-10-09' WHERE rider_id=$1",[rider2]);
  const before=(await db.query('SELECT * FROM rider_condition WHERE rider_id=$1',[rider2])).rows[0];
  await commitSubset(5,[rider,rider2]);
  assert.deepEqual((await db.query('SELECT * FROM rider_condition WHERE rider_id=$1',[rider2])).rows[0],before);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider2])).rows[0].climbing,50);
  assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities WHERE rider_id=$1',[rider])).rows[0].climbing,55);
  assert.deepEqual((await db.query('SELECT quarantined_rider_ids FROM training_date_work')).rows[0].quarantined_rider_ids,[rider2]);
});

test('late first registration never labels current condition as an old dated opening',async()=>{
  const work=(await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',[team,season,'2026-09-29',[5,6,7,8,9],[rider],'2026-09-30T08:00:00Z'])).rows[0].work;
  assert.deepEqual(work.opening_conditions,{});
});

test('stored-result completion prepares and finishes idempotently without touching original results or current condition',async()=>{
  await seedRace();await db.exec("DELETE FROM race_stage_schedule WHERE stage_number>2; UPDATE races SET stages=2,stages_completed=2; UPDATE race_stage_schedule SET scheduled_at='2026-09-28T09:00:00Z' WHERE stage_number=1");
  const state={stage_number:2,stage_index:1,final:true,done:['write','enrichment','standings','board','notify','fatigue'],condition_recovery_hold:{requires_review:true}};
  await db.query('UPDATE races SET finalize_state=$1',[JSON.stringify(state)]);
  await db.query("INSERT INTO race_results(race_id,stage_number,result_type) VALUES($1,1,'stage'),($1,2,'stage'),($1,2,'gc')",[race]);
  await record(1);await record(2);
  const results=(await db.query('SELECT * FROM race_results ORDER BY id')).rows,condition=(await db.query('SELECT * FROM rider_condition')).rows;
  const missingProof={...state,done:state.done.filter(step=>step!=='board')};
  await db.query('UPDATE races SET finalize_state=$1',[JSON.stringify(missingProof)]);
  await assert.rejects(db.query('SELECT prepare_recorded_race_completion($1,$2,$3)',[race,JSON.stringify(missingProof),'2026-10-01T10:00:00Z']),/Missing original completion proof/);
  assert.equal((await db.query('SELECT status FROM races')).rows[0].status,'scheduled');
  await db.query('UPDATE races SET finalize_state=$1',[JSON.stringify(state)]);
  const prepared=(await db.query('SELECT prepare_recorded_race_completion($1,$2,$3) AS result',[race,JSON.stringify(state),'2026-10-01T10:00:00Z'])).rows[0].result;
  assert.ok(prepared.finalize_state.recorded_completion_prepared);
  await db.query('SELECT finish_recorded_race_completion($1,$2,$3)',[race,JSON.stringify(prepared.finalize_state),'2026-10-01T10:01:00Z']);
  const again=(await db.query('SELECT prepare_recorded_race_completion($1,NULL,$2) AS result',[race,'2026-10-01T10:02:00Z'])).rows[0].result;
  assert.equal(again.already_complete,true);
  assert.deepEqual((await db.query('SELECT * FROM race_results ORDER BY id')).rows,results);assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows,condition);
});
