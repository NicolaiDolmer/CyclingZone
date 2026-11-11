import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {prepareTacticsDatabase7864,tacticsId7864 as id} from './__fixtures__/tacticsStage7864Db.ts';
import {fillRaceTactics7864} from './raceTacticsBulk7864.js';
const teamId=id(1),raceId=id(2),rider=id(3),now=new Date('2026-11-11T10:00:00Z');
const plan=stage_number=>({stage_number,overrides:[],order:{breakaway_stance:'neutral',riders:[{rider_id:rider,effort:'normal',try_break:false,leadout:false,plan:[{task:'stay_sheltered'},{task:'ride_for_result',from:{at:'final_km'}}]}]}});

async function fixture(t,{flag='beta',beforeWrite=async()=>{}}={}){
 const db=new PGlite();t.after(()=>db.close());await prepareTacticsDatabase7864({exec:source=>db.exec(source)});
 await db.exec(`UPDATE races SET stages=6;
  INSERT INTO race_stage_profiles SELECT '${raceId}',n,160,'flat','[]','[]' FROM generate_series(4,6)n;
  INSERT INTO race_stage_schedule SELECT '${raceId}',n,'2026-11-12T10:00:00Z' FROM generate_series(4,6)n;`);
 const race={id:raceId,status:'scheduled',stages:6,stages_completed:0,engine_rules_revision:'s5_profiles_v3'};
 let writes=0,reads=0;
 const supabase={
  from(table){let key;const q={select:()=>q,eq:(column,value)=>{if(column==='key')key=value;else assert.ok(['team_id','race_id'].includes(column));return q;},
   maybeSingle:async()=>({data:{value:key==='tactics_ready_7864'?flag:'on'},error:null}),
   then(resolve,reject){assert.equal(table,'race_tactics_stage_state');return db.query('SELECT stage_number FROM race_tactics_stage_state WHERE team_id=$1 AND race_id=$2',[teamId,raceId]).then(r=>resolve({data:r.rows,error:null}),reject);}};return q;
  },
  async rpc(name,args){assert.equal(name,'save_race_tactics_7864');writes++;await beforeWrite(db,args);try{
   const result=await db.query('SELECT save_race_tactics_7864($1,$2,$3,$4::jsonb,$5::timestamptz) AS r',[args.p_team_id,args.p_race_id,args.p_mode,JSON.stringify(args.p_plans),args.p_now]);return {data:result.rows[0].r,error:null};
  }catch(error){return {data:null,error:{code:error.code,message:error.message}};}}
 };
 const loadContexts=async()=>{
  reads++;
  const entries=(await db.query('SELECT rider_id,race_role FROM race_entries')).rows;
  const overrides=(await db.query('SELECT stage_number,rider_id,race_role,effort FROM race_stage_roles')).rows;
  const profiles=(await db.query('SELECT stage_number,distance_km::float8 AS distance_km,profile_type,climbs,sprints FROM race_stage_profiles')).rows;
  const schedules=(await db.query('SELECT stage_number,scheduled_at FROM race_stage_schedule')).rows;
  const orders=(await db.query('SELECT * FROM race_team_orders')).rows;
  const rolesCtx={stage_count:6,stages_completed:0,teamRiderIds:new Set(entries.map(r=>r.rider_id)),baseRoleByRider:new Map(entries.map(r=>[r.rider_id,r.race_role])),abandonedRiderIds:new Set(),overrides};
  return {rolesCtx,ordersCtx:{...rolesCtx,race_completed:false,scheduleByStage:new Map(schedules.map(r=>[r.stage_number,r.scheduled_at])),orders},profiles,jerseyHunt:false};
 };
 const fill=(plans,opts={})=>fillRaceTactics7864({supabase,race,teamId,body:{source_stage:1,plans},isBetaTester:true,now,writeNow:now,loadContexts,...opts});
 return {db,fill,counts:()=>({writes,reads})};
}

test('complete fill orchestration combines applied, saved-empty and locked receipts against real SQL',async t=>{
 const {db,fill,counts}=await fixture(t);
 await db.query('INSERT INTO race_tactics_stage_state VALUES($1,$2,5,$3)',[teamId,raceId,now.toISOString()]);
 await db.exec("UPDATE race_stage_schedule SET scheduled_at='2026-11-11T09:00:00Z' WHERE stage_number=6");
 assert.deepEqual(await fill([plan(3),plan(5),plan(6)]),{applied:[3],preserved:[5],locked:[6]});
 assert.equal(counts().writes,1);assert.equal((await db.query('SELECT stage_number FROM race_team_orders')).rows[0].stage_number,3);
});
test('disabled or unrelated beta viewer fails before contexts and writes',async t=>{
 for(const [flag,isBetaTester] of [['off',true],['beta',false]]){
  const f=await fixture(t,{flag});await assert.rejects(f.fill([plan(3)],{isBetaTester}));assert.deepEqual(f.counts(),{writes:0,reads:0});
 }
});
test('invalid destination plan or different profile rejects the whole request before RPC',async t=>{
 const f=await fixture(t);
 const invalid=plan(6);invalid.order.breakaway_stance='invalid';
 await assert.rejects(f.fill([plan(3),invalid]));assert.equal(f.counts().writes,0);
 await f.db.exec("UPDATE race_stage_profiles SET profile_type='hilly' WHERE stage_number=6");
 await assert.rejects(f.fill([plan(3),plan(6)]));assert.equal(f.counts().writes,0);
 assert.equal((await f.db.query('SELECT * FROM race_team_orders')).rows.length,0);
});
test('manual save after context read is preserved by actual RPC, not reported applied',async t=>{
 const f=await fixture(t,{beforeWrite:async(db)=>{
  const manual={stage_number:6,expected_entries:[{rider_id:rider,race_role:'captain'}],expected_roles:[],order:{breakaway_stance:'let_go',riders:[]}};
  await db.query('SELECT save_race_tactics_7864($1,$2,$3,$4::jsonb,$5::timestamptz)',[teamId,raceId,'orders',JSON.stringify([manual]),now.toISOString()]);
 }});
 assert.deepEqual(await f.fill([plan(3),plan(6)]),{applied:[3],preserved:[6],locked:[]});
 assert.equal((await f.db.query('SELECT breakaway_stance FROM race_team_orders WHERE stage_number=6')).rows[0].breakaway_stance,'let_go');
});
