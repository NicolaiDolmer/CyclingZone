import test from 'node:test';
import assert from 'node:assert/strict';
import { runSegmentLoop, DEFAULT_MECHANIC_HOOKS } from './segmentLoop.ts';
import { RACE_V4_TUNING } from './tuning.ts';
import type { AbilityKey, Entrant, RaceGroup, StageInput, MechanicHooks } from './types.ts';

const abilityKeys: AbilityKey[] = ['climbing','time_trial','flat','tempo','sprint','acceleration','punch','endurance','recovery','durability','descending','cobblestone','positioning','aggression','tactics'];
function group(id: string, kind: RaceGroup['kind'], gap: number, size: number, origin?: RaceGroup['origin']): RaceGroup {
  return {id,kind,gap_seconds:gap,cohesion:1,rider_ids:Array.from({length:size},(_,i)=>`${id}-${i}`),...(origin?{origin}:{})};
}
function entrantsFor(groups: RaceGroup[], strength: (id:string)=>number = ()=>50): Entrant[] {
  return groups.flatMap(g=>g.rider_ids).map(rider_id=>({rider_id,
    abilities:Object.fromEntries(abilityKeys.map(key=>[key,strength(rider_id)])) as Entrant['abilities'],
    role:'free_role',effort:'normal',condition:1}));
}
const cases = [
  {stage:14,from:71.4,to:89,size:4,before:{attack:204.59,peloton:224.59,tail:300},after:{attack:243.29,peloton:203.74,tail:330}},
  {stage:16,from:101.2,to:116.95,size:3,before:{attack:100.05,peloton:120.05,tail:107.6},after:{attack:97.66,peloton:34.9,tail:202.61}},
];
for(const c of cases) test(`#6327 e${c.stage}: passage during another pursuit reunites descent attackers before the next hook`,()=>{
  const before=[group('morning','breakaway',0,c.size,'breakaway'),group('attack','breakaway',c.before.attack,c.size,'descent'),group('peloton','peloton',c.before.peloton,c.size),group('tail','chase',c.before.tail,c.size)];
  const after=before.map(g=>({...g,gap_seconds:g.id==='morning'?0:c.after[g.id as keyof typeof c.after]}));
  const tuning=structuredClone(RACE_V4_TUNING);tuning.terrain.strengthSpeedGain=0;
  const input: StageInput={route:{distance_km:c.to,profile_type:'rolling',finale_type:'reduced_sprint',
    segments:[{kind:'descent',from_km:0,to_km:c.from,technicality:1},{kind:'flat',from_km:c.from,to_km:c.to}],
    weather:{kind:'sun',wind_exposure:0},waypoints:[]},startlist:entrantsFor(before),orders:[],seed:'6327-checkpoints',tuning,rules_revision:'official_times_v1'};
  let joinedBeforeIncidents=false;
  const hooks:MechanicHooks={...DEFAULT_MECHANIC_HOOKS,
    descent:state=>({state:{...state,groups:before},events:[]}),
    breakaway:(state,ctx)=>({state:ctx.segmentIndex===1?{...state,groups:after}:state,events:[]}),
    incidents:(state,ctx)=>{if(ctx.segmentIndex===1)joinedBeforeIncidents=state.groups.some(g=>g.rider_ids.includes('attack-0')&&g.rider_ids.includes('peloton-0'));return {state,events:[]};},
  };
  const result=runSegmentLoop(input,hooks);
  assert.equal(joinedBeforeIncidents,true,'a passed attack must not remain a separate breakaway for M10/finale');
  const caught=result.timeline.filter(e=>e.type==='breakaway_caught'&&e.params.group_id==='attack');
  assert.equal(caught.length,1);assert.equal(caught[0].km,c.to);assert.equal(caught[0].params.chase_group_id,'peloton');
  const members=result.state.groups.flatMap(g=>g.rider_ids);
  assert.equal(new Set(members).size,input.startlist.length);assert.equal(members.length,input.startlist.length);
  assert.equal(result.state.riders['attack-0'].time_seconds,result.state.riders['peloton-0'].time_seconds);
  assert.equal(result.state.riders['attack-0'].group_id,result.state.riders['peloton-0'].group_id);
  assert.equal(result.state.groups.find(g=>g.id==='morning')?.origin,'breakaway');
  for(const revision of ['legacy','orders_gc_v1','orders_gc_v2','orders_gc_v3'] as const){
    const old=runSegmentLoop({...input,rules_revision:revision},hooks);
    assert.equal(old.timeline.some(e=>e.type==='breakaway_caught'&&e.params.group_id==='attack'),false);
  }
});

test('#6327 ordinary tempo passage is reconciled before M5 sees the obsolete attack',()=>{
  const initial=[group('morning','breakaway',0,4,'breakaway'),group('attack','breakaway',200,4,'descent'),group('peloton','peloton',220,4)];
  const input:StageInput={route:{distance_km:21,profile_type:'rolling',finale_type:'reduced_sprint',
    segments:[{kind:'descent',from_km:0,to_km:1,technicality:1},{kind:'flat',from_km:1,to_km:21}],
    weather:{kind:'sun',wind_exposure:0},waypoints:[]},startlist:entrantsFor(initial,id=>id.startsWith('attack')?10:id.startsWith('peloton')?90:50),orders:[],seed:'6327-tempo',tuning:RACE_V4_TUNING,rules_revision:'official_times_v1'};
  let joinedBeforePursuit=false;
  const hooks:MechanicHooks={...DEFAULT_MECHANIC_HOOKS,
    descent:state=>({state:{...state,groups:initial},events:[]}),
    breakaway:(state,ctx)=>{if(ctx.segmentIndex===1)joinedBeforePursuit=state.groups.some(g=>g.rider_ids.includes('attack-0')&&g.rider_ids.includes('peloton-0'));return {state,events:[]};},
  };
  const result=runSegmentLoop(input,hooks);
  assert.equal(joinedBeforePursuit,true,'tempo crossing must be resolved before M5 picks a deeper tail');
  assert.equal(result.timeline.filter(e=>e.type==='breakaway_caught'&&e.params.group_id==='attack').length,1);
});
