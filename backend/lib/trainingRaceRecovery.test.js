import test from 'node:test';
import assert from 'node:assert/strict';
import * as recovery from './trainingRaceRecovery.js';

test('recovery exposes dry-run planning independently from simulation',()=>{
  assert.equal(typeof recovery.recoverRecordedRaceLoads,'function');
});

test('recovery exposes an executable stored-result completion path',()=>{
  assert.equal(typeof recovery.completeRecordedRace,'function');
});

function fixture({missingSnapshot=false}={}) {
  const state={app_config:[{key:'training_condition_per_date',value:'on'},{key:'training_tick_per_race_day',value:'on'}],races:[{id:'race',season_id:'season',status:'completed',stages:2,race_type:'stage_race',stages_completed:2,finalize_state:null}],
    race_results:[{id:1,race_id:'race',stage_number:1,result_type:'stage'},{id:2,race_id:'race',stage_number:2,result_type:'stage'},{id:3,race_id:'race',stage_number:2,result_type:'gc'}],
    race_stage_schedule:[{race_id:'race',stage_number:1,game_day:0,scheduled_at:'2026-09-28T09:00:00Z'},{race_id:'race',stage_number:2,game_day:5,scheduled_at:'2026-09-29T09:00:00Z'}],
    race_simulation_runs:[1,2].map(stage_number=>({race_id:'race',stage_number,entrant_snapshot:['r1'],condition_load_snapshot:missingSnapshot&&stage_number===2?null:[{rider_id:'r1',load:12}]})),
    training_race_loads:[],training_condition_settlements:[],rider_condition:[{rider_id:'r1',form:73,fatigue:41,injured_until:'2026-10-09',injury_cause:'newer_crash'}]};
  let calls=0;
  const supabase={from(table){const filters=[];let offset=0,end=Infinity;const rows=()=>structuredClone((state[table]??[]).filter(row=>filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value)).slice(offset,end));const query={select(){return this;},eq(key,value){filters.push([key,value]);return this;},in(key,value){filters.push([key,value]);return this;},order(){return this;},range(first,last){offset=first;end=last+1;return this;},async maybeSingle(){return {data:rows()[0]??null,error:null};},then(resolve,reject){return Promise.resolve({data:rows(),error:null}).then(resolve,reject);}};return query;},async rpc(name,args){
    calls++;
    if(name==='prepare_recorded_race_completion') {
      assert.deepEqual(args.p_expected_finalize_state,state.races[0].finalize_state);
      state.races[0].status='completed';state.races[0].finalize_state={...state.races[0].finalize_state,recorded_completion_prepared:true};
      return {data:{already_complete:false,finalize_state:structuredClone(state.races[0].finalize_state)},error:null};
    }
    if(name==='finish_recorded_race_completion') {
      assert.deepEqual(args.p_expected_finalize_state,state.races[0].finalize_state);state.races[0].finalize_state=null;
      return {data:{completed:true},error:null};
    }
    assert.equal(name,'recover_training_race_load_stage');
    const run=state.race_simulation_runs.find(row=>row.stage_number===args.p_stage_number);
    const scheduled=state.race_stage_schedule.find(row=>row.stage_number===args.p_stage_number);
    let recorded=0;
    for(const load of run.condition_load_snapshot) if(!state.training_race_loads.some(row=>row.rider_id===load.rider_id&&row.stage_number===run.stage_number)){
      state.training_race_loads.push({...load,race_id:'race',stage_number:run.stage_number,game_day:scheduled.game_day,tick_date:scheduled.scheduled_at.slice(0,10)});recorded++;
    }
    if(state.races[0].status!=='completed') {
      const current=state.races[0].finalize_state??{};
      if(current.stage_number===args.p_stage_number&&!current.done.includes('fatigue'))current.done.push('fatigue');
      state.races[0].finalize_state={...current,condition_recovery_hold:{reason:'recorded_load_recovery',requires_review:true}};
    }
    return {data:{recorded,finalize_state:structuredClone(state.races[0].finalize_state),marker_updated:false},error:null};
  }};
  return {state,supabase,calls:()=>calls};
}
test('cross-date recovery is dry-run first, idempotent and never changes newer condition or injury',async()=>{
  const f=fixture();const before=structuredClone(f.state.rider_condition);
  const args={supabase:f.supabase,raceId:'race',now:new Date('2026-10-01T10:00:00Z')};
  const plan=await recovery.recoverRecordedRaceLoads(args);
  assert.equal(plan.canApply,true);assert.equal(f.calls(),0);
  assert.deepEqual(plan.stages.map(stage=>stage.tickDate),['2026-09-28','2026-09-29']);
  const first=await recovery.recoverRecordedRaceLoads({...args,apply:true});
  assert.equal(first.applied.reduce((sum,row)=>sum+row.recorded,0),2);
  const second=await recovery.recoverRecordedRaceLoads({...args,apply:true});
  assert.equal(second.applied.reduce((sum,row)=>sum+row.recorded,0),0);
  assert.deepEqual(f.state.rider_condition,before);
});
test('missing original effort snapshot blocks the whole recovery before any writes',async()=>{
  const f=fixture({missingSnapshot:true});const args={supabase:f.supabase,raceId:'race',now:new Date('2026-10-01T10:00:00Z')};
  const plan=await recovery.recoverRecordedRaceLoads(args);
  assert.equal(plan.canApply,false);assert.match(plan.blockers.join(' '),/condition_load_snapshot/);
  await assert.rejects(recovery.recoverRecordedRaceLoads({...args,apply:true}),/recovery blocked/);
  assert.equal(f.calls(),0);assert.equal(f.state.training_race_loads.length,0);
});

