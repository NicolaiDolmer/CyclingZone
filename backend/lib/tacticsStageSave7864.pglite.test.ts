import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {prepareTacticsDatabase7864} from './__fixtures__/tacticsStage7864Db.ts';

const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const team=id(1),race=id(2),rider=id(3),other=id(4);
const now='2026-11-11T10:00:00Z';
const entry={rider_id:rider,race_role:'captain'};
const role={rider_id:rider,race_role:'captain',effort:'normal'};
const profile={distance_km:160,profile_type:'flat',climbs:[],sprints:[]};
const order={breakaway_stance:'chase',riders:[{rider_id:rider,effort:'normal',try_break:false,leadout:false}]};
const candidate=(stage=1)=>({stage_number:stage,roles:[role],order,expected_roles:[],expected_entries:[entry],expected_profile:profile});

async function fixture(){
 const db=new PGlite();
 await prepareTacticsDatabase7864({exec:source=>db.exec(source)});
 const call=async(mode:string,plans:unknown[])=>{
  const result=await db.query<{receipt:Record<string,number[]>}>('SELECT public.save_race_tactics_7864($1,$2,$3,$4::jsonb,$5::timestamptz) AS receipt',[team,race,mode,JSON.stringify(plans),now]);
  return result.rows[0].receipt;
 };
 return {db,call};
}

test('fill preserves legacy orders, role rows and a deliberately empty role reset',async()=>{
 const {db,call}=await fixture();try{
  await call('roles',[{...candidate(1),roles:[]}]);
  await db.exec(`INSERT INTO race_team_orders(team_id,race_id,stage_number) VALUES('${team}','${race}',2);
  INSERT INTO race_stage_roles(race_id,stage_number,rider_id,race_role,effort) VALUES('${race}',3,'${rider}','helper','save');`);
  assert.deepEqual(await call('fill',[candidate(1),candidate(2),candidate(3)]),{applied:[],preserved:[1,2,3],locked:[]});
  assert.equal((await db.query('SELECT * FROM race_stage_roles WHERE stage_number=3')).rows[0].race_role,'helper');
 }finally{await db.close();}
});

test('fill commits roles and orders together with explicit timestamp; retry preserves saved plans',async()=>{
 const {db,call}=await fixture();try{
  assert.deepEqual(await call('fill',[candidate(2),candidate(1)]),{applied:[1,2],preserved:[],locked:[]});
  assert.equal((await db.query('SELECT * FROM race_stage_roles')).rows.length,2);
  assert.equal((await db.query('SELECT * FROM race_team_orders')).rows.length,2);
  assert.equal((await db.query<{stamp:string}>('SELECT updated_at::text AS stamp FROM race_tactics_stage_state LIMIT 1')).rows[0].stamp,'2026-11-11 10:00:00+00');
  assert.deepEqual(await call('fill',[candidate(1)]),{applied:[],preserved:[1],locked:[]});
 }finally{await db.close();}
});

test('role snapshot is compared at the write boundary; a stale save cannot delete the newer plan',async()=>{
 const {db,call}=await fixture();try{
  await call('roles',[candidate()]);
  await assert.rejects(call('roles',[{...candidate(),roles:[{...role,race_role:'helper'}]}]),/stage_roles_conflict/);
  assert.equal((await db.query('SELECT race_role FROM race_stage_roles')).rows[0].race_role,'captain');
 }finally{await db.close();}
});

test('a storage error on the second destination rolls back every role, order and marker',async()=>{
 const {db,call}=await fixture();try{
  await db.exec(`CREATE FUNCTION test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage_number=2 THEN RAISE EXCEPTION 'injected refusal'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER reject_second BEFORE INSERT ON race_team_orders FOR EACH ROW EXECUTE FUNCTION test_reject();`);
  await assert.rejects(call('fill',[candidate(1),candidate(2)]),/injected refusal/);
  for(const table of ['race_stage_roles','race_team_orders','race_tactics_stage_state'])assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length,0);
 }finally{await db.close();}
});

test('completion and scheduled start are checked again before writes',async()=>{
 const {db,call}=await fixture();try{
  await db.exec(`UPDATE race_stage_schedule SET scheduled_at='2026-11-11T09:59:00Z' WHERE stage_number=2; UPDATE races SET stages_completed=1;`);
  assert.deepEqual(await call('fill',[candidate(1),candidate(2),candidate(3)]),{applied:[3],preserved:[],locked:[1,2]});
  await db.exec("UPDATE races SET status='completed'");
  await assert.rejects(call('roles',[candidate(3)]),/stage_roles_stage_locked/);
 }finally{await db.close();}
});

test('changed destination route, roster and abandoned rider fail closed with no writes',async()=>{
 for(const mutation of ["UPDATE race_stage_profiles SET distance_km=180",`UPDATE race_entries SET race_role='helper'`,`INSERT INTO race_incidents VALUES('${race}','${rider}','abandon')`]){
  const {db,call}=await fixture();try{
   await db.exec(mutation);await assert.rejects(call('fill',[candidate()]),/tactics_context_changed/);
   assert.equal((await db.query('SELECT * FROM race_team_orders')).rows.length,0);
  }finally{await db.close();}
 }
});

test('RPC and stage marker are service-only even after default client grants',async()=>{
 const {db}=await fixture();try{
  for(const roleName of ['anon','authenticated']){
   await db.exec(`SET ROLE ${roleName}`);
   await assert.rejects(db.query('SELECT * FROM race_tactics_stage_state'),/permission denied/);
   await assert.rejects(db.query('SELECT save_race_tactics_7864($1,$2,$3,$4::jsonb,$5::timestamptz)',[team,race,'fill','[]',now]),/permission denied/);
   await db.exec('RESET ROLE');
  }
 }finally{await db.close();}
});
