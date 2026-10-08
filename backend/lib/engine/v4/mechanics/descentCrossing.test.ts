import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDescentCrossings } from './descentCrossing.ts';
import { initRiderStates, mergeGroupsDetailed, applyGroupTimes } from '../groups.ts';
import { RACE_V4_TUNING } from '../tuning.ts';
import type { AbilityKey, Entrant, EngineState, RaceGroup, TimelineEvent } from '../types.ts';
const keys:AbilityKey[]=['climbing','time_trial','flat','tempo','sprint','acceleration','punch','endurance','recovery','durability','descending','cobblestone','positioning','aggression','tactics'];
const group=(id:string,gap:number,kind:RaceGroup['kind']='peloton',origin?:RaceGroup['origin'],size=3):RaceGroup=>({id,gap_seconds:gap,kind,cohesion:1,rider_ids:Array.from({length:size},(_,i)=>`${id}-${i}`),...(origin?{origin}:{})});
function stateFor(groups:RaceGroup[]):EngineState{
 const entrants:Entrant[]=groups.flatMap(g=>g.rider_ids).map(rider_id=>({rider_id,abilities:Object.fromEntries(keys.map(k=>[k,50])) as Entrant['abilities'],role:'free_role',effort:'normal',condition:1}));
 const riders=initRiderStates(entrants,RACE_V4_TUNING,'6327-pure');
 for(const g of groups)for(const id of g.rider_ids)riders[id].group_id=g.id;
 return {groups,riders,km:0,virtual_gc:{}};
}
const after=(before:RaceGroup[],gaps:Record<string,number>)=>before.map(g=>({...g,gap_seconds:gaps[g.id]??g.gap_seconds}));

test('nearest qualifying group catches; array order and renamed ids do not choose the largest tail',()=>{
 const before=[group('attack',10,'breakaway','descent'),group('near',20),group('large',100,'chase',undefined,30)];
 const state=stateFor(after(before,{attack:50,near:40,large:0}));
 const result=reconcileDescentCrossings(before,state,89);
 assert.equal(result.events[0].params.chase_group_id,'near');
 assert.deepEqual(reconcileDescentCrossings([...before].reverse(),{...state,groups:[...state.groups].reverse()},89),result);
 const renamed=(groups:RaceGroup[])=>groups.map(g=>({...g,id:`renamed-${g.id}`}));
 const renamedResult=reconcileDescentCrossings(renamed(before),{...state,groups:renamed(state.groups)},89);
 assert.equal(renamedResult.events[0].params.chase_group_id,'renamed-near');
});

test('two attacks join once each without additional rider work and repeat reconciliation is a no-op',()=>{
 const before=[group('a',10,'breakaway','descent'),group('b',15,'breakaway','descent'),group('field',20)];
 const state=stateFor(after(before,{a:40,b:50,field:30})),saved=structuredClone(state);
 const result=reconcileDescentCrossings(before,state,89);
 assert.deepEqual(state,saved);
 assert.equal(result.state.groups.length,1);assert.equal(result.state.groups[0].rider_ids.length,9);
 assert.equal(result.events.filter(e=>e.type==='breakaway_caught').length,2);
 for(const [id,rider]of Object.entries(result.state.riders)){assert.deepEqual({...rider,group_id:state.riders[id].group_id},state.riders[id]);}
 const repeated=reconcileDescentCrossings(before,result.state,89);
 assert.equal(repeated.state,result.state);assert.deepEqual(repeated.events,[]);
});

test('morning escapees, an attack still ahead, and new passive splits remain untouched',()=>{
 const morning=[group('morning',10,'breakaway','breakaway'),group('field',20)];
 const morningState=stateFor(after(morning,{morning:40,field:30}));
 assert.equal(reconcileDescentCrossings(morning,morningState,89).state,morningState);
 const before=[group('morning',0,'breakaway','breakaway'),group('attack',10,'breakaway','descent'),group('field',20)];
 const ahead=stateFor(after(before,{attack:15,field:30}));assert.equal(reconcileDescentCrossings(before,ahead,89).state,ahead);
 const split=stateFor([...before,group('new-split',40,'solo','descent',1)]);
 assert.equal(reconcileDescentCrossings(before,split,89).state,split);
});

test('solo descent attack can be caught and a solo catcher becomes an ordinary chase group',()=>{
 const before=[group('attack',10,'solo','descent',1),group('catcher',20,'solo',undefined,1)];
 const result=reconcileDescentCrossings(before,stateFor(after(before,{attack:40,catcher:30})),89);
 assert.equal(result.state.groups[0].kind,'chase');assert.equal(result.state.groups[0].origin,undefined);
 assert.equal(result.state.groups[0].rider_ids.length,2);
});

test('e14 later incident merge keeps absorbed attack ids gone and one actual caught event',()=>{
 const before=[group('attack',204.59,'breakaway','descent',4),group('field',224.59)];
 const first=reconcileDescentCrossings(before,stateFor(after(before,{attack:243.29,field:203.74})),89);
 const field=first.state.groups[0],moved=field.rider_ids[0];
 const split=[{...field,rider_ids:field.rider_ids.filter(id=>id!==moved)},{...group('incident',field.gap_seconds+1,'solo',undefined,1),rider_ids:[moved]}];
 const merged=mergeGroupsDetailed(split,2),later={...first.state,groups:merged.groups};
 const settled=reconcileDescentCrossings(first.state.groups,later,101.2);
 assert.deepEqual(settled.events,[]);assert.equal(settled.state.groups.some(g=>g.id==='attack'),false);
 assert.equal(new Set(settled.state.groups.flatMap(g=>g.rider_ids)).size,7);
 const times=applyGroupTimes(settled.state.groups,settled.state.riders,1000);
 assert.equal(times['attack-0'].time_seconds,times['field-0'].time_seconds);
});

test('a catch already emitted by M5 is not duplicated or attributed to a different passing group',()=>{
 const before=[group('attack',10,'breakaway','descent'),group('near',20),group('actual',30)];
 const state=stateFor(after(before,{attack:5,near:0,actual:5}));
 const recorded:TimelineEvent[]=[{km:89,type:'breakaway_caught',params:{group_id:'attack',chase_group_id:'actual'}}];
 const result=reconcileDescentCrossings(before,state,89,recorded);
 assert.equal(result.events.filter(e=>e.type==='breakaway_caught').length,0);
 assert.equal(result.events.find(e=>e.type==='group_merged')?.params.into_group_id,'actual');
});

test('M5-proven contact inside merge distance keeps an ordinary catcher and common front time',()=>{
 const before=[group('attack',10,'breakaway','descent',4),group('catcher',30,'chase',undefined,1)];
 const state=stateFor(after(before,{attack:15,catcher:16}));
 const recorded:TimelineEvent[]=[{km:89,type:'breakaway_caught',params:{group_id:'attack',chase_group_id:'catcher'}}];
 const result=reconcileDescentCrossings(before,state,89,recorded);
 assert.equal(result.state.groups.length,1);
 assert.equal(result.state.groups[0].id,'catcher');assert.equal(result.state.groups[0].kind,'chase');
 assert.equal(result.state.groups[0].gap_seconds,15);
 assert.equal(result.events.filter(e=>e.type==='breakaway_caught').length,0);
});
