import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSpentRaceDays,spentRaceBindingWindows} from './raceSpentDays.js';
import {findRiderBindingConflicts} from './raceBinding.js';

test('spent participation blocks transferred riders without any old-team selection',async()=>{
  const rows=[{rider_id:'r1',race_id:'old',game_day:12}];
  const supabase={rpc:async()=>({data:rows,error:null})};
  const otherRaces=spentRaceBindingWindows(await loadSpentRaceDays({supabase,raceId:'new',riderIds:['r1']}));
  assert.deepEqual(findRiderBindingConflicts({riderIds:['r1'],thisWindow:{start:12,end:15,days:[12,13,14,15]},otherRaces}),['r1']);
  assert.deepEqual(findRiderBindingConflicts({riderIds:['r1'],thisWindow:{start:13,end:15,days:[13,14,15]},otherRaces}),[]);
});
test('a failed or malformed participation lookup never releases the day',async()=>{
  await assert.rejects(()=>loadSpentRaceDays({supabase:{rpc:async()=>({data:null,error:{code:'503',message:'unavailable'}})},raceId:'new',riderIds:['r1']}),/lookup failed/);
  await assert.rejects(()=>loadSpentRaceDays({supabase:{rpc:async()=>({data:false,error:null})},raceId:'new',riderIds:['r1']}),/Invalid spent/);
});
test('grouping retains each rider own spent day rather than cross-binding teammates',()=>{
  const otherRaces=spentRaceBindingWindows([{rider_id:'r1',race_id:'old',game_day:12},{rider_id:'r2',race_id:'old',game_day:13}]);
  const thisWindow={start:13,end:13,days:[13]};
  assert.deepEqual(findRiderBindingConflicts({riderIds:['r1'],thisWindow,otherRaces}),[]);
  assert.deepEqual(findRiderBindingConflicts({riderIds:['r2'],thisWindow,otherRaces}),['r2']);
});
test('backend-before-migration fallback retains former-owner results and snapshots',async()=>{
  const tables={races:{season_id:'s4'},
    race_stage_schedule:[{game_day:12},{race_id:'old',stage_number:5,game_day:12}],
    race_results:[{race_id:'old',stage_number:5,rider_id:'r1'}],
    race_simulation_runs:[{race_id:'old',stage_number:5,entrant_snapshot:['r2']}],
  };
  const supabase={rpc:async()=>({error:{code:'PGRST202',message:'Could not find find_spent_race_days'}}),from(table){
    let target=false;
    const query={select(){return query;},eq(key,value){if(key==='race_id'&&value==='new') target=true;return query;},
      neq(){return query;},gte(){return query;},lte(){return query;},in(){return query;},order(){return query;},range(){return query;},single(){return query;},
      then(resolve,reject){let data=tables[table];if(table==='race_stage_schedule') data=target?[data[0]]:[data[1]];
        return Promise.resolve({data,error:null}).then(resolve,reject);}};
    return query;
  }};
  assert.deepEqual(await loadSpentRaceDays({supabase,raceId:'new',riderIds:['r1','r2']}),[
    {rider_id:'r1',race_id:'old',game_day:12},{rider_id:'r2',race_id:'old',game_day:12},
  ]);
});
