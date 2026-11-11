import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as transport from './tacticsStageSave7864.ts';

const source=readFileSync(new URL('../routes/api.js',import.meta.url),'utf8');
const fixed='2026-11-11T10:00:00Z';
class FixedDate extends Date {constructor(value:string|number=fixed){super(value);}static now(){return Date.parse(fixed);}}
const routes=[['put','/races/:raceId/stage-roles'],['put','/races/:raceId/team-orders/:stageNumber'],['post','/races/:raceId/tactics-fill']] as const;

function fixture({stage='on',flagError=null,raceError=null,markerError=null,markerData=[],throwFlag=false,failure=null}:{stage?:unknown;flagError?:unknown;raceError?:unknown;markerError?:unknown;markerData?:unknown;throwFlag?:boolean;failure?:unknown}={}){
 const reads:string[]=[],captured:unknown[]=[],writes:string[]=[];
 const chain=(result:unknown,shouldThrow=false)=>({select(){return this;},eq(){return this;},async maybeSingle(){if(shouldThrow)throw new Error('read unavailable');return result;},then(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown){return Promise.resolve(result).then(resolve,reject);}});
 const race={id:'race',status:'scheduled',stages:1,stages_completed:0};
 const supabase={from(table:string){reads.push(table);return chain(table==='races'?{data:race,error:raceError}:table==='app_config'?{data:stage===undefined?null:{value:stage},error:flagError}:{data:markerData,error:markerError},table==='app_config'&&throwFlag);},async rpc(){writes.push('rpc');return {data:{applied:[1],preserved:[],locked:[]},error:null};}};
 const ctx={stage_count:1,stages_completed:0,race_completed:false,teamRiderIds:new Set(['rider']),baseRoleByRider:new Map([['rider','captain']]),abandonedRiderIds:new Set(),overrides:[],timeLockedStages:new Set(),stage_versions:{1:'empty'},scheduleByStage:new Map(),profileTypeByStage:new Map(),orders:[{stage_number:1,breakaway_stance:'neutral',riders:[]}],default_order:{breakaway_stance:'neutral',riders:[]}};
 const deps={...transport,supabase,Date:FixedDate,captureException:(e:unknown)=>captured.push(e),getStageRolesContext:async()=>ctx,getTeamOrdersContext:async()=>ctx,
  resolveWriteScope:()=>({ok:true,stages:[1],overrides:[]}),validateStageRoleOverrides:()=>({ok:true}),raceAllowsCoCaptain:()=>false,
  saveStageRoleOverrides:async()=>{writes.push('legacy-roles');},saveTeamOrder:async()=>{writes.push('legacy-orders');return ctx.default_order;},
  loadStageRoleRows:async()=>[],loadStageRoleByRider:async()=>ctx.baseRoleByRider,orderHasStagePlan:()=>false,stagePlanRevisionOk:()=>false,validateTeamOrder:()=>({ok:true}),normalizeTeamOrder:()=>ctx.default_order,
  isStageLocked:()=>false,sprintTrainFlatOnlyForRace:()=>false,VALID_EFFORTS_FIVE_STEP:['normal'],isViewerBetaTester:async()=>false,
  fillRaceTactics7864:async()=>{if(failure)throw failure;return {applied:[1],preserved:[],locked:[]};},
  ...(failure?{writeTacticsStages7864:async()=>{throw failure;}}:{}),
 };
 async function invoke(method:string,path:string){
  const start=source.indexOf(`router.${method}("${path}"`);assert.ok(start>=0);
  const callback=source.indexOf('async (req, res) => {',start),end=source.indexOf('\n});',callback);assert.ok(callback>start&&end>callback);
  // Execute the production callback with explicit dependencies and clock.
  const handler=new Function(...Object.keys(deps),`return (${source.slice(callback,end+2)});`)(...Object.values(deps));
  const response={statusCode:200,body:null as any,status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;}};
  await handler({team:{id:'team'},params:{raceId:'race',stageNumber:'1'},body:{overrides:[],stages:[1],base_versions:{1:'empty'}}},response);
  return response;
 }
 return {invoke,reads,captured,writes,ctx};
}

for(const [method,path] of routes.slice(0,2)){
 test(`${path}: OFF after migration uses legacy without marker lookup or RPC`,async()=>{
  for(const stage of [null,false,'off']){
   const f=fixture({stage});const response=await f.invoke(method,path);
   assert.equal(response.statusCode,200);assert.equal(f.writes.length,1);assert.match(f.writes[0],/^legacy-/);
   assert.equal(f.reads.includes('race_tactics_stage_state'),false);
  }
 });
 test(`${path}: beta/on uses shared atomic boundary even for a non-beta viewer`,async()=>{
  for(const stage of ['beta','on',true]){const f=fixture({stage});assert.equal((await f.invoke(method,path)).statusCode,200);assert.deepEqual(f.writes,['rpc']);}
 });
 test(`${path}: unknown write capability fails closed and is reported neutrally`,async()=>{
  const f=fixture({flagError:{code:'42501',message:'private database detail'}});const response=await f.invoke(method,path);
  assert.equal(response.statusCode,500);assert.equal(response.body.error,'tactics_save_failed');assert.deepEqual(f.writes,[]);assert.equal(f.captured.length,1);
 });
 test(`${path}: race read failures are also captured without leaking details`,async()=>{
  const error={message:'private race read detail'},f=fixture({raceError:error}),response=await f.invoke(method,path);
  assert.equal(response.statusCode,500);assert.equal(response.body.error,'tactics_save_failed');assert.deepEqual(f.captured,[error]);
 });
}
for(const [method,path] of routes){
 test(`${path}: all 5xx errors are captured and cannot leak or blame invalid input`,async()=>{
  for(const failure of [new transport.TacticsSaveError7864('private database detail',500),new transport.TacticsSaveError7864('private unavailable detail',503),new Error('private network detail')]){
   const f=fixture({failure});const response=await f.invoke(method,path);
   assert.equal(response.statusCode,failure instanceof transport.TacticsSaveError7864?failure.status:500);assert.deepEqual(response.body,{error:'tactics_save_failed',errors:['tactics_save_failed']});assert.deepEqual(f.captured,[failure]);
  }
 });
 test(`${path}: expected conflicts retain their code and do not create Sentry errors`,async()=>{
  const f=fixture({failure:new transport.TacticsSaveError7864('stage_roles_conflict',409)});const response=await f.invoke(method,path);
  assert.equal(response.statusCode,409);assert.equal(response.body.error,'stage_roles_conflict');assert.deepEqual(f.captured,[]);
 });
}
test('GET team-orders keeps existing orders/defaults when optional capability metadata fails',async()=>{
 for(const options of [{flagError:{message:'offline'}},{throwFlag:true},{stage:'invalid'},{markerError:{code:'42501',message:'denied'}},{markerData:[{stage_number:0}]}]){
  const f=fixture(options),response=await f.invoke('get','/races/:raceId/team-orders');
  assert.equal(response.statusCode,200);assert.equal(response.body.atomic_stage_save,false);assert.deepEqual(response.body.saved_stage_numbers,[]);
  assert.deepEqual(response.body.orders,f.ctx.orders);assert.deepEqual(response.body.default_order,f.ctx.default_order);
 }
});
