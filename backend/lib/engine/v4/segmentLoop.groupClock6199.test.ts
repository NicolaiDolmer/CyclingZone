import test from 'node:test';
import assert from 'node:assert/strict';
import { runSegmentLoop, DEFAULT_MECHANIC_HOOKS } from './segmentLoop.ts';
import { RACE_V4_TUNING, BREAKAWAY_EXTRA_TUNING } from './tuning.ts';
import type { AbilityKey, Entrant, MechanicHooks, RulesRevision, StageInput } from './types.ts';
const keys:AbilityKey[]=['climbing','time_trial','flat','tempo','sprint','acceleration','punch','endurance','recovery','durability','descending','cobblestone','positioning','aggression','tactics'];
const entrants:Entrant[]=['a','b'].map(rider_id=>({rider_id,abilities:Object.fromEntries(keys.map(k=>[k,50])) as Entrant['abilities'],role:'free_role',effort:'normal',condition:1}));
const input=(rules_revision:RulesRevision):StageInput=>({route:{distance_km:10,profile_type:'flat',finale_type:'bunch_sprint',segments:[{kind:'flat',from_km:0,to_km:10}],weather:{kind:'sun',wind_exposure:0},waypoints:[]},startlist:entrants,orders:[],seed:'6199-reference',rules_revision,tuning:RACE_V4_TUNING});
function run(revision:RulesRevision,advance:number){
 const hooks:MechanicHooks={...DEFAULT_MECHANIC_HOOKS,finale:state=>({state:{...state,groups:[{id:'a',kind:'chase',rider_ids:['a'],gap_seconds:0,cohesion:1},{id:'b',kind:'chase',rider_ids:['b'],gap_seconds:-advance,cohesion:1}]},events:[]})};
 return runSegmentLoop(input(revision),hooks);
}

test('new revision: advancing one group must not delay an unrelated group when reference changes',()=>{
 const before=run('official_times_v1',0),after=run('official_times_v1',30);
 assert.equal(after.state.riders.a.time_seconds,before.state.riders.a.time_seconds);
 assert.equal(after.state.riders.b.time_seconds,before.state.riders.b.time_seconds-30);
});

test('existing revisions preserve their historic reference behavior',()=>{
 for(const revision of ['legacy','orders_gc_v1','orders_gc_v2','orders_gc_v3'] as const){
  const before=run(revision,0),after=run(revision,30);
  assert.equal(after.state.riders.b.time_seconds,before.state.riders.b.time_seconds);
  assert.equal(after.state.riders.a.time_seconds,before.state.riders.a.time_seconds+30);
 }
});

test('each mechanism receives a normalized reference without losing the preceding advance',()=>{
 const routeInput=input('official_times_v1');
 routeInput.route.segments=[{kind:'descent',from_km:0,to_km:10,technicality:1}];
 let observed=false;
 const hooks:MechanicHooks={...DEFAULT_MECHANIC_HOOKS,
  descent:state=>({state:{...state,groups:[{id:'a',kind:'chase',rider_ids:['a'],gap_seconds:0,cohesion:1},{id:'b',kind:'solo',rider_ids:['b'],gap_seconds:-30,cohesion:1}]},events:[]}),
  breakaway:state=>{observed=state.groups.find(g=>g.id==='b')?.gap_seconds===0&&state.groups.find(g=>g.id==='a')?.gap_seconds===30;return {state,events:[]}},
 };
 runSegmentLoop(routeInput,hooks);
 assert.equal(observed,true,'the movement reference must be committed before the next mechanic');
});

import { breakawayHook } from './mechanics/breakaway.ts';
import { initRiderStates } from './groups.ts';
import { makeHookCtx } from './testUtils/makeHookCtx.ts';
import type { EngineState, RouteV2 } from './types.ts';

test('pursuit exposes its signed advance to the shared clock instead of hiding it in a local rebase',()=>{
 const route:RouteV2={...input('official_times_v1').route,distance_km:200,segments:[{kind:'flat',from_km:0,to_km:10},{kind:'flat',from_km:10,to_km:20},{kind:'flat',from_km:20,to_km:200}]};
 const members=Array.from({length:BREAKAWAY_EXTRA_TUNING.letGoMinChaseRiders+2},(_,i)=>({...entrants[0],rider_id:'r'+i,team_id:i<2?'escape':'field'}));
 const riders=initRiderStates(members,RACE_V4_TUNING,'6199-pursuit');
 const groups=[{id:'escape',kind:'breakaway' as const,origin:'breakaway' as const,rider_ids:['r0','r1'],gap_seconds:0,cohesion:1},{id:'field',kind:'peloton' as const,rider_ids:members.slice(2).map(r=>r.rider_id),gap_seconds:60,cohesion:1}];
 const state:EngineState={km:10,groups,riders,virtual_gc:{}};
 const ctx=makeHookCtx({segment:route.segments[1],segmentIndex:1,route,entrants:Object.fromEntries(members.map(r=>[r.rider_id,r])),tuning:RACE_V4_TUNING,seed:'6199-pursuit',orders:[{team_id:'field',kind:'team_tactics',params:{breakaway_stance:'let_go',riders:[]}}]});
 const v2ctx={...ctx,rulesRevision:'orders_gc_v1' as const};
 const before=breakawayHook(state,v2ctx),after=breakawayHook(state,{...v2ctx,sharedGroupTime:true});
 const shift=Math.min(...after.state.groups.map(g=>g.gap_seconds));
 assert.ok(shift<0,'the actual let-go gain must remain visible to the absolute clock');
 assert.deepEqual(after.state.groups.map(g=>[g.id,g.gap_seconds-shift]),before.state.groups.map(g=>[g.id,g.gap_seconds]));
});

test('shared clock does not let an ordinary group pass through a morning escape without physical contact',()=>{
 const routeInput=input('official_times_v1');
 routeInput.route={...routeInput.route,distance_km:21,segments:[{kind:'flat',from_km:0,to_km:1},{kind:'descent',from_km:1,to_km:21,technicality:1}]};
 routeInput.startlist=entrants.map((r,i)=>({...r,abilities:Object.fromEntries(keys.map(k=>[k,i?90:10])) as Entrant['abilities']}));
 const hooks:MechanicHooks={...DEFAULT_MECHANIC_HOOKS,breakaway:(state,ctx)=>({state:ctx.segmentIndex===0?{...state,groups:[{id:'escape',kind:'breakaway',origin:'breakaway',rider_ids:['a'],gap_seconds:0,cohesion:1},{id:'field',kind:'peloton',rider_ids:['b'],gap_seconds:20,cohesion:1}]}:state,events:[]})};
 const out=runSegmentLoop(routeInput,hooks);
 assert.equal(out.state.groups.length,1,'physical overtaking must join the groups, not leave an escape behind the field');
 assert.equal(out.state.riders.a.time_seconds,out.state.riders.b.time_seconds);
 assert.equal(out.timeline.filter(e=>e.type==='breakaway_caught'&&e.params.group_id==='escape'&&e.params.chase_group_id==='field').length,1);
});
