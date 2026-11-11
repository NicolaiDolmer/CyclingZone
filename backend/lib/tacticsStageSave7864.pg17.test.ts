import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareTacticsDatabase7864,tacticsId7864 as id} from './__fixtures__/tacticsStage7864Db.ts';

const PG=process.env.TACTICS_PG_BIN;
const team=id(1),race=id(2),rider=id(3),now='2026-11-11T10:00:00Z';
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
const entry={rider_id:rider,race_role:'captain'};
const role={rider_id:rider,race_role:'captain',effort:'normal'};
const plan=(stage=1)=>({stage_number:stage,expected_entries:[entry],expected_roles:[],roles:[role],order:{breakaway_stance:'chase',riders:[]},expected_profile:{distance_km:160,profile_type:'flat',climbs:[],sprints:[]}});
const call=(mode:string,plans:unknown[])=>`public.save_race_tactics_7864('${team}','${race}',${quote(mode)},${quote(JSON.stringify(plans))}::jsonb,'${now}')`;

test('PG17 tactics: shared locks serialize manual and batch saves without loss or deadlocks',{skip:!PG&&'TACTICS_PG_BIN not set',timeout:120000},async()=>{
 const bin=PG as string;
 const run=(name:string,args:string[],input?:string)=>spawnSync(join(bin,name),args,{input,encoding:'utf8',windowsHide:true,timeout:30000});
 function checked(name:string,args:string[],input?:string){const r=run(name,args,input);assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;}
 const version=checked('psql',['--version']).trim();assert.match(version,/PostgreSQL\) 17\./);
 const scratch=await mkdtemp(join(tmpdir(),'tactics-7864-pg17-')),data=join(scratch,'data'),port='58465';
 const args=['-X','-q','-t','-A','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
 const sql=(source:string)=>checked('psql',args,`SET statement_timeout='10s';${source}`);
 const one=(source:string)=>JSON.parse(sql(`SELECT ${source};`).trim());
 const reset=()=>sql('TRUNCATE race_tactics_stage_state,race_stage_roles,race_team_orders;');
 const concurrent=(source:string)=>new Promise<unknown>((resolve,reject)=>{
  const child=spawn(join(bin,'psql'),args,{windowsHide:true});let stdout='',stderr='';
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
  child.on('close',code=>{if(code!==0)reject(new Error(stderr));else{try{resolve(JSON.parse(stdout.trim()));}catch(error){reject(error);}}});
  child.stdin.end(`SET statement_timeout='10s'; SELECT ${source};`);
 });
 let started=false;
 try{
  checked('initdb',['-D',data,'-U','postgres','-A','trust','-E','UTF8','--locale=C']);
  const start=spawnSync(join(bin,'pg_ctl'),['-D',data,'-o',`-h 127.0.0.1 -p ${port}`,'-l',join(scratch,'pg.log'),'-w','start'],{windowsHide:true,stdio:'ignore',timeout:30000});assert.equal(start.status,0);started=true;
  await prepareTacticsDatabase7864({exec:async source=>sql(source)});
  sql(`CREATE FUNCTION test_attempt(p_statement text) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE result jsonb; BEGIN EXECUTE p_statement INTO result; RETURN result;
   EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'stage_roles_conflict' THEN RAISE; END IF; RETURN '{"conflict":true}'::jsonb; END; $$;`);
  const manual={...plan(),roles:[{...role,race_role:'helper'}]};
  assert.deepEqual(one(call('roles',[manual])),{applied:[1],preserved:[],locked:[]});
  assert.deepEqual(one(call('fill',[plan()])),{applied:[],preserved:[1],locked:[]});
  assert.equal(sql('SELECT race_role FROM race_stage_roles;').trim(),'helper');
  reset();one(call('roles',[{...plan(),roles:[]}])) ;assert.deepEqual(one(call('fill',[plan()])),{applied:[],preserved:[1],locked:[]});
  reset();one(call('fill',[plan()]));
  assert.deepEqual(one(`test_attempt(${quote('SELECT '+call('roles',[manual]))})`),{conflict:true});
  one(call('orders',[{...plan(),expected_roles:[role],order:{breakaway_stance:'let_go',riders:[]}}]));
  assert.equal(sql('SELECT breakaway_stance FROM race_team_orders;').trim(),'let_go');
  const manualOrder={...plan(),order:{breakaway_stance:'let_go',riders:[]}};
  reset();one(call('orders',[manualOrder]));
  assert.deepEqual(one(call('fill',[plan()])),{applied:[],preserved:[1],locked:[]});
  assert.equal(sql('SELECT breakaway_stance FROM race_team_orders;').trim(),'let_go');
  let attempts=0;
  for(let n=0;n<16;n++){
   reset();const [a,b]=await Promise.all([concurrent(`test_attempt(${quote('SELECT '+call('roles',[manual]))})`),concurrent(call('fill',[plan()]))]);attempts+=2;
   const current=sql('SELECT race_role FROM race_stage_roles;').trim();
   if(current==='helper'){assert.deepEqual(a,{applied:[1],preserved:[],locked:[]});assert.deepEqual(b,{applied:[],preserved:[1],locked:[]});}
   else{assert.equal(current,'captain');assert.deepEqual(a,{conflict:true});assert.deepEqual(b,{applied:[1],preserved:[],locked:[]});}
  }
  for(let n=0;n<8;n++){
   reset();const results=await Promise.all([concurrent(call('fill',[plan(2),plan(1)])),concurrent(call('fill',[plan(1),plan(2)]))]);attempts+=2;
   assert.equal(results.filter(r=>(r as {applied:number[]}).applied.length===2).length,1);
   assert.equal(sql('SELECT count(*) FROM race_team_orders;').trim(),'2');
  }
  for(let n=0;n<16;n++){
   reset();const [manualResult,fillResult]=await Promise.all([concurrent(`test_attempt(${quote('SELECT '+call('orders',[manualOrder]))})`),concurrent(call('fill',[plan()]))]);attempts+=2;
   const stance=sql('SELECT breakaway_stance FROM race_team_orders;').trim();
   if(stance==='let_go'){
    assert.deepEqual(manualResult,{applied:[1],preserved:[],locked:[]});assert.deepEqual(fillResult,{applied:[],preserved:[1],locked:[]});
    assert.equal(sql('SELECT count(*) FROM race_stage_roles;').trim(),'0');
   }else{
    assert.equal(stance,'chase');assert.deepEqual(manualResult,{conflict:true});assert.deepEqual(fillResult,{applied:[1],preserved:[],locked:[]});
   }
  }
  reset();sql('SET ROLE service_role; SELECT '+call('fill',[plan()])+'; RESET ROLE;');
  for(const roleName of ['anon','authenticated']){
   assert.notEqual(run('psql',args,`SET ROLE ${roleName}; SELECT * FROM race_tactics_stage_state;`).status,0);
   assert.notEqual(run('psql',args,`SET ROLE ${roleName}; SELECT ${call('fill',[plan()])};`).status,0);
  }
  console.log(JSON.stringify({version,concurrentAttempts:attempts,deterministicOrderings:5,serviceAndClientAcl:true,noDeadlocks:true}));
 }finally{
  if(started){checked('pg_ctl',['-D',data,'-m','fast','-w','stop']);assert.equal(run('pg_ctl',['-D',data,'status']).status,3);console.log('Local PG17 positively stopped (status=3).');}
 }
});
