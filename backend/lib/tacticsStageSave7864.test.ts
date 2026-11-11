import test from 'node:test';
import assert from 'node:assert/strict';
import {writeTacticsStages7864,loadTacticsStageCapability7864} from './tacticsStageSave7864.ts';

const now=new Date('2026-11-11T10:00:00Z');
const plan={stage_number:2,expected_entries:[],expected_roles:[],roles:[]};
test('atomic writer sends explicit time and accepts only a complete disjoint receipt',async()=>{
 let sent:unknown;
 const supabase={rpc:async(name:string,args:unknown)=>{assert.equal(name,'save_race_tactics_7864');sent=args;return {data:{applied:[2],preserved:[],locked:[]},error:null};}};
 assert.deepEqual(await writeTacticsStages7864({supabase,teamId:'t',raceId:'r',mode:'roles',plans:[plan],now}),{applied:[2],preserved:[],locked:[]});
 assert.equal((sent as {p_now:string}).p_now,now.toISOString());
 for(const receipt of [null,{}, {applied:[],preserved:[],locked:[]},{applied:[2],preserved:[2],locked:[]},{applied:[99],preserved:[],locked:[]}]){
  await assert.rejects(writeTacticsStages7864({supabase:{rpc:async()=>({data:receipt,error:null})},teamId:'t',raceId:'r',mode:'fill',plans:[plan],now}),/tactics_save_failed/);
 }
});
test('atomic RPC errors never fall back to legacy writes',async()=>{
 for(const error of [{code:'PGRST202',message:'missing RPC'},{code:'42501',message:'denied'},{code:'P0001',message:'stage_roles_conflict'}]){
  await assert.rejects(writeTacticsStages7864({supabase:{rpc:async()=>({data:null,error})},teamId:'t',raceId:'r',mode:'roles',plans:[plan],now}));
 }
});
test('missing marker table permits compatibility only with a successfully read OFF configuration',async()=>{
 function client(value:unknown,flagError:unknown=null){return {from:(table:string)=>{
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:value===undefined?null:{value},error:flagError}),then:(resolve:(v:unknown)=>void)=>resolve({data:null,error:{code:'PGRST205',message:'missing table'}})};
  assert.ok(['app_config','race_tactics_stage_state'].includes(table));return chain;
 }};}
 assert.deepEqual(await loadTacticsStageCapability7864({supabase:client(undefined),teamId:'t',raceId:'r'}),{available:false,savedStages:[],stage:'off'});
 for(const value of ['on','beta','invalid'])await assert.rejects(loadTacticsStageCapability7864({supabase:client(value),teamId:'t',raceId:'r'}));
 await assert.rejects(loadTacticsStageCapability7864({supabase:client('off',{message:'network error'}),teamId:'t',raceId:'r'}));
});
