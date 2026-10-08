import test from 'node:test';
import assert from 'node:assert/strict';
import { settleBreakawaySurvivedEvents } from './groups.ts';
import type { RaceGroup, StageResult, TimelineEvent } from './types.ts';
const groups:RaceGroup[]=[
 {id:'morning',kind:'breakaway',origin:'breakaway',rider_ids:['m'],gap_seconds:0,cohesion:1},
 {id:'descent',kind:'breakaway',origin:'descent',rider_ids:['a'],gap_seconds:20,cohesion:1},
 {id:'field',kind:'peloton',rider_ids:['p'],gap_seconds:40,cohesion:1},
];
const survived:TimelineEvent={km:175,type:'breakaway_survived',params:{group_id:'descent',rider_ids:['a']}};
const result=(rider_id:string,rank:number):StageResult=>({rider_id,rank,time_seconds:100+rank,group_id:rider_id,status:'finished',injury_days:0});
const args=(overtaken=false)=>({breakawayWin:true,trace:{entryGroups:groups,preFinaleGroups:groups,postFinaleGroups:groups},
 results:[result('m',1),result(overtaken?'p':'a',2),result(overtaken?'a':'p',3)]});
const physical=(overtaken=false)=>({...args(overtaken),physicalDescentOutcomes:true});

test('legacy finish projection remains unchanged without the future capability',()=>{
 assert.equal(settleBreakawaySurvivedEvents([survived],args())[0].type,'breakaway_caught');
});
test('descent attack ahead of the field survives even when the morning escape wins',()=>{
 assert.deepEqual(settleBreakawaySurvivedEvents([survived],physical()),[survived]);
});
test('finishing behind alone never invents an actorless descent catch',()=>{
 assert.deepEqual(settleBreakawaySurvivedEvents([survived],physical(true)),[]);
});
test('a physical catch supersedes stale M5 survived without a second actorless event',()=>{
 const caught:TimelineEvent={km:175,type:'breakaway_caught',params:{group_id:'descent',rider_ids:['a'],chase_group_id:'field'}};
 const input={...physical(true),trace:{entryGroups:groups,preFinaleGroups:groups.filter(g=>g.id!=='descent'),postFinaleGroups:groups.filter(g=>g.id!=='descent')}};
 assert.deepEqual(settleBreakawaySurvivedEvents([survived,caught],input),[caught]);
});

test('a descent attacker winning a shared finale sprint has not survived separately',()=>{
 const input={...physical(),trace:{entryGroups:groups,preFinaleGroups:groups,postFinaleGroups:[groups[0],{id:'finale-bunch-0',kind:'peloton' as const,rider_ids:['a','p'],gap_seconds:40,cohesion:1}]},results:[result('m',1),result('a',2),result('p',3)]};
 assert.deepEqual(settleBreakawaySurvivedEvents([survived],input),[]);
});

test('a last-segment descent attack keeps its provenance after its group fully splits',()=>{
 const attack:TimelineEvent={km:170,type:'finale_attack',params:{direction:'descent',group_id:'last-descent',rider_ids:['a']}};
 const stale:TimelineEvent={...survived,params:{group_id:'last-descent',rider_ids:['a']}};
 const entry:RaceGroup={id:'field',kind:'peloton',rider_ids:['a','p'],gap_seconds:0,cohesion:1};
 const split:RaceGroup[]=[{...entry,rider_ids:['p']},{id:'incident-solo',kind:'solo',origin:'descent',rider_ids:['a'],gap_seconds:20,cohesion:1}];
 const input={breakawayWin:false,physicalDescentOutcomes:true,trace:{entryGroups:[entry],preFinaleGroups:split,postFinaleGroups:split},results:[result('p',1),result('a',2)]};
 assert.deepEqual(settleBreakawaySurvivedEvents([attack,stale],input),[attack]);
});

test('a selective finale shared pool does not become survival when finish tiers split again',()=>{
 const input={...physical(),trace:{entryGroups:groups,preFinaleGroups:groups,postFinaleGroups:[groups[0],{id:'finale-winner-0',kind:'solo' as const,rider_ids:['a'],gap_seconds:40,cohesion:1},{id:'finale-tier-1',kind:'chase' as const,rider_ids:['p'],gap_seconds:41,cohesion:1}]},results:[result('m',1),result('a',2),result('p',3)]};
 assert.deepEqual(settleBreakawaySurvivedEvents([survived],input),[]);
});

test('a downhill move within the morning escape keeps its existing outcome semantics',()=>{
 const morningGroups=groups.map(g=>g.id==='descent'?{...g,origin:'breakaway' as const}:g);
 const attack:TimelineEvent={km:170,type:'finale_attack',params:{direction:'descent',group_id:'descent',rider_ids:['a']}};
 const input={breakawayWin:false,trace:{entryGroups:morningGroups,preFinaleGroups:morningGroups,postFinaleGroups:morningGroups},results:[result('a',1),result('p',2),result('m',3)]};
 assert.deepEqual(settleBreakawaySurvivedEvents([attack,survived],{...input,physicalDescentOutcomes:true}),settleBreakawaySurvivedEvents([attack,survived],input));
});