test('stored-result completion survives a tail failure and reaches completed without replaying game effects',async()=>{
  const f=fixture();f.state.races[0].status='scheduled';f.state.races[0].finalize_state={stage_number:2,stage_index:1,final:true,done:['write','enrichment','standings','board','notify']};
  const conditions=structuredClone(f.state.rider_condition),results=structuredClone(f.state.race_results);
  let moved=false,moves=0,refreshCalls=0;
  const effects={recomputeRaceDays:async()=>{},flushTransfers:async(_db,_race,args)=>{assert.deepEqual(args.originalRiderIds,['r1']);if(!moved){moved=true;moves++;}return {ridersFlushed:moves};},flushAcademy:async()=>({ridersFlushed:0}),refreshRankings:async()=>++refreshCalls>1};
  const args={supabase:f.supabase,raceId:'race',now:new Date('2026-10-01T10:00:00Z'),effects};
  assert.equal((await recovery.completeRecordedRace(args)).canApply,true);
  await assert.rejects(recovery.completeRecordedRace({...args,apply:true}),/ranking refresh failed/);
  assert.ok(f.state.races[0].finalize_state.condition_recovery_hold);
  const completed=await recovery.completeRecordedRace({...args,apply:true});
  assert.equal(completed.raceComplete,true);assert.equal(f.state.races[0].finalize_state,null);assert.equal(moves,1);
  const repeated=await recovery.completeRecordedRace({...args,apply:true});
  assert.equal(repeated.alreadyComplete,true);assert.equal(moves,1);
  assert.deepEqual(f.state.rider_condition,conditions);assert.deepEqual(f.state.race_results,results);
});

test('missing non-replayable board or notification proofs are concrete completion blockers',async()=>{
  const f=fixture();f.state.races[0].status='scheduled';f.state.races[0].finalize_state={stage_number:2,done:['write','enrichment','standings']};
  const plan=await recovery.completeRecordedRace({supabase:f.supabase,raceId:'race',now:new Date('2026-10-01T10:00:00Z')});
  assert.equal(plan.canApply,false);assert.match(plan.blockers.join(' '),/original board before-state/);assert.match(plan.blockers.join(' '),/original delivery/);
  assert.equal(f.calls(),0);
});

test('flag-off recovery and completion never read protected tables or condition snapshots',async()=>{
  for(const operation of [recovery.recoverRecordedRaceLoads,recovery.completeRecordedRace]) {
    const tables=[],columns=[];
    const supabase={from(table){tables.push(table);assert.equal(table,'app_config','flag-off must stop before any recovery input query');return {select(value){columns.push(value);assert.doesNotMatch(value,/condition_load_snapshot/);return this;},eq(){return this;},async maybeSingle(){return {data:{value:'off'},error:null};}};},async rpc(){assert.fail('flag-off must not write');}};
    const args={supabase,raceId:'race',now:new Date('2026-10-01T10:00:00Z')};
    const plan=await operation(args);
    assert.equal(plan.reason,'flag_off');assert.equal(plan.canApply,false);
    await assert.rejects(operation({...args,apply:true}),/flag is off/);
    assert.deepEqual(tables,['app_config','app_config']);assert.deepEqual(columns,['value','value']);
  }
});
