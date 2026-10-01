import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {buildRecoverySql} from '../../scripts/trainingRecovery5928.apply.mjs';
let db;
const team='00000000-0000-0000-0000-000000000001',rider='00000000-0000-0000-0000-000000000002',excluded='00000000-0000-0000-0000-000000000003',peer='00000000-0000-0000-0000-000000000004',season='00000000-0000-0000-0000-000000000005';
const date='2026-09-29',now='2026-09-30T08:00:00Z',days=[5,6,7,8,9],scope={riders:2,teams:1,eligible:1,excluded:1};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const opening=id=>({rider_id:id,form:50,fatigue:0,injured_until:null,injury_cause:null,injury_end_game_day:null,injury_season_id:null,injury_race_days_left:null});
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE app_config(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now());
  CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean DEFAULT false,primary_type text,secondary_type text,potentiale numeric,birthdate date,firstname text,lastname text,is_academy boolean DEFAULT false,squad text,peak_suggestions_dismissed_season_id uuid);
  CREATE TABLE teams(id uuid PRIMARY KEY,name text,user_id uuid,league_division_id integer,u23_league_division_id integer,junior_league_division_id integer);
  CREATE TABLE users(id uuid PRIMARY KEY,role text,is_beta_tester boolean);
  CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,league_division_id integer,race_type text);
  CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,game_day integer,scheduled_at timestamptz);
  CREATE TABLE race_results(rider_id uuid,race_id uuid,stage_number integer,result_type text);
  CREATE TABLE race_incidents(rider_id uuid,race_id uuid,stage_number integer,kind text,outcome text,injury_days integer);
  CREATE TABLE race_simulation_runs(id uuid PRIMARY KEY,race_id uuid,stage_number integer,seed bigint,engine_version integer,entrant_snapshot jsonb,input_checksum bigint,source text,salt_version text,UNIQUE(race_id,stage_number));
  CREATE TABLE race_simulation_rider_scores(run_id uuid,rider_id uuid,rank integer,components jsonb);
  CREATE TABLE race_entry_days(rider_id uuid,season_id uuid,game_day integer,race_id uuid);
  CREATE TABLE race_stage_profiles(race_id uuid,stage_number integer,profile_type text);
  CREATE TABLE rider_derived_abilities(rider_id uuid PRIMARY KEY,climbing integer,ability_progress jsonb);
  CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY,form smallint,fatigue smallint,injured_until date,injury_cause text,updated_at timestamptz,injury_end_game_day integer,injury_season_id uuid,injury_race_days_left integer);
  CREATE TABLE training_day_runs(team_id uuid,season_id uuid,squad text,game_day integer,tick_date date,executed_by text,bonus_applied boolean,report jsonb,UNIQUE(team_id,season_id,squad,game_day));
  CREATE TABLE rider_derived_ability_history(rider_id uuid,snapshot_date date,source text,season_number integer,abilities jsonb,created_at timestamptz DEFAULT now(),UNIQUE(rider_id,snapshot_date,source));
  CREATE TABLE rider_ability_race_day_history(rider_id uuid,season_id uuid,game_day integer,source text,season_number integer,snapshot_date date,abilities jsonb,UNIQUE(rider_id,season_id,game_day,source));
  CREATE TABLE rider_training_scores(rider_id uuid,team_id uuid,season_id uuid,tick_date date,game_day integer,score integer,session text,day_type text,was_race_day boolean,intention text,contributions jsonb);
  CREATE TABLE training_plans(rider_id uuid,team_id uuid,season_id uuid,focus text,intensity text,updated_at timestamptz);
  CREATE TABLE training_week_plans(team_id uuid,rider_id uuid,days jsonb,updated_at timestamptz);
  CREATE TABLE team_staff(id uuid,team_id uuid,role text,status text,fired_season integer,created_at timestamptz);
  CREATE TABLE staff_derived_abilities(staff_id uuid,updated_at timestamptz);
  CREATE TABLE team_facilities(id uuid,team_id uuid,track text,tier integer,updated_at timestamptz);
  CREATE TABLE finance_transactions(team_id uuid,idempotency_key text,created_at timestamptz);`);
  for(const file of ['2026-09-29-5928-training-condition-date.sql','2026-09-29-5928-training-condition-partial.sql'])await db.exec(await readFile(new URL('../../database/'+file,import.meta.url),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec('TRUNCATE riders,rider_condition,rider_derived_abilities,training_day_runs,training_rider_ticks,training_condition_settlements,training_date_work,training_condition_timeout_outbox,rider_training_scores,rider_derived_ability_history,rider_ability_race_day_history,training_plans,teams,app_config CASCADE');
  await db.query('INSERT INTO riders(id,team_id,is_retired) VALUES($1,$4,false),($2,$4,false),($3,$4,false)',[rider,excluded,peer,team]);
  await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}'),($2,40,'{}'),($3,55,'{}')",[rider,excluded,peer]);
  await db.query("INSERT INTO teams VALUES($1,'Test',NULL,1,NULL,NULL)",[team]);
  for(const key of ['training_condition_per_date','training_tick_per_race_day','race_day_engine_enabled','race_day_development_enabled','training_programs'])await db.query("INSERT INTO app_config(key,value,updated_at) VALUES($1,$2,'2026-09-29T18:00:00Z')",[key,JSON.stringify(key==='training_programs'?'off':'on')]);
  await db.query("INSERT INTO training_plans VALUES($1,$2,$3,'climbing','normal','2026-09-30T05:00:00Z')",[excluded,team,season]);
  const evidence=[rider,excluded].map(id=>({rider_id:id,reason:'unsafe_roster_or_missing_opening',condition_applied:false,opening_condition:null,current_condition:null}));
  await db.query("INSERT INTO training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,deadline_at,status,opening_conditions,quarantined_rider_ids,quarantine_evidence,missing_evidence,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'2026-09-29T20:00:00Z','needs_reconciliation',$6,$7,$8,$9,'2026-09-29T18:00:00Z','2026-09-29T19:00:00Z')",[team,season,date,days,[rider,excluded,peer],JSON.stringify({[peer]:opening(peer)}),[rider,excluded],JSON.stringify(evidence),JSON.stringify(evidence.map(({opening_condition:_openingCondition,current_condition:_currentCondition,...e})=>e))]);
  for(const day of days){const report={rider_id:peer,game_day:day,intensity:'normal',form:51,fatigue:5,missing_evidence:[]};
    await db.query("INSERT INTO training_rider_ticks VALUES($1,$2,$3,$4,$5,$6,'2026-09-29T19:00:00Z')",[peer,season,day,date,team,JSON.stringify(report)]);
    await db.query("INSERT INTO training_day_runs VALUES($1,$2,'senior',$3,$4,'assistant',false,$5)",[team,season,day,date,JSON.stringify({riders:[report],condition_per_date:true,complete:true,partial:false,condition_settled:day===9})]);
  }
  await db.query("INSERT INTO training_condition_settlements(rider_id,season_id,tick_date,team_id,status,missing_evidence) VALUES($1,$2,$3,$4,'complete','[]')",[peer,season,date,team]);
  await db.query("INSERT INTO training_condition_timeout_outbox(team_id,season_id,tick_date,payload,delivered_at,attempts,created_at,updated_at) VALUES($1,$2,$3,$4,'2026-09-29T21:00:00Z',1,'2026-09-29T19:00:00Z','2026-09-29T19:00:00Z')",[team,season,date,JSON.stringify({rider_ids:[rider,excluded],missing_evidence:evidence})]);
});
async function fixture(){
  const tables={};
  const names=['training_date_work','riders','rider_derived_abilities','training_plans','training_week_plans','team_facilities','team_staff','staff_derived_abilities','finance_transactions','app_config','teams','users','races','race_stage_schedule','race_results','race_stage_profiles','race_entry_days','race_simulation_runs','training_race_loads','rider_condition','training_day_runs','training_rider_ticks'];
  for(const name of names){let predicate='';if(name==='riders')predicate=` WHERE id IN('${rider}','${excluded}')`;if(name==='rider_derived_abilities')predicate=` WHERE rider_id IN('${rider}','${excluded}')`;if(name==='training_rider_ticks')predicate=' WHERE false';
    tables[name]=(await db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') AS rows FROM ${name} x${predicate}`)).rows[0].rows;}
  tables.app_config=tables.app_config.map(({key,value})=>({key,value}));
  const quarantineIds=tables.training_date_work[0].quarantined_rider_ids;
  const snapshot={tick_date:date,exported_at:now,season_number:4,manifest:{eligible:[rider],excluded:quarantineIds.filter(id=>id!==rider)},tables,evidence:quarantineIds.map(id=>({rider_id:id,condition_count:0,receipt_count:0,settlement_count:0,race_load_count:0,race_result_count:0,canonical_report_count:0,history_after_work_count:0}))};
  const final={...opening(rider),form:51,fatigue:5,updated_at:'2026-09-29T18:00:00Z'};
  const commits=days.map(day=>({p_team_id:team,p_season_id:season,p_squad:'senior',p_game_day:day,p_tick_date:date,p_date_game_days:days,p_executed_by:'assistant',p_report:{riders:[{rider_id:rider,game_day:day,intensity:'normal',condition_observed:opening(rider),missing_evidence:[],form:51,fatigue:5}],condition_per_date:true,condition_settled:day===9,tick_date:date,game_day:day},p_abilities:[{riderId:rider,patch:{climbing:50+day-4,ability_progress:{climbing:day/10}}}],p_conditions:day===9?[final]:[],p_history:[],p_race_history:[],p_scores:[{rider_id:rider,team_id:team,season_id:season,tick_date:date,game_day:day,score:1,session:'climbing',day_type:'train',was_race_day:false,intention:'training',contributions:{}}],p_race_loads:[]}));
  const body={tick_date:date,snapshot_sha256:hash(snapshot),manifest:snapshot.manifest,commits,riders:[{rider_id:rider,team_id:team,opening:opening(rider),condition_after:final}]};
  const proposal={...body,proposal_sha256:hash(body)};
  const outbox=(await db.query('SELECT jsonb_agg(to_jsonb(x)) AS rows FROM training_condition_timeout_outbox x')).rows[0].rows;
  const reports=(await db.query("SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id',team_id,'season_id',season_id,'game_day',game_day,'tick_date',tick_date,'report_header',report-'riders','report_md5',md5(report::text))),'[]') AS rows FROM training_day_runs")).rows[0].rows;
  const digest=(await db.query("SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY t.rider_id,t.game_day),'')) AS md5 FROM training_rider_ticks t WHERE rider_id<>$1",[rider])).rows[0].md5;
  const executionState={outbox,reports,peers:[{team_id:team,count:5,md5:digest}],existing_scores:0,existing_daily_history:0};
  return {snapshot,proposal,approvedHash:proposal.proposal_sha256,now,scope,executionState};
}
test('real atomic apply preserves peer and excluded riders; retry is a no-op and rollback restores the exact prior state',async()=>{
  await db.query("INSERT INTO rider_derived_ability_history VALUES($1,'2026-09-27','season_transition',4,'{}','2026-09-27T18:00:00Z')",[rider]);
  const f=await fixture();const before=(await db.query("SELECT jsonb_build_object('work',(SELECT jsonb_agg(to_jsonb(x)) FROM training_date_work x),'reports',(SELECT jsonb_agg(to_jsonb(x) ORDER BY game_day) FROM training_day_runs x),'outbox',(SELECT jsonb_agg(to_jsonb(x)) FROM training_condition_timeout_outbox x),'abilities',(SELECT jsonb_agg(to_jsonb(x) ORDER BY rider_id) FROM rider_derived_abilities x)) AS state")).rows[0].state;
  const sql=buildRecoverySql(f);await db.exec(sql);await db.exec(sql);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_rider_ticks')).rows[0].n,10);
  assert.deepEqual((await db.query('SELECT quarantined_rider_ids FROM training_date_work')).rows[0].quarantined_rider_ids,[excluded]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition WHERE rider_id=$1',[excluded])).rows[0].n,0);
  await db.exec(buildRecoverySql({...f,mode:'rollback'}));
  const after=(await db.query("SELECT jsonb_build_object('work',(SELECT jsonb_agg(to_jsonb(x)) FROM training_date_work x),'reports',(SELECT jsonb_agg(to_jsonb(x) ORDER BY game_day) FROM training_day_runs x),'outbox',(SELECT jsonb_agg(to_jsonb(x)) FROM training_condition_timeout_outbox x),'abilities',(SELECT jsonb_agg(to_jsonb(x) ORDER BY rider_id) FROM rider_derived_abilities x)) AS state")).rows[0].state;
  assert.deepEqual(after,before);assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_training_scores')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_derived_ability_history')).rows[0].n,1);
});
test('stale abilities or preexisting same-date history abort before any condition write',async()=>{
  const f=await fixture();await db.query('UPDATE rider_derived_abilities SET climbing=61 WHERE rider_id=$1',[rider]);
  await assert.rejects(db.exec(buildRecoverySql(f)),/snapshot changed/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
  await db.query('UPDATE rider_derived_abilities SET climbing=50 WHERE rider_id=$1',[rider]);
  await db.query("INSERT INTO rider_derived_ability_history VALUES($1,$2,'daily_training',4,'{}','2026-09-29T17:00:00Z')",[rider,date]);
  await assert.rejects(db.exec(buildRecoverySql(f)),/partial write evidence/);
});
test('rollback refuses an intervening teammate receipt change',async()=>{
  const f=await fixture();await db.exec(buildRecoverySql(f));
  await db.query("UPDATE training_rider_ticks SET report=report||'{\"new_external_field\":true}' WHERE rider_id=$1 AND game_day=5",[peer]);
  await assert.rejects(db.exec(buildRecoverySql({...f,mode:'rollback'})),/teammate receipts changed/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition WHERE rider_id=$1',[rider])).rows[0].n,1);
});
test('fully recovered team loses stale outbox and new canonical runs; rollback restores original absence',async()=>{
  await db.query("UPDATE training_date_work SET expected_rider_ids=ARRAY[$1::uuid],quarantined_rider_ids=ARRAY[$1::uuid],opening_conditions='{}',quarantine_evidence=(SELECT jsonb_agg(e) FROM jsonb_array_elements(quarantine_evidence)e WHERE e->>'rider_id'=$2),missing_evidence=(SELECT jsonb_agg(e) FROM jsonb_array_elements(missing_evidence)e WHERE e->>'rider_id'=$2)",[rider,rider]);
  await db.exec('DELETE FROM training_day_runs;DELETE FROM training_rider_ticks;DELETE FROM training_condition_settlements');
  const f=await fixture();f.scope={riders:1,teams:1,eligible:1,excluded:0};
  await db.exec(buildRecoverySql(f));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_condition_timeout_outbox')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_day_runs')).rows[0].n,5);
  await db.exec(buildRecoverySql({...f,mode:'rollback'}));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_day_runs')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM training_condition_timeout_outbox')).rows[0].n,1);
});
test('fresh global canonical evidence aborts; rollback refuses changed work and alarm metadata',async()=>{
  const f=await fixture();
  await db.query("INSERT INTO training_day_runs VALUES($1,$2,'senior',1,'2026-09-28','assistant',false,$3)",[excluded,season,JSON.stringify({riders:[{rider_id:rider}]})]);
  await assert.rejects(db.exec(buildRecoverySql(f)),/Canonical rider report/);
  await db.query('DELETE FROM training_day_runs WHERE team_id=$1',[excluded]);
  await db.exec(buildRecoverySql(f));
  await db.exec("UPDATE training_date_work SET missing_evidence=missing_evidence||'[{\"new_external_field\":true}]'");
  await assert.rejects(db.exec(buildRecoverySql({...f,mode:'rollback'})),/work state changed/);
});
test('rollback refuses changed recovery score and outbox delivery metadata',async()=>{
  const f=await fixture();await db.exec(buildRecoverySql(f));
  await db.exec('UPDATE rider_training_scores SET score=2 WHERE game_day=5');
  await assert.rejects(db.exec(buildRecoverySql({...f,mode:'rollback'})),/score content changed/);
  await db.exec('UPDATE rider_training_scores SET score=1 WHERE game_day=5;UPDATE training_condition_timeout_outbox SET attempts=attempts+1');
  await assert.rejects(db.exec(buildRecoverySql({...f,mode:'rollback'})),/outbox changed/);
});
test('compiler checks the Copenhagen recovery date and the immutable owner checksum',async()=>{
  const f=await fixture();
  assert.throws(()=>buildRecoverySql({...f,now:'2026-09-30T22:30:00Z'}),/recovery window/);
  assert.throws(()=>buildRecoverySql({...f,approvedHash:'not-approved'}),/checksum/);
});
function resign(f){
  f.proposal.snapshot_sha256=hash(f.snapshot);
  const {proposal_sha256:_previous,...body}=f.proposal;
  f.proposal.proposal_sha256=hash(body);f.approvedHash=f.proposal.proposal_sha256;return f;
}
test('compiler rejects SQL block delimiters in untrusted names and accepts ordinary apostrophes',async()=>{
  await db.query('UPDATE teams SET name=$1', ["untrusted $cz_recovery$; DELETE FROM riders;"]);
  const bad=await fixture();assert.throws(()=>buildRecoverySql(bad),/block delimiter/);
  await db.query('UPDATE teams SET name=$1',["O'Brien"]);
  const good=await fixture();await db.exec(buildRecoverySql(good));await db.exec(buildRecoverySql({...good,mode:'rollback'}));
  assert.equal((await db.query('SELECT name FROM teams')).rows[0].name,"O'Brien");
});
test('compiler rejects unsupported date axes and proposals with race loads',async()=>{
  const axis=await fixture();axis.snapshot.tables.training_date_work[0].game_days=[10,11,12,13,14];resign(axis);
  assert.throws(()=>buildRecoverySql(axis),/game-day axis/);
  const loads=await fixture();loads.proposal.commits[0].p_race_loads=[{rider_id:rider}];resign(loads);
  assert.throws(()=>buildRecoverySql(loads),/cannot own race loads/);
});
test('changes to unused roster metadata are preserved during apply and rollback',async()=>{
  const f=await fixture();
  await db.query("UPDATE riders SET squad='junior',peak_suggestions_dismissed_season_id=$1 WHERE id=$2",[season,rider]);
  await db.exec(buildRecoverySql(f));await db.exec(buildRecoverySql({...f,mode:'rollback'}));
  const current=(await db.query('SELECT squad,peak_suggestions_dismissed_season_id FROM riders WHERE id=$1',[rider])).rows[0];
  assert.deepEqual(current,{squad:'junior',peak_suggestions_dismissed_season_id:season});
});
test('changed training roster inputs and ownership still abort before writes',async()=>{
  const f=await fixture();
  for(const assignment of ["potentiale=91","team_id='00000000-0000-0000-0000-000000000099'","is_retired=true"]){
    await db.query(`UPDATE riders SET ${assignment} WHERE id=$1`,[rider]);
    await assert.rejects(db.exec(buildRecoverySql(f)),/snapshot changed: riders/);
    await db.query('UPDATE riders SET potentiale=NULL,team_id=$1,is_retired=false WHERE id=$2',[team,rider]);
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,0);
});
