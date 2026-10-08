import test from 'node:test';
import assert from 'node:assert/strict';
import { planSharedDescentTravel } from './sharedGroupTime.ts';
import type { Entrant, RaceGroup } from '../types.ts';
const group=(id:string,gap:number,origin?:RaceGroup['origin']):RaceGroup=>({id,kind:origin?'breakaway':'gruppetto',rider_ids:[id],gap_seconds:gap,cohesion:1,...(origin?{origin}:{})});
const entrants={front:{abilities:{descending:50}},tail:{abilities:{descending:50}},escape:{abilities:{descending:50}},incident:{abilities:{descending:50}}} as unknown as Record<string,Entrant>;
const base=()=>({groups:[group('front',0),group('tail',30)],durations:new Map([['front',100],['tail',400]]),minimumDurations:new Map([['front',50],['tail',50]]),entrants,lengthKm:10,technicality:1 as const,isFinish:false});

test('regrouping replaces overlapping descent travel rather than stacking a second full-descent estimate',()=>{
 const input=base(),out=planSharedDescentTravel(input);
 assert.equal(out.get('front'),100);
 assert.ok(out.get('tail')!<=100,'a nearby group can close on the same physical descent');
 assert.ok(out.get('tail')!>=50,'the existing physical speed ceiling still applies');
 assert.equal(input.durations.get('tail'),400,'input is immutable');
});

test('re-evaluating from the same summit does not spend the closing distance twice',()=>{
 const input=base(),first=planSharedDescentTravel(input);
 assert.deepEqual(planSharedDescentTravel({...input,durations:first}),first);
});

test('morning escape and incident chasers keep their separately owned travel',()=>{
 const input=base();input.groups=[group('escape',0,'breakaway'),group('front',60),group('incident',80),group('tail',90)];input.durations.set('escape',110);input.durations.set('incident',75);
 const out=planSharedDescentTravel({...input,incidentChasers:{incident:{}}});
 assert.equal(out.get('escape'),110);assert.equal(out.get('incident'),75);assert.equal(out.get('front'),100);
});

test('finish descent keeps the summit-based closure cap and cannot gain the same closure twice',()=>{
 const input=base();input.groups=[group('front',0),group('tail',100)];input.durations.set('tail',70);
 const out=planSharedDescentTravel({...input,isFinish:true});
 const finalGap=100+out.get('tail')!-out.get('front')!;
 assert.ok(finalGap>=50,'no more than half the summit gap closes');
 assert.ok(finalGap>=85,'same ten-km descent obeys the approved per-km limit');
});

test('large entry gaps can never turn regrouping into negative travel or teleportation',()=>{
 const input=base();input.groups=[group('front',0),group('tail',10000)];input.durations=new Map([['front',20],['tail',500]]);input.minimumDurations=new Map([['front',10],['tail',10]]);
 const out=planSharedDescentTravel(input);
 assert.ok(out.get('tail')!>=10);
});

import { descentHook } from './descent.ts';
import { RACE_V4_TUNING } from '../tuning.ts';
import { initRiderStates } from '../groups.ts';
import { makeHookCtx } from '../testUtils/makeHookCtx.ts';
import type { AbilityKey, EngineState, RouteV2 } from '../types.ts';

test('descent hook uses the real summit budget and never applies planned travel a second time',()=>{
 const keys:AbilityKey[]=['climbing','time_trial','flat','tempo','sprint','acceleration','punch','endurance','recovery','durability','descending','cobblestone','positioning','aggression','tactics'];
 const fullEntrants=Object.fromEntries(['front','tail'].map(rider_id=>[rider_id,{rider_id,abilities:Object.fromEntries(keys.map(k=>[k,50])) as Entrant['abilities'],effort:'grupetto' as const,role:'free_role' as const,condition:1}]));
 const route:RouteV2={distance_km:10,profile_type:'mountain',finale_type:'descent',segments:[{kind:'descent',from_km:0,to_km:10,technicality:1}],weather:{kind:'sun',wind_exposure:0},waypoints:[]};
 const state:EngineState={km:0,groups:[group('front',0),group('tail',90)],riders:initRiderStates(Object.values(fullEntrants),RACE_V4_TUNING,'6199-descent-book'),virtual_gc:{}};
 const ctx={...makeHookCtx({segment:route.segments[0],route,entrants:fullEntrants,tuning:RACE_V4_TUNING,seed:'6199-descent-book'}),sharedGroupTime:{entryGroups:[group('front',0),group('tail',100)]}};
 const out=descentHook(state,ctx);
 assert.equal(out.state.groups.find(g=>g.id==='tail')?.gap_seconds,90,'already-planned travel is not repeated by M3');
 assert.deepEqual(out.state.finish_descent_regroup?.tail,{topGapSeconds:100,closedSeconds:10});
});
