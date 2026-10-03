import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
let db;let sql;
const rid='00000000-0000-0000-0000-000000000001',team='00000000-0000-0000-0000-000000000002',season='00000000-0000-0000-0000-000000000003';
const NOW='2026-10-03T13:00:00Z';
const scopes={teams:['id',[team]],users:['id',[]],app_config:['key',['training_condition_per_date','training_tick_per_race_day']],riders:['id',[rid]],seasons:['id',[season]],training_race_loads:['rider_id',[rid]],training_rider_ticks:['rider_id',[rid]],training_condition_settlements:['rider_id',[rid]],training_date_work:['team_id',[team]],training_plans:['team_id',[team]],training_week_plans:['team_id',[team]],team_training_rules:['team_id',[team]],training_groups:['team_id',[team]],training_group_members:['team_id',[team]],team_facilities:['team_id',[team]],team_staff:['team_id',[team]],staff_derived_abilities:['staff_id',[]],races:['season_id',[season]],race_stage_schedule:['race_id',[]],race_stage_profiles:['race_id',[]],race_simulation_runs:['race_id',[]],race_results:['rider_id',[rid]],race_entry_days:['rider_id',[rid]]};
before(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
 CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean);
 CREATE TABLE rider_derived_abilities(rider_id uuid PRIMARY KEY,climbing smallint,ability_progress jsonb);
 CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY,form integer,fatigue integer,injured_until date,injury_cause text,updated_at timestamptz);
 CREATE TABLE training_rider_ticks(rider_id uuid,season_id uuid,game_day integer,tick_date date);
 CREATE TABLE training_condition_settlements(rider_id uuid);
 CREATE TABLE training_day_runs(report jsonb);
 CREATE TABLE training_date_work(team_id uuid,season_id uuid,tick_date date,expected_rider_ids uuid[],opening_conditions jsonb,quarantined_rider_ids uuid[],quarantine_evidence jsonb,status text,updated_at timestamptz);
 `);
 for(const [table,[key]] of Object.entries(scopes))await db.exec(`CREATE TABLE IF NOT EXISTS ${table}(${key} text)`);
 await db.exec(`GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT UPDATE ON riders,rider_derived_abilities,rider_condition,training_date_work TO service_role;
 GRANT INSERT ON rider_condition TO service_role;`);
 sql=await readFile(new URL('../../database/proposals/2026-10-03-6061-apply-compensation.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec(`TRUNCATE riders,rider_derived_abilities,rider_condition,training_rider_ticks,training_condition_settlements,training_day_runs,training_date_work,training_compensation_receipts;
 DELETE FROM app_config;INSERT INTO app_config VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');
 INSERT INTO riders VALUES('${rid}','${team}',false);INSERT INTO rider_derived_abilities VALUES('${rid}',50,'{"climbing":0.2}');`);});
async function plan(){const source_checks=[];for(const [table,[key,values]] of Object.entries(scopes))source_checks.push({table,key,values,rows:(await db.query(`SELECT to_jsonb(r) AS row FROM ${table} r WHERE ${key}::text=ANY($1)`,[values])).rows.map(r=>r.row)});return {issue:6061,policy:'current_plans_current_engine',through:'2026-10-02',source_checks,summary:{rider_days:1},plans:[{rider_id:rid,team_id:team,season_id:season,current_condition:(await db.query('SELECT to_jsonb(c) AS row FROM rider_condition c')).rows[0]?.row??null,expected_abilities:(await db.query('SELECT to_jsonb(a) AS row FROM rider_derived_abilities a')).rows[0].row,patch:{climbing:51,ability_progress:{climbing:0.3}},days:[{gameDay:24,tickDate:'2026-10-02',key:`6061:${season}:24:${rid}`,kind:'free_slot'}]}]};}
async function apply(payload,hashOverride=null,now=NOW){const raw=JSON.stringify(payload);const hash=hashOverride??createHash('sha256').update(raw).digest('hex');return (await db.query('SELECT apply_training_compensation_6061($1,$2,$3) AS result',[raw,hash,now])).rows[0].result;}
test('approved file is atomic and idempotent; first-use state resumes only current date',async()=>{
 await db.query('INSERT INTO training_date_work VALUES($1,$2,$3,$4,$5,$4,$6,$7,$8)',[team,season,'2026-10-03',[rid],{},[{rider_id:rid}], 'needs_reconciliation',NOW]);
 const p=await plan();const result=await apply(p);assert.equal(result.rider_days,1);assert.equal(result.initialized_conditions,1);
 assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing,51);
 const w=(await db.query('SELECT * FROM training_date_work')).rows[0];assert.equal(w.status,'pending');assert.deepEqual(w.quarantined_rider_ids,[]);assert.ok(w.opening_conditions[rid]);
 assert.equal((await apply(p)).already_applied,true);assert.equal((await db.query('SELECT count(*)::int AS n FROM training_compensation_receipts')).rows[0].n,1);
});
test('changed abilities or condition/ownership abort before credit',async()=>{
 const p=await plan();await db.exec('UPDATE rider_derived_abilities SET climbing=52');await assert.rejects(apply(p),/abilities changed/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM training_compensation_receipts')).rows[0].n,0);
});
test('existing injury and newer condition remain byte-for-byte unchanged',async()=>{
 await db.query("INSERT INTO rider_condition VALUES($1,67,49,'2026-10-05','race_crash',$2)",[rid,NOW]);const before=(await db.query('SELECT * FROM rider_condition')).rows;
 await apply(await plan());assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows,before);
});
test('hash mismatch, existing receipt and arbitrary fields reject with zero writes',async()=>{
 const p=await plan();await assert.rejects(apply(p,'0'.repeat(64)),/hash mismatch/);
 p.plans[0].patch.hidden_potential=99;await assert.rejects(apply(p),/Unsupported/);delete p.plans[0].patch.hidden_potential;
 await db.query('INSERT INTO training_rider_ticks VALUES($1,$2,24,$3)',[rid,season,'2026-10-02']);await assert.rejects(apply(await plan()),/already trained/);
 assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing,50);
});
test('late validation failure rolls the entire batch back',async()=>{
 await db.query('INSERT INTO training_condition_settlements VALUES($1)',[rid]);await assert.rejects(apply(await plan()),/applied history/);
 assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing,50);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM training_compensation_receipts')).rows[0].n,0);
});
test('late race evidence insert or changed manager plan rejects stale classification',async()=>{
 const p=await plan();await db.query('INSERT INTO training_race_loads VALUES($1)',[rid]);await assert.rejects(apply(p),/source changed/);
 assert.equal((await db.query('SELECT climbing FROM rider_derived_abilities')).rows[0].climbing,50);
 await db.exec('TRUNCATE training_race_loads');await db.query('INSERT INTO training_plans VALUES($1)',[team]);await assert.rejects(apply(p),/source changed/);
 await db.exec('TRUNCATE training_plans');
});
test('public roles cannot call writer; service role applies via invoker rights',async()=>{
 const p=await plan();await db.exec('SET ROLE authenticated');try{await assert.rejects(apply(p),/permission denied/);}finally{await db.exec('RESET ROLE');}
 await db.exec('SET ROLE service_role');try{assert.equal((await apply(p)).rider_days,1);}finally{await db.exec('RESET ROLE');}
});
test('normal historical retry cannot train a compensated slot again',async()=>{
 await apply(await plan());
 await assert.rejects(db.query('INSERT INTO training_rider_ticks VALUES($1,$2,24,$3)',[rid,season,'2026-10-02']),/compensated/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM training_rider_ticks')).rows[0].n,0);
});
