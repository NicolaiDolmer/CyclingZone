import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCompensation,buildHistoricalRaceEvidence } from './calculate6061Compensation.mjs';
import { VISIBLE_ABILITIES } from '../../lib/abilityDerivation.js';
import { buildApplyPayload,serializeApplyPayload,captureSourceHashes,changedSourceTables,normalizeScope,assertSourceHashes,SOURCE_HASH_TABLES,SOURCE_HASH_FUNCTION } from './compensation6061Source.mjs';
import { validateApprovedFile } from './apply6061Compensation.mjs';
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
 const data=input();data.state.conditions=[{rider_id:'r',form:50,fatigue:0}];data.state.ticks=[{rider_id:'r',season_id:'s',game_day:20,team_id:'t',tick_date:'2026-10-02'}];
 assert.equal((await calculateCompensation(data)).summary.rider_days,4);
});
test('a fully receipted first date does not hide later missing dates',async()=>{
 const data=input();data.state.conditions=[{rider_id:'r',form:50,fatigue:0}];data.state.work.unshift({...data.state.work[0],tick_date:'2026-10-01',game_days:[15,16,17,18,19]});
 data.state.ticks=[15,16,17,18,19].map(game_day=>({rider_id:'r',season_id:'s',game_day}));
 assert.equal((await calculateCompensation(data)).summary.rider_days,5);
});
test('same global slot in two owner rows requires review instead of compensation',async()=>{
 const data=input();data.state.work.push({...data.state.work[0],team_id:'former'});
 const result=await calculateCompensation(data);assert.equal(result.summary.rider_days,0);assert.equal(result.summary.blocked_riders,1);
});
test('consumed load or applied history without condition cannot enter the write batch',async()=>{
 const data=input();data.state.loads=[{rider_id:'r',season_id:'s',tick_date:'2026-10-02',game_day:20,consumed_at:'2026-10-02T18:00:00Z'}];
 data.stageBySlot['r:s:20']={raceId:'race',stageNumber:1,profileType:'mountain'};
 assert.equal((await calculateCompensation(data)).summary.rider_days,0);
 data.state.loads=[];data.state.settlements=[{rider_id:'r'}];assert.equal((await calculateCompensation(data)).summary.rider_days,0);
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

// #6129: the writer gets per-table hashes, never raw source rows.
const fakeHashes=(c='a')=>Object.fromEntries(SOURCE_HASH_TABLES.map(t=>[t,c.repeat(64)]));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('source hashes are captured by one read-only RPC with the normalized scope',async()=>{
 const scope=normalizeScope({ids:['r2','r1','r1'],teamIds:['t'],seasonIds:['s','s']});
 assert.deepEqual(scope,{rider_ids:['r1','r2'],team_ids:['t'],season_ids:['s']});
 let seen;const db={rpc:async(name,args)=>{seen={name,args};return {data:fakeHashes(),error:null};}};
 assert.deepEqual(await captureSourceHashes(db,scope,'2026-10-02'),fakeHashes());
 assert.equal(seen.name,SOURCE_HASH_FUNCTION);assert.deepEqual(seen.args,{p_rider_ids:['r1','r2'],p_team_ids:['t'],p_season_ids:['s'],p_through:'2026-10-02'});
 await assert.rejects(captureSourceHashes({rpc:async()=>({data:null,error:{message:'boom'}})},scope,'2026-10-02'),/capture failed/);
 await assert.rejects(captureSourceHashes({rpc:async()=>({data:{teams:'a'.repeat(64)},error:null})},scope,'2026-10-02'),/Complete source hashes/);
});
test('only tables whose relevant hash changed are reported',()=>{
 const a=fakeHashes(),b={...fakeHashes(),users:'b'.repeat(64)};
 assert.deepEqual(changedSourceTables(a,a),[]);assert.deepEqual(changedSourceTables(a,b),['users']);
 assert.throws(()=>assertSourceHashes({...a,extra:'c'.repeat(64)}),/Complete/);
});
test('apply payload carries plans and hashes only and passes the writer contract',async()=>{
 const data=input();data.state.conditions=[{rider_id:'r',form:62,fatigue:30,injured_until:null}];
 const result=await calculateCompensation(data);result.source_checks=[{table:'users',rows:[{last_seen:'x'}]}];
 const scope=normalizeScope({ids:['r'],teamIds:['t'],seasonIds:['s']});
 const payload=buildApplyPayload(result,{scope,sourceHashes:fakeHashes()});
 assert.equal('source_checks' in payload,false);assert.deepEqual(Object.keys(payload.plans[0]).sort(),['current_condition','days','expected_abilities','patch','rider_id','season_id','team_id']);
 assert.deepEqual(Object.keys(payload.plans[0].days[0]).sort(),['gains','gameDay','key','kind','progress','tickDate']);
 assert.equal(payload.summary.rider_days,result.summary.rider_days);
 const {raw,sha256}=serializeApplyPayload(payload);
 assert.equal(validateApprovedFile(raw,sha256,'2026-10-03T13:00:00Z').plans.length,1);
});
test('payload for a plan of the current size stays far below 1 MB',async()=>{
 const one=(await calculateCompensation(input())).plans[0];const plans=[];let day=0;
 for(let i=0;i<28;i++){const rider=uuid(i+1),team=uuid(100+(i%9)),season=uuid(999);const days=[];
  for(let k=0;k<12&&day<330;k++,day++){const d={...one.days[k%one.days.length],gameDay:1+day,key:`6061:${season}:${1+day}:${rider}`,riderId:rider,teamId:team,seasonId:season};days.push(d);}
  plans.push({...one,rider_id:rider,team_id:team,season_id:season,days,perDay:days.map(d=>({key:d.key,progress:0.123456789,gains:{climbing:0.123456789,endurance:0.123456789}})),
   current_condition:{rider_id:rider,form:50,fatigue:12,injured_until:null,injury_cause:null,injury_race_days_left:0,updated_at:'2026-10-03T08:00:00.000Z'},
   expected_abilities:{rider_id:rider,...Object.fromEntries(VISIBLE_ABILITIES.map(k=>[k,55])),ability_progress:Object.fromEntries(VISIBLE_ABILITIES.map(k=>[k,0.123456789])),updated_at:'2026-10-03T08:00:00.000Z'}});}
 const ids=plans.map(p=>p.rider_id);
 const payload=buildApplyPayload({policy:'current_plans_current_engine',through:'2026-10-02',source_hash:'f'.repeat(64),plans},{scope:normalizeScope({ids:[...ids,...Array.from({length:40},(_,i)=>uuid(500+i))],teamIds:plans.map(p=>p.team_id),seasonIds:[uuid(999)]}),sourceHashes:fakeHashes()});
 const {bytes}=serializeApplyPayload(payload);
 assert.equal(payload.summary.rider_days,330);assert.ok(bytes<1024*1024,`payload ${bytes} bytes`);
});
