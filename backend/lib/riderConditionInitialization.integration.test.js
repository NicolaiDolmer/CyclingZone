import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const rider='00000000-0000-0000-0000-000000000001';
const team='00000000-0000-0000-0000-000000000002';
const season='00000000-0000-0000-0000-000000000003';
const acquired='2026-10-03T08:00:00Z';
let migration;
before(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
 CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean DEFAULT false,acquired_at timestamptz,created_at timestamptz);
 CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY REFERENCES riders(id),form integer,fatigue integer,injured_until date,injury_cause text,updated_at timestamptz);
 CREATE TABLE training_race_loads(rider_id uuid,consumed_at timestamptz);
 CREATE TABLE training_rider_ticks(rider_id uuid);
 CREATE TABLE training_condition_settlements(rider_id uuid);
 CREATE TABLE training_day_runs(report jsonb);
 CREATE TABLE training_date_work(team_id uuid,season_id uuid,tick_date date,game_days integer[],expected_rider_ids uuid[],deadline_at timestamptz,status text,opening_conditions jsonb,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(team_id,season_id,tick_date));
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT INSERT,UPDATE ON riders,rider_condition,training_date_work TO service_role;`);
 await db.exec(await readFile(new URL('../../database/2026-09-29-5928-training-condition-initialization.sql',import.meta.url),'utf8'));
 migration=await readFile(new URL('../../database/2026-10-03-6061-first-use-rider-condition.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`TRUNCATE riders,rider_condition,training_race_loads,training_rider_ticks,training_condition_settlements,training_day_runs,training_date_work CASCADE; DELETE FROM app_config;
 INSERT INTO app_config VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');`);
});
async function create(teamId=team){await db.query('INSERT INTO riders(id,team_id,created_at,acquired_at) VALUES($1,$2,$3,$3)',[rider,teamId,acquired]);}
test('new owned rider gets opening condition before his first race load',async()=>{
 await create();
 assert.equal((await db.query('SELECT form FROM rider_condition')).rows[0]?.form,50);
 await db.query('INSERT INTO training_race_loads(rider_id) VALUES($1)',[rider]);
 const work=(await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',[team,season,'2026-10-03',[25,26,27,28,29],[rider],'2026-10-03T18:00:00Z'])).rows[0].work;
 assert.equal(work.opening_conditions[rider]?.fatigue,0);
});
test('buying a never-active free rider initializes condition in the ownership transaction',async()=>{
 await create(null);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
 await db.query('UPDATE riders SET team_id=$1,acquired_at=$2 WHERE id=$3',[team,acquired,rider]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,1);
});
test('an existing injury and condition survive a new owner and retry',async()=>{
 await create(null);await db.query("INSERT INTO rider_condition VALUES($1,64,73,'2026-10-05','race_crash',$2)",[rider,acquired]);
 const before=(await db.query('SELECT * FROM rider_condition')).rows;
 await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[team,rider]);
 await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[team,rider]);
 assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows,before);
});
for(const table of ['training_race_loads','training_rider_ticks','training_condition_settlements']){
 test(`saved ${table} history forbids an automatic reset`,async()=>{
  await create(null);await db.query(`INSERT INTO ${table}(rider_id) VALUES($1)`,[rider]);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[team,rider]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
 });
}
test('legacy report under another owner forbids an automatic reset',async()=>{
 await create(null);await db.query('INSERT INTO training_day_runs VALUES($1)',[JSON.stringify({riders:[{rider_id:rider}]})]);
 await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[team,rider]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
});
test('disabled ownership flag leaves the old writer unchanged',async()=>{
 await db.exec(`UPDATE app_config SET value='"off"' WHERE key='training_condition_per_date'`);
 await create();assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
});
test('service role can initialize but public roles have no helper or condition write grant',async()=>{
 await db.exec('SET ROLE service_role');
 try {await create();}finally{await db.exec('RESET ROLE');}
 assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,1);
 const grants=(await db.query("SELECT has_function_privilege('authenticated','initialize_first_use_rider_condition()','EXECUTE') AS auth,has_function_privilege('anon','initialize_first_use_rider_condition()','EXECUTE') AS anon")).rows[0];
 assert.deepEqual(grants,{auth:false,anon:false});
});
test('installing the migration again never backfills existing missing conditions',async()=>{
 await create(null);await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[team,rider]);
 await db.exec('DELETE FROM rider_condition');await db.exec(migration);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
});

test('retired acquired rider receives no new condition',async()=>{
 await db.query('INSERT INTO riders(id,team_id,is_retired,created_at) VALUES($1,$2,true,$3)',[rider,team,acquired]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
});
test('inconsistent normalized flags roll back acquisition',async()=>{
 await create(null);
 await db.exec(`UPDATE app_config SET value='"off"' WHERE key='training_tick_per_race_day'`);
 await assert.rejects(db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[team,rider]),/requires training_tick_per_race_day/);
 assert.equal((await db.query('SELECT team_id FROM riders')).rows[0].team_id,null);
});
