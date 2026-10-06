// #6061 writer + #6129 slim source hashes, against the real SQL (PGlite).
// Use the registered production migrations: ledger/trigger first, slim writer
// second. Replaying the ledger must not replace the current writer (#6219).
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildApplyPayload,SOURCE_HASH_TABLES} from '../scripts/dev/compensation6061Source.mjs';
let db;
const rid='00000000-0000-0000-0000-000000000001',team='00000000-0000-0000-0000-000000000002',season='00000000-0000-0000-0000-000000000003';
const user='00000000-0000-0000-0000-000000000004',raceA='00000000-0000-0000-0000-00000000000a',raceB='00000000-0000-0000-0000-00000000000b',other='00000000-0000-0000-0000-000000000009';
const NOW='2026-10-03T13:00:00Z',THROUGH='2026-10-02';
const scope={rider_ids:[rid],team_ids:[team],season_ids:[season]};
before(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE app_config(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
 CREATE TABLE teams(id uuid PRIMARY KEY,user_id uuid,my_result_seen_race_id uuid,onboarding_progress_dismissed_at timestamptz,balance bigint);
 CREATE TABLE users(id uuid PRIMARY KEY,role text,is_beta_tester boolean,last_seen timestamptz,last_login_date date,nps_last_prompted_at timestamptz,xp integer);
 CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean,is_academy boolean,birthdate date,potentiale numeric,primary_type text,secondary_type text,market_value bigint,updated_at timestamptz);
 CREATE TABLE seasons(id uuid PRIMARY KEY,number integer,status text,race_days_completed integer);
 CREATE TABLE rider_derived_abilities(rider_id uuid PRIMARY KEY,climbing smallint,ability_progress jsonb);
 CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY,form integer,fatigue integer,injured_until date,injury_cause text,updated_at timestamptz);
 CREATE TABLE training_race_loads(rider_id uuid,race_id uuid,stage_number integer,season_id uuid,game_day integer,tick_date date,load numeric,consumed_at timestamptz,reconciliation_required boolean,duplicate_of_race_id uuid,duplicate_of_stage_number integer);
 CREATE TABLE training_rider_ticks(rider_id uuid,season_id uuid,game_day integer,tick_date date,team_id uuid,report jsonb);
 CREATE TABLE training_condition_settlements(rider_id uuid,season_id uuid,tick_date date,team_id uuid,status text,opening_condition jsonb,applied_condition jsonb,missing_evidence jsonb);
 CREATE TABLE training_day_runs(report jsonb);
 CREATE TABLE training_date_work(team_id uuid,season_id uuid,tick_date date,game_days integer[],expected_rider_ids uuid[],deadline_at timestamptz,status text,missing_evidence jsonb,opening_conditions jsonb,quarantined_rider_ids uuid[],quarantine_evidence jsonb,updated_at timestamptz);
 CREATE TABLE training_plans(id uuid,team_id uuid,rider_id uuid,season_id uuid,focus text,intensity text,updated_at timestamptz);
 CREATE TABLE training_week_plans(id uuid,team_id uuid,rider_id uuid,days jsonb,program_key text,updated_at timestamptz);
 CREATE TABLE team_training_rules(id uuid,team_id uuid,rider_id uuid,fatigue_threshold integer,fallback text,recovery_after_stage boolean);
 CREATE TABLE training_groups(id uuid,team_id uuid,name text,days jsonb,program_key text,fatigue_threshold integer,fallback text);
 CREATE TABLE training_group_members(rider_id uuid,group_id uuid,team_id uuid,follows_group boolean);
 CREATE TABLE team_facilities(id uuid,team_id uuid,track text,tier integer);
 CREATE TABLE team_staff(id uuid,team_id uuid,role text,name text,tier integer,status text,salary integer);
 CREATE TABLE staff_derived_abilities(staff_id uuid,overall numeric,dimensions jsonb,levels jsonb,updated_at timestamptz);
 CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,race_type text,stages_completed integer,status text,finalize_state text);
 CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,scheduled_at timestamptz,game_day integer,created_at timestamptz);
 CREATE TABLE race_stage_profiles(id uuid,race_id uuid,stage_number integer,profile_type text,weather jsonb);
 CREATE TABLE race_simulation_runs(id uuid,race_id uuid,stage_number integer,entrant_snapshot jsonb,seed text);
 CREATE TABLE race_results(id uuid,race_id uuid,stage_number integer,result_type text,rider_id uuid,rank integer);
 CREATE TABLE race_entry_days(race_id uuid,rider_id uuid,season_id uuid,game_day integer,team_id uuid);
 GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT INSERT ON rider_condition TO service_role;`);
 const ledger=await readFile(new URL('../../database/2026-10-05-6061-compensation-ledger.sql',import.meta.url),'utf8');
 const migration=await readFile(new URL('../../database/2026-10-05-6129-compensation-slim-source.sql',import.meta.url),'utf8');
 await db.exec(ledger);await db.exec(migration);await db.exec(ledger);await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`TRUNCATE app_config,teams,users,riders,seasons,rider_derived_abilities,rider_condition,training_race_loads,training_rider_ticks,training_condition_settlements,training_day_runs,training_date_work,training_plans,training_week_plans,team_training_rules,training_groups,training_group_members,team_facilities,team_staff,staff_derived_abilities,races,race_stage_schedule,race_stage_profiles,race_simulation_runs,race_results,race_entry_days,training_compensation_receipts;
 INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');
 INSERT INTO users VALUES('${user}','manager',false,'2026-10-03T08:00:00Z','2026-10-03','2026-10-01T08:00:00Z',10);
 INSERT INTO teams VALUES('${team}','${user}',NULL,NULL,1000);
 INSERT INTO seasons VALUES('${season}',4,'active',10);
 INSERT INTO riders VALUES('${rid}','${team}',false,false,'2000-06-01',80,'climber','puncheur',100,'2026-10-03T08:00:00Z');
 INSERT INTO rider_derived_abilities VALUES('${rid}',50,'{"climbing":0.2}');
 INSERT INTO training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,status,opening_conditions,quarantined_rider_ids,quarantine_evidence,updated_at)
  VALUES('${team}','${season}','2026-10-02','{20,21,22,23,24}','{${rid}}','needs_reconciliation','{}','{${rid}}','[]','2026-10-02T18:00:00Z');
 -- Race A spans the cutoff: stage 1 before it, stage 2 today (after it).
 INSERT INTO races VALUES('${raceA}','${season}','stage',1,'running','open');
 INSERT INTO race_stage_schedule VALUES('${raceA}',1,'2026-10-02T09:00:00Z',23,NULL),('${raceA}',2,'2026-10-03T09:00:00Z',25,NULL);
 INSERT INTO race_stage_profiles VALUES(gen_random_uuid(),'${raceA}',1,'mountain','{}'),(gen_random_uuid(),'${raceA}',2,'flat','{}');
 INSERT INTO race_simulation_runs VALUES(gen_random_uuid(),'${raceA}',1,'["${other}"]','s1');
 -- Race B starts after the cutoff.
 INSERT INTO races VALUES('${raceB}','${season}','single',0,'scheduled','open');
 INSERT INTO race_stage_schedule VALUES('${raceB}',1,'2026-10-03T12:00:00Z',26,NULL);`);
});
const hashes=async()=>(await db.query('SELECT training_compensation_6061_source_hashes($1::uuid[],$2::uuid[],$3::uuid[],$4::date) AS h',[scope.rider_ids,scope.team_ids,scope.season_ids,THROUGH])).rows[0].h;
async function plan(){
 const result={policy:'current_plans_current_engine',through:THROUGH,source_hash:'f'.repeat(64),plans:[{rider_id:rid,team_id:team,season_id:season,
  current_condition:(await db.query('SELECT to_jsonb(c) AS row FROM rider_condition c')).rows[0]?.row??null,
  expected_abilities:(await db.query('SELECT to_jsonb(a) AS row FROM rider_derived_abilities a')).rows[0].row,
  patch:{climbing:51,ability_progress:{climbing:0.3}},days:[{gameDay:24,tickDate:THROUGH,key:`6061:${season}:24:${rid}`,kind:'free_slot',formBefore:50}],perDay:[{key:`6061:${season}:24:${rid}`,progress:0.1,gains:{}}]}]};
 return buildApplyPayload(result,{scope,sourceHashes:await hashes()});
}
async function apply(payload,hashOverride=null,now=NOW){const raw=typeof payload==='string'?payload:JSON.stringify(payload);const hash=hashOverride??createHash('sha256').update(raw).digest('hex');return (await db.query('SELECT apply_training_compensation_6061($1,$2,$3) AS result',[raw,hash,now])).rows[0].result;}
const receipts=async()=>(await db.query('SELECT count(*)::int AS n FROM training_compensation_receipts')).rows[0].n;
const climbing=async()=>(await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing;

test('hash function covers exactly the writer tables and is deterministic',async()=>{
 const a=await hashes(),b=await hashes();assert.deepEqual(a,b);
 assert.deepEqual(Object.keys(a).sort(),[...SOURCE_HASH_TABLES].sort());
 assert.ok(Object.values(a).every(h=>/^[a-f0-9]{64}$/.test(h)));
});
test('approved file is atomic and idempotent; first-use state resumes only current date',async()=>{
 await db.query(`INSERT INTO training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,status,opening_conditions,quarantined_rider_ids,quarantine_evidence,updated_at) VALUES($1,$2,'2026-10-03','{25,26,27,28,29}',$3,'needs_reconciliation','{}',$3,$4,$5)`,[team,season,[rid],JSON.stringify([{rider_id:rid}]),NOW]);
 const p=await plan();const result=await apply(p);assert.equal(result.rider_days,1);assert.equal(result.initialized_conditions,1);
 assert.equal(await climbing(),51);
 const w=(await db.query("SELECT * FROM training_date_work WHERE tick_date='2026-10-03'")).rows[0];assert.equal(w.status,'pending');assert.deepEqual(w.quarantined_rider_ids,[]);assert.ok(w.opening_conditions[rid]);
 assert.equal((await apply(p)).already_applied,true);assert.equal(await receipts(),1);
 const stored=(await db.query('SELECT payload FROM training_compensation_receipts')).rows[0].payload;assert.equal(stored.kind,'free_slot');assert.equal(stored.formBefore,undefined);
});
test('presence and UI columns changing after capture do not fail the check (#6129)',async()=>{
 const p=await plan();const before=await hashes();
 await db.exec(`UPDATE users SET last_seen=now(),last_login_date='2026-10-04',nps_last_prompted_at=now(),xp=xp+5;
  UPDATE teams SET my_result_seen_race_id='${raceA}',onboarding_progress_dismissed_at=now(),balance=balance+1;
  UPDATE riders SET market_value=market_value+1,updated_at=now();UPDATE app_config SET updated_at=now();
  UPDATE seasons SET race_days_completed=11;UPDATE races SET status='finished',finalize_state='done';
  UPDATE race_stage_profiles SET weather='{"wind":1}';UPDATE team_staff SET salary=1;`);
 assert.deepEqual(await hashes(),before);
 assert.equal((await apply(p)).rider_days,1);assert.equal(await climbing(),51);
});
test('a relevant column change fails the check and names the table',async()=>{
 const p=await plan();await db.exec('UPDATE users SET is_beta_tester=true');
 await assert.rejects(apply(p),/source changed \(users\)/);
 await db.exec('UPDATE users SET is_beta_tester=false;UPDATE riders SET potentiale=81');
 await assert.rejects(apply(p),/source changed \(riders\)/);
 assert.equal(await climbing(),50);assert.equal(await receipts(),0);
});
test('race evidence after the cutoff does not fail the check',async()=>{
 const p=await plan();const before=await hashes();
 await db.query(`UPDATE races SET stages_completed=2 WHERE id=$1`,[raceA]);
 await db.query(`UPDATE races SET stages_completed=1 WHERE id=$1`,[raceB]);
 await db.query(`INSERT INTO race_simulation_runs VALUES(gen_random_uuid(),$1,2,'[]','s2'),(gen_random_uuid(),$2,1,$3,'s3')`,[raceA,raceB,JSON.stringify([rid])]);
 await db.query(`INSERT INTO race_results VALUES(gen_random_uuid(),$1,2,'stage',$2,4),(gen_random_uuid(),$3,1,'gc',$2,1),(gen_random_uuid(),$1,1,'gc',$2,3)`,[raceA,rid,raceB]);
 await db.query(`INSERT INTO training_race_loads(rider_id,race_id,stage_number,season_id,game_day,tick_date,load) VALUES($1,$2,2,$3,25,'2026-10-03',10)`,[rid,raceA,season]);
 await db.query(`INSERT INTO race_entry_days VALUES($1,$2,$3,26,$4)`,[raceB,rid,season,team]);
 await db.query(`INSERT INTO race_stage_schedule VALUES($1,3,'2026-10-04T09:00:00Z',30,now())`,[raceA]);
 assert.deepEqual(await hashes(),before);
 assert.equal((await apply(p)).rider_days,1);
});
test('new race evidence for a compensated slot still stops the run',async()=>{
 for(const [table,statement,params] of [
  ['race_results',`INSERT INTO race_results VALUES(gen_random_uuid(),$1,1,'stage',$2,7)`,[raceA,rid]],
  ['race_entry_days',`INSERT INTO race_entry_days VALUES($1,$2,$3,24,$4)`,[raceA,rid,season,team]],
  ['training_race_loads',`INSERT INTO training_race_loads(rider_id,race_id,stage_number,season_id,game_day,tick_date,load) VALUES($1,$2,1,$3,24,'2026-10-02',12)`,[rid,raceA,season]],
  ['race_simulation_runs',`INSERT INTO race_simulation_runs VALUES(gen_random_uuid(),$1,1,$2,'retry')`,[raceA,JSON.stringify([rid])]],
 ]){
  const p=await plan();await db.query(statement,params);
  await assert.rejects(apply(p),new RegExp(`source changed \\(${table}\\)`));
  await db.exec(`TRUNCATE ${table}`);if(table==='race_simulation_runs')await db.query(`INSERT INTO race_simulation_runs VALUES(gen_random_uuid(),$1,1,$2,'s1')`,[raceA,JSON.stringify([other])]);
 }
 const p=await plan();await db.query('UPDATE races SET stages_completed=0 WHERE id=$1',[raceA]);await assert.rejects(apply(p),/source changed \(races\)/);
 await db.query('UPDATE races SET stages_completed=1 WHERE id=$1',[raceA]);
 await db.query('INSERT INTO training_plans(id,team_id,rider_id,focus,intensity) VALUES(gen_random_uuid(),$1,$2,$3,$4)',[team,rid,'climbing','hard']);await assert.rejects(apply(p),/source changed \(training_plans\)/);
 assert.equal(await climbing(),50);assert.equal(await receipts(),0);
});
test('changed abilities or condition/ownership abort before credit',async()=>{
 const p=await plan();await db.exec('UPDATE rider_derived_abilities SET climbing=52');await assert.rejects(apply(p),/abilities changed/);
 assert.equal(await receipts(),0);
});
test('existing injury and newer condition remain byte-for-byte unchanged',async()=>{
 await db.query("INSERT INTO rider_condition VALUES($1,67,49,'2026-10-05','race_crash',$2)",[rid,NOW]);const before=(await db.query('SELECT * FROM rider_condition')).rows;
 await apply(await plan());assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows,before);
});
test('hash mismatch, existing receipt and arbitrary fields reject with zero writes',async()=>{
 const p=await plan();await assert.rejects(apply(p,'0'.repeat(64)),/hash mismatch/);
 p.plans[0].patch.hidden_potential=99;await assert.rejects(apply(p),/Unsupported/);delete p.plans[0].patch.hidden_potential;
 await db.query("INSERT INTO training_rider_ticks VALUES($1,$2,24,'2026-10-02',$3,'{}')",[rid,season,team]);await assert.rejects(apply(await plan()),/already trained/);
 assert.equal(await climbing(),50);
});
test('old full-row payloads, incomplete hashes, foreign scope and oversize payloads are refused',async()=>{
 const p=await plan();
 await assert.rejects(apply({...p,source_checks:[]}),/Slim compensation payload/);
 const partial=structuredClone(p);delete partial.source_hashes.users;await assert.rejects(apply(partial),/Complete source hashes/);
 const foreign=structuredClone(p);foreign.source_scope.team_ids=[other];await assert.rejects(apply(foreign),/outside source scope/);
 await assert.rejects(apply(JSON.stringify(p)+' '.repeat(2*1024*1024)),/Slim compensation payload/);
 assert.equal(await receipts(),0);
});
test('late validation failure rolls the entire batch back',async()=>{
 await db.query('INSERT INTO training_condition_settlements(rider_id) VALUES($1)',[rid]);await assert.rejects(apply(await plan()),/applied history/);
 assert.equal(await climbing(),50);assert.equal(await receipts(),0);
});
test('public roles cannot call writer or hash function; service role applies via invoker rights',async()=>{
 const p=await plan();await db.exec('SET ROLE authenticated');
 try{await assert.rejects(apply(p),/permission denied/);await assert.rejects(hashes(),/permission denied/);}finally{await db.exec('RESET ROLE');}
 await db.exec('SET ROLE service_role');try{assert.equal((await apply(p)).rider_days,1);}finally{await db.exec('RESET ROLE');}
});
test('normal historical retry cannot train a compensated slot again',async()=>{
 await apply(await plan());
 await assert.rejects(db.query("INSERT INTO training_rider_ticks VALUES($1,$2,24,'2026-10-02',$3,'{}')",[rid,season,team]),/compensated/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM training_rider_ticks')).rows[0].n,0);
});
test('evening guard and closed cutoff still hold',async()=>{
 await db.query(`INSERT INTO training_date_work(team_id,season_id,tick_date,game_days,status) VALUES($1,$2,'2026-10-03','{25,26,27,28,29}','pending')`,[team,season]);
 await assert.rejects(apply(await plan(),null,'2026-10-03T16:30:00Z'),/current date close/);
 await assert.rejects(apply(await plan(),null,'2026-10-02T09:00:00Z'),/Closed compensation cutoff/);
 assert.equal(await receipts(),0);
});
