import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCompensation,buildHistoricalRaceEvidence } from './calculate6061Compensation.mjs';
import { VISIBLE_ABILITIES } from '../../lib/abilityDerivation.js';
const input=()=>({state:{asOf:'2026-10-03T14:00:00Z',through:'2026-10-02',work:[{team_id:'t',season_id:'s',tick_date:'2026-10-02',game_days:[20,21,22,23,24],quarantined_rider_ids:['r'],opening_conditions:{}}],riders:[{id:'r',team_id:'t'}],conditions:[],ticks:[],settlements:[],legacyReports:[],loads:[],plans:[{rider_id:'r',team_id:'t',focus:'climbing',intensity:'normal'}],weekPlans:[]},fullRiders:[{id:'r',team_id:'t',birthdate:'2000-06-01',potentiale:80,primary_type:'climber',secondary_type:'puncheur'}],abilityRows:[{rider_id:'r',...Object.fromEntries(VISIBLE_ABILITIES.map(k=>[k,50])),ability_progress:{}}],seasons:[{id:'s',number:4}],teamContexts:{t:{staff:null,facilityTier:0,programsOn:false}},stageBySlot:{}});
test('current-plan calculation is deterministic and preserves input/current condition',async()=>{
 const data=input();data.state.conditions=[{rider_id:'r',form:62,fatigue:30,injured_until:null}];const before=JSON.stringify(data);
 const a=await calculateCompensation(data),b=await calculateCompensation(data);assert.deepEqual(a,b);assert.equal(JSON.stringify(data),before);
 assert.equal(a.summary.rider_days,5);assert.equal(a.requires_owner_go,true);assert.equal(a.write_ready,false);assert.equal(a.plans[0].current_condition.fatigue,30);
});
test('recorded race receives race development even when current plan is rest',async()=>{
 const data=input();data.state.plans[0].intensity='rest';data.stageBySlot['r:s:20']={raceId:'race',stageNumber:1,profileType:'mountain'};
 data.state.loads=[{rider_id:'r',season_id:'s',tick_date:'2026-10-02',game_day:20,load:12}];
 const result=await calculateCompensation(data);assert.equal(result.summary.race_days,1);assert.equal(result.plans[0].perDay.filter(d=>d.kind==='raced_missed').length,1);
 assert.ok(result.plans[0].totalProgress>0);assert.equal(result.plans[0].perDay.filter(d=>d.kind==='free_slot').every(d=>d.progress===0),true);
});
test('existing receipts cannot be credited again',async()=>{
 const data=input();data.state.ticks=[{rider_id:'r',season_id:'s',game_day:20,team_id:'t',tick_date:'2026-10-02'}];
 assert.equal((await calculateCompensation(data)).summary.rider_days,4);
});
test('a fully receipted first date does not hide later missing dates',async()=>{
 const data=input();data.state.work.unshift({...data.state.work[0],tick_date:'2026-10-01',game_days:[15,16,17,18,19]});
 data.state.ticks=[15,16,17,18,19].map(game_day=>({rider_id:'r',season_id:'s',game_day}));
 assert.equal((await calculateCompensation(data)).summary.rider_days,5);
});
test('same global slot in two owner rows is never credited twice',async()=>{
 const data=input();data.state.work.push({...data.state.work[0],team_id:'former'});
 assert.equal((await calculateCompensation(data)).summary.rider_days,5);
});
test('a bound day without a stage is legitimate rest under the current motor',async()=>{
 const data=input();data.boundBySlot={'r:s:20':true,'r:s:21':true,'r:s:22':true,'r:s:23':true,'r:s:24':true};
 const result=await calculateCompensation(data);assert.equal(result.plans[0].totalProgress,0);
});

test('current manager fatigue rule is respected without modifying the saved plan',async()=>{
 const data=input();data.state.conditions=[{rider_id:'r',form:50,fatigue:50}];
 data.teamContexts.t.rulesByRider={r:{threshold:20,fallback:'rest',recoveryAfterStage:false}};
 const result=await calculateCompensation(data);assert.equal(result.plans[0].totalProgress,0);assert.equal(data.state.plans[0].intensity,'normal');
});
test('historic result and binding are discovered independently of missing loads',()=>{
 const evidence=buildHistoricalRaceEvidence({ids:['r'],raceRows:[{id:'race',season_id:'s',race_type:'stage',stages_completed:1}],scheduleRows:[{race_id:'race',stage_number:1,game_day:20,scheduled_at:'2026-10-02T10:00:00Z'},{race_id:'race',stage_number:2,game_day:24,scheduled_at:'2026-10-02T14:00:00Z'}],profiles:[],firstRuns:[{race_id:'race',entrant_snapshot:['r']}],results:[{rider_id:'r',race_id:'race',stage_number:1,result_type:'stage'}],loads:[],through:'2026-10-02'});
 assert.equal(evidence.stageBySlot['r:s:20'].hasResult,true);assert.equal(evidence.boundBySlot['r:s:24'],true);
});
test('unstarted saved selection retains binding; malformed snapshots reject unknown state',()=>{
 const input={ids:['r'],raceRows:[],scheduleRows:[],profiles:[],firstRuns:[],results:[],loads:[],through:'2026-10-02',selections:[{rider_id:'r',race_id:'race',season_id:'s',game_day:20}]};
 assert.equal(buildHistoricalRaceEvidence(input).boundBySlot['r:s:20'],true);
 input.firstRuns=[{race_id:'race',entrant_snapshot:[{}]}];assert.throws(()=>buildHistoricalRaceEvidence(input),/Invalid/);
 input.firstRuns=[{race_id:'race',entrant_snapshot:['other']}];assert.equal(buildHistoricalRaceEvidence(input).boundBySlot['r:s:20'],undefined);
});
