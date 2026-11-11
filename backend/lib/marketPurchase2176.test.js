import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoutAssignmentBeta2176 } from './marketPurchase2176.ts';
const NOW='2026-11-10T10:00:00Z';
const assignment={team_id:'team',staff_id:null,kind:'mission',mission_criteria:{scope:'country',value:'DK'},travel_cost:300,
  started_on:'2026-11-10',ready_on:'2026-11-12',season_id:null};
const input={assignment,sourcePath:'scoutAssignmentService.startMission',metadata:{code:'tx.scoutTravel',params:{kind:'mission',criteria:assignment.mission_criteria}}};
function fixture(stage,result={data:{status:'created',assignment:{id:'assignment',created_at:NOW}},error:null}){
 const calls=[];return{calls,from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{value:stage},error:null})};},
 rpc:async(name,args)=>{calls.push({name,args});return result;}};
}
test('scouting on/off keep the original service path without the new RPC',async()=>{
 for(const stage of ['on',true,'off',false,null]){const db=fixture(stage);assert.equal(await createScoutAssignmentBeta2176(db,input),null);assert.equal(db.calls.length,0);}
});
test('beta scout purchase uses the existing exact audit semantics and committed receipt',async()=>{
 const db=fixture('beta');const result=await createScoutAssignmentBeta2176(db,input);
 assert.deepEqual(result,{status:'created',assignment:{id:'assignment',created_at:NOW},debit:{skipped:false}});
 assert.equal(db.calls[0].name,'market_scout_assignment_2176');
 assert.deepEqual(db.calls[0].args,{p_team_id:'team',p_assignment:assignment,p_finance_payload:{
  type:'scout_travel',amount:-300,description:null,season_id:null,actor_type:'cron',actor_id:null,
  source_path:'scoutAssignmentService.startMission',reason_code:'scout_travel',related_entity_type:'season',related_entity_id:null,metadata:input.metadata,
 }});
});
test('known refusal cannot fall back to an uncharged assignment; unknown errors propagate',async()=>{
 const db=fixture('beta',{data:null,error:{code:'P0001',message:'market_gate_6181:insufficient_available_balance',details:'{"available":100,"locked":400}'}});
 assert.deepEqual(await createScoutAssignmentBeta2176(db,input),{status:'refused',issue:{error:'insufficient_available_balance',available:100,locked:400}});
 const error={code:'XX000',message:'failed'};await assert.rejects(createScoutAssignmentBeta2176(fixture('beta',{data:null,error}),input),caught=>caught===error);
 await assert.rejects(createScoutAssignmentBeta2176(fixture('beta',{data:{status:'created'},error:null}),input),/invalid.*receipt/);
});
