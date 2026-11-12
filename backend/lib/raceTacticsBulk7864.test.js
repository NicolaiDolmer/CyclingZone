import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFillStage7864} from './raceTacticsBulk7864.js';

const now=new Date('2026-11-11T10:00:00Z');
const baseRoleByRider=new Map([['a','captain'],['b','helper']]);
const rolesCtx={stage_count:3,stages_completed:0,teamRiderIds:new Set(['a','b']),baseRoleByRider,abandonedRiderIds:new Set(),overrides:[]};
const ordersCtx={...rolesCtx,race_completed:false,scheduleByStage:new Map([[2,'2026-11-12T10:00:00Z']])};
const profile={stage_number:2,distance_km:160,profile_type:'flat',climbs:[],sprints:[]};
const plan={stage_number:2,overrides:[],order:{breakaway_stance:'neutral',riders:[{rider_id:'a',effort:'normal',try_break:false,leadout:false,plan:[{task:'stay_sheltered'},{task:'ride_for_result',from:{at:'final_km'}}]}]}};
const args={plan,rolesCtx,ordersCtx,profile,race:{status:'scheduled'},coCaptainAllowed:false,jerseyHunt:false,now};
test('destination validation uses its own route and proposed effective role before normalization',()=>{
 const result=prepareFillStage7864(args);
 assert.equal(result.stage_number,2);assert.equal(result.order.riders[0].plan[1].task,'ride_for_result');
 assert.deepEqual(result.expected_profile,{distance_km:160,profile_type:'flat',climbs:[],sprints:[]});
 const wrongRoute={...plan,order:{...plan.order,riders:[{...plan.order.riders[0],plan:[{task:'stay_sheltered'},{task:'attack',from:{at:'kom',index:9}}]}]}};
 assert.throws(()=>prepareFillStage7864({...args,plan:wrongRoute}));
});
test('foreign stage roles, invalid order, abandoned riders and explicit locked clock fail closed',()=>{
 for(const change of [
  {plan:{...plan,overrides:[{stage_number:3,rider_id:'a',race_role:'captain',effort:'normal'}]}},
  {plan:{...plan,order:{breakaway_stance:'invalid',riders:[]}}},
  {rolesCtx:{...rolesCtx,abandonedRiderIds:new Set(['a'])}},
  {now:new Date('2026-11-12T11:00:00Z')},
  {profile:{...profile,profile_type:'itt'}},
 ])assert.throws(()=>prepareFillStage7864({...args,...change}));
});
