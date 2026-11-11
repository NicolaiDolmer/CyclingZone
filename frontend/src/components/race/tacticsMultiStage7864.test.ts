import test from 'node:test';
import assert from 'node:assert/strict';
import {multiStagePlans7864,readFillReceipt7864,confirmedFillStages7864,runStageFill7864,readStageRoles7864} from './tacticsMultiStage7864.ts';
import type {TeamPlanRider} from './tacticsReady7864.ts';

const riders:TeamPlanRider[]=[{rider_id:'a',role:'captain',routeMatch:70},{rider_id:'b',role:'helper',routeMatch:90},{rider_id:'out',role:'helper',routeMatch:99,abandoned:true}];
const profiles={1:{distance_km:150,profile_type:'mountain',climbs:[{crest_km:40,category:'3'},{crest_km:90,category:'1'},{crest_km:150,summit_finish:true}]},
 2:{distance_km:160,profile_type:'mountain',climbs:[{crest_km:110,category:'1'},{crest_km:160,summit_finish:true}]},
 3:{distance_km:130,profile_type:'flat',climbs:[]},4:{distance_km:140,profile_type:'mountain',climbs:[]},
 5:{distance_km:20,profile_type:'itt',climbs:[]},6:{distance_km:150,profile_type:'mountain',climbs:[]}};
const stages=Array.from({length:6},(_,i)=>({stage_number:i+1,locked:false}));
const orders=Object.fromEntries(stages.map(s=>[s.stage_number,{breakaway_stance:'neutral',riders:riders.map(r=>({rider_id:r.rider_id,effort:'normal'}))}]));
const args={sourceStage:1,kind:'stage' as const,stages,profiles,orders,ridersFor:()=>riders,savedStages:new Set<number>(),manualDraftStages:new Set<number>()};
test('malformed role readback cannot confirm a save or provide a new conflict version',()=>{
 const valid={riders:[{rider_id:'a',abandoned:false,race_role:'captain'}],overrides:[],stages_completed:0,stage_versions:{2:'version'}};
 assert.deepEqual(readStageRoles7864(valid),valid);
 for(const invalid of [null,{}, {...valid,riders:false},{...valid,overrides:[{stage_number:2,rider_id:'a'}]},{...valid,stage_versions:{2:17}}])assert.equal(readStageRoles7864(invalid),null);
});

test('same-type fill rebuilds the preset against each destination and excludes abandoned orders',()=>{
 const before=JSON.stringify({profiles,orders,riders});
 const results=multiStagePlans7864(args);
 assert.deepEqual(results.map(r=>r.stage),[2,4,6]);
 assert.deepEqual(results[0].plan.order.riders.find(r=>r.rider_id==='b')?.plan?.find(l=>l.task==='attack')?.from,{at:'kom',kom_index:0});
 assert.ok(results.every(r=>r.plan.order.riders.every(row=>row.rider_id!=='out')));
 assert.equal(JSON.stringify({profiles,orders,riders}),before);
});
test('saved stages, local manual drafts and locked stages are never replaced',()=>{
 assert.deepEqual(multiStagePlans7864({...args,savedStages:new Set([2]),manualDraftStages:new Set([4]),stages:stages.map(s=>({...s,locked:s.stage_number===6}))}),[]);
 assert.deepEqual(multiStagePlans7864({...args,sourceStage:5}),[]);
 assert.deepEqual(multiStagePlans7864({...args,profiles:{...profiles,2:{profile_type:'mountain'}}}).map(r=>r.stage),[4,6]);
});
test('per-destination rider fit chooses that stage leader rather than copying the source leader',()=>{
 const plans=multiStagePlans7864({...args,ridersFor:(stage:number)=>riders.map(r=>({...r,routeMatch:r.rider_id===(stage===2?'a':'b')?99:40}))});
 assert.equal(plans.find(p=>p.stage===2)?.plan.target?.rider_id,'a');
 assert.equal(plans.find(p=>p.stage===4)?.plan.target?.rider_id,'b');
});
test('only complete disjoint receipts are accepted, including retained exceptions',()=>{
 assert.deepEqual(readFillReceipt7864({applied:[2],preserved:[4],locked:[6]},[2,4,6]),{applied:[2],preserved:[4],locked:[6]});
 for(const value of [null,{}, {applied:[2],preserved:[],locked:[]},{applied:[2],preserved:[2],locked:[6]},{applied:[2,4,99],preserved:[],locked:[]}])assert.equal(readFillReceipt7864(value,[2,4,6]),null);
});
test('ambiguous writes are confirmed only from matching role AND order readback; foreign/locked drafts remain',()=>{
 assert.deepEqual(confirmedFillStages7864({stages:[2,4,6],receipt:null,readbackAvailable:true,rolesMatch:sn=>sn!==4,ordersMatch:sn=>sn!==6}),[2]);
 assert.deepEqual(confirmedFillStages7864({stages:[2,4,6],receipt:{applied:[2],preserved:[4],locked:[6]},readbackAvailable:true,rolesMatch:()=>true,ordersMatch:()=>true}),[2,4]);
 assert.deepEqual(confirmedFillStages7864({stages:[2,4],receipt:{applied:[2],preserved:[4],locked:[]},readbackAvailable:true,rolesMatch:()=>false,ordersMatch:()=>false}),[]);
 assert.deepEqual(confirmedFillStages7864({stages:[2,4],receipt:{applied:[2],preserved:[4],locked:[]},readbackAvailable:false,rolesMatch:()=>false,ordersMatch:()=>false}),[2]);
});
test('lost response is reconciled once; partial readback never marks a foreign plan saved',async()=>{
 let writes=0,reads=0;
 const result=await runStageFill7864({stages:[2,4],write:async()=>{writes++;throw new Error('network');},read:async()=>{reads++;return {same:[2]};},rolesMatch:(r,s)=>r.same.includes(s),ordersMatch:(r,s)=>r.same.includes(s)});
 assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(result.confirmed,[2]);assert.deepEqual(result.pending,[4]);
 const unavailable=await runStageFill7864({stages:[2,4],write:async()=>({applied:[2],preserved:[4],locked:[]}),read:async()=>null,rolesMatch:()=>true,ordersMatch:()=>true});
 assert.deepEqual(unavailable.confirmed,[2]);assert.deepEqual(unavailable.pending,[4]);
});
