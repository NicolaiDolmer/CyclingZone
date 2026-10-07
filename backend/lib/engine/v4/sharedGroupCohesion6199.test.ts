import test from 'node:test';
import assert from 'node:assert/strict';
import { climbSelectionHook } from './mechanics/climbSelection.ts';
import { finaleHook } from './finale.ts';
import { initRiderStates } from './groups.ts';
import { makeHookCtx } from './testUtils/makeHookCtx.ts';
import { RACE_V4_TUNING } from './tuning.ts';
import type { AbilityKey, Entrant, EngineState, RaceGroup, RouteV2 } from './types.ts';
const keys:AbilityKey[]=['climbing','time_trial','flat','tempo','sprint','acceleration','punch','endurance','recovery','durability','descending','cobblestone','positioning','aggression','tactics'];
function fixture(){
 const entrants:Entrant[]=[90,50,20].map((value,i)=>({rider_id:'r'+i,abilities:Object.fromEntries(keys.map(k=>[k,value])) as Entrant['abilities'],role:'free_role',effort:'normal',condition:1}));
 const group:RaceGroup={id:'tail',kind:'gruppetto',rider_ids:entrants.map(e=>e.rider_id),gap_seconds:0,cohesion:1};
 const riders=initRiderStates(entrants,RACE_V4_TUNING,'6199-cohesion');for(const r of Object.values(riders)){r.wprime=1;r.wprimeMax=1;r.group_id='tail';}
 const state:EngineState={km:0,groups:[group],riders,virtual_gc:{}};
 const route:RouteV2={distance_km:10,profile_type:'mountain',finale_type:'long_climb',segments:[{kind:'climb',from_km:0,to_km:10,category:'1',avg_gradient:8,top_elevation_m:1000}],weather:{kind:'sun',wind_exposure:0},waypoints:[]};
 const tuning=structuredClone(RACE_V4_TUNING);tuning.selection.noiseSdBase=0;
 const ctx=makeHookCtx({segment:route.segments[0],route,entrants:Object.fromEntries(entrants.map(e=>[e.rider_id,e])),tuning,seed:'6199-cohesion'});
 return {state,ctx};
}

test('a heterogeneous grupetto that sustained the actual pace remains physically together',()=>{
 const {state,ctx}=fixture();
 const legacy=climbSelectionHook(state,ctx);assert.ok(legacy.state.groups.length>1,'fixture reaches the former relative-deficit split');
 const result=climbSelectionHook(state,{...ctx,sharedGroupTime:{entryGroups:state.groups}});
 assert.deepEqual(result.state.groups,state.groups);
});

test('a depleted weak rider can still detach from the shared-time grupetto',()=>{
 const {state,ctx}=fixture();state.riders.r2.wprime=0;
 const result=climbSelectionHook(state,{...ctx,sharedGroupTime:{entryGroups:state.groups}});
 assert.ok(result.state.groups.some(g=>g.id!=='tail'&&g.rider_ids.includes('r2')));
 assert.equal(new Set(result.state.groups.flatMap(g=>g.rider_ids)).size,3);
});

test('selective finale rank differences cannot invent time differences inside one physical arrival pool',()=>{
 const {state,ctx}=fixture();state.groups[0].kind='peloton';
 const out=finaleHook(state,{...ctx,sharedGroupTime:{entryGroups:state.groups}});
 assert.equal(new Set(out.state.groups.flatMap(g=>g.rider_ids.map(()=>g.gap_seconds))).size,1);
 assert.equal(out.state.finish_order?.length,3);
 assert.equal(out.events.some(e=>e.type==='finale_attack'&&e.params.kind==='placement_gap'),false);
});

test('a final classification window alone cannot swallow a physically separate group',()=>{
 const {state,ctx}=fixture();
 for(const e of Object.values(ctx.entrants))e.abilities=Object.fromEntries(keys.map(k=>[k,50])) as Entrant['abilities'];
 state.groups=[{id:'front',kind:'peloton',rider_ids:['r0'],gap_seconds:0,cohesion:1},{id:'near',kind:'chase',rider_ids:['r1','r2'],gap_seconds:1,cohesion:1}];
 const out=finaleHook(state,{...ctx,sharedGroupTime:{entryGroups:state.groups}});
 assert.ok(out.state.groups.some(g=>g.id==='near'&&g.rider_ids.includes('r1')&&g.rider_ids.includes('r2')&&g.gap_seconds>0),'positive separation remains unless real closure reaches contact');
});

test('finale travel estimate cannot close the same physical interval twice',()=>{
 const {state,ctx}=fixture();
 for(const [id,e]of Object.entries(ctx.entrants))e.abilities=Object.fromEntries(keys.map(k=>[k,id==='r0'?50:90])) as Entrant['abilities'];
 state.groups=[{id:'front',kind:'peloton',rider_ids:['r0'],gap_seconds:0,cohesion:1},{id:'near',kind:'chase',rider_ids:['r1','r2'],gap_seconds:10000,cohesion:1}];
 const shared={...ctx,sharedGroupTime:{entryGroups:state.groups}};
 const once=finaleHook(state,shared);
 const onceGap=once.state.groups.find(g=>g.id==='near')!.gap_seconds;
 assert.ok(onceGap<10000,'fixture exercises real physical closing');
 const twice=finaleHook({...state,groups:[state.groups[0],{...state.groups[1],gap_seconds:onceGap}]},shared);
 assert.equal(twice.state.groups.find(g=>g.id==='near')?.gap_seconds,onceGap,'the already-accounted movement is not charged again');
});
