// Current-plan compensation approved by the owner on 3/10. No production writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllRowsChunkedIn, fetchAllRows } from '../../lib/supabasePagination.js';
import { buildRecoveryManifest, loadRecoveryInputs, parseArgs } from './prepare6061TrainingRecovery.mjs';
import { simulateRiderRepair } from './repair5912LostTraining.mjs';
import { isTrainingCellsEnabledForTeam } from '../../lib/trainingWeekPlanCellsFlag.js';
import { resolveDayProgram, programSlotForRaceDay, weekDaysHaveSessions } from '../../lib/trainingPrograms.js';
import { deriveStaffAbilities } from '../../lib/staffAbilityDerivation.js';
import { normalizeLevelBands } from '../../lib/staffAbilityConstants.js';
import { copenhagenDateString, copenhagenWeekdayKey } from '../../lib/copenhagenTime.js';
import { resolveProgram } from '../../lib/dailyTraining.js';
import { applyFatigueRules, loadTeamFatigueRules, previousDateString } from '../../lib/trainingFatigueRules.ts';
import { createHash } from 'node:crypto';
import {captureCompensationSource,sameSource} from './compensation6061Source.mjs';

// Strict counterpart of the engine's best-effort loader: a failed bonus lookup
// is unknown during compensation, never silently a neutral paid-service value.
async function strictStaff(supabase,teamId){
 const [facilities,staffRows]=await Promise.all([
  fetchAllRows(()=>supabase.from('team_facilities').select('id,track,tier').eq('team_id',teamId).eq('track','training').order('id')),
  fetchAllRows(()=>supabase.from('team_staff').select('id,name,role,tier,status').eq('team_id',teamId).eq('role','training').eq('status','active').order('id')),
 ]);
 const abilities=await fetchAllRowsChunkedIn(staffRows.map(r=>r.id),chunk=>supabase.from('staff_derived_abilities').select('staff_id,overall,dimensions,levels').in('staff_id',chunk).order('staff_id'));
 const profiles=staffRows.map(r=>abilities.find(a=>a.staff_id===r.id)??deriveStaffAbilities(r));
 const best=profiles.reduce((a,b)=>(b.overall??0)>(a?.overall??0)?b:a,null);
 return {facilityTier:facilities[0]?.tier??0,staff:best?{overall:best.overall,dimensions:best.dimensions??{},levels:normalizeLevelBands(best.levels??{})}:null};
}
export async function calculateCompensation({state,fullRiders,abilityRows,seasons,teamContexts,stageBySlot,boundBySlot={}}){
 const inventory=buildRecoveryManifest(state);const plans=[];const blocked=[];
 for(const id of new Set(inventory.candidates.map(c=>c.rider_id))){
  const rider=fullRiders.find(r=>r.id===id);const abilities=abilityRows.find(r=>r.rider_id===id);
  if(!rider?.team_id||rider.is_retired||!abilities){blocked.push({rider_id:id,reason:'missing_or_unowned_or_retired'});continue;}
  const currentCondition=state.conditions.find(c=>c.rider_id===id);
  if((currentCondition?.injured_until&&currentCondition.injured_until>=copenhagenDateString(new Date(state.asOf)))||Number(currentCondition?.injury_race_days_left)>0){blocked.push({rider_id:id,reason:'injury_state_requires_review'});continue;}
  const entries=inventory.candidates.filter(c=>c.rider_id===id&&c.team_id===rider.team_id);
  if(!entries.length){blocked.push({rider_id:id,reason:'historical_owner_differs'});continue;}
  const seasonIds=[...new Set(entries.map(c=>c.season_id))];
  if(seasonIds.length!==1){blocked.push({rider_id:id,reason:'multiple_seasons'});continue;}
  const season=seasons.find(s=>s.id===seasonIds[0]);
  if(!season){blocked.push({rider_id:id,reason:'missing_season'});continue;}
  const ctx=teamContexts[rider.team_id];const days=[];const seen=new Set();let fatal=false;
  for(const entry of entries.sort((a,b)=>a.tick_date.localeCompare(b.tick_date))){
   const work=state.work.find(w=>w.team_id===entry.team_id&&w.season_id===entry.season_id&&w.tick_date===entry.tick_date);
   const condition=entry.opening_condition??currentCondition??{form:50,fatigue:0};
   for(const gameDay of entry.missing_game_days){
    const key=`6061:${entry.season_id}:${gameDay}:${id}`;if(seen.has(key))continue;seen.add(key);
    const stage=stageBySlot[`${id}:${entry.season_id}:${gameDay}`];
    const load=state.loads.find(l=>l.rider_id===id&&l.season_id===entry.season_id&&l.game_day===gameDay);
    if(load&&!stage){blocked.push({rider_id:id,reason:'recorded_load_without_confirmed_stage',game_day:gameDay});fatal=true;break;}
    const weekday=copenhagenWeekdayKey(entry.tick_date);
    const plan=state.plans.filter(p=>p.rider_id===id&&p.team_id===rider.team_id).at(-1)??null;
    const weeks=state.weekPlans.filter(w=>w.team_id===rider.team_id);
    const program=resolveProgram(plan,rider.primary_type);
    const dayProgram=resolveDayProgram({weekday,slotIndex:programSlotForRaceDay(gameDay,work.game_days),program,hasExplicitPlan:!!(plan?.focus&&plan?.intensity),programsOn:ctx.programsOn,riderOverrideDays:weeks.find(w=>w.rider_id===id)?.days??null,teamWeekDays:weeks.find(w=>w.rider_id==null)?.days??null});
    if(dayProgram.source==='program')program.focus=dayProgram.focus;program.intensity=dayProgram.intensity;
    const rule=applyFatigueRules({program,rule:ctx.rulesByRider?.[id]??null,fatigueAtDateStart:Number(condition.fatigue??0),slotIndex:programSlotForRaceDay(gameDay,work.game_days),rodeStagePreviousDate:state.loads.some(l=>l.rider_id===id&&l.tick_date===previousDateString(entry.tick_date))});
    const stagedOnDate=Object.entries(stageBySlot).some(([key,st])=>key.startsWith(`${id}:${entry.season_id}:`)&&work.game_days.includes(Number(key.split(':').at(-1)))&&st.hasResult!==false);
    const boundRest=boundBySlot[`${id}:${entry.season_id}:${gameDay}`]&&!stagedOnDate&&!stage;
    days.push({key,tickProgram:rule.stamp?{focus:rule.focus,intensity:rule.intensity}:program,tickDate:entry.tick_date,kind:boundRest||stage?.hasResult===false?'bound_rest':stage?'raced_missed':'free_slot',riderId:id,teamId:rider.team_id,seasonId:entry.season_id,gameDay,dateGameDays:work.game_days,profileType:stage?.profileType??null,formBefore:Number(condition.form??50),fatigueBefore:Number(condition.fatigue??0)});
   }
   if(fatal)break;
  }
  if(fatal||!days.length)continue;
  const plan=state.plans.filter(p=>p.rider_id===id&&p.team_id===rider.team_id).at(-1)??null;
  const weeks=state.weekPlans.filter(w=>w.team_id===rider.team_id);
  const result=simulateRiderRepair({rider,abilityRow:abilities,days,plan,teamWeekDays:weeks.find(w=>w.rider_id==null)?.days??null,riderOverrideDays:weeks.find(w=>w.rider_id===id)?.days??null,...ctx,seasonNumber:season.number,recomputeCapsPerTick:true});
  if(Object.entries(result.patch??{}).some(([key,value])=>key!=='ability_progress'&&Number(value)<Number(abilities[key]??0))){blocked.push({rider_id:id,reason:'would_reduce_visible_ability'});continue;}
  if(result.skipped){blocked.push({rider_id:id,reason:result.skipped});continue;}
  plans.push({rider_id:id,team_id:rider.team_id,season_id:season.id,days,current_condition:currentCondition??null,condition_policy:'frozen_opening_else_current_condition_else_engine_first_use_default',expected_abilities:abilities,...result});
 }
 const hash=createHash('sha256').update(JSON.stringify({state,fullRiders,abilityRows,seasons,teamContexts,stageBySlot,boundBySlot})).digest('hex');
 return {issue:6061,policy:'current_plans_current_engine',through:state.through,source_hash:hash,requires_owner_go:true,write_ready:false,summary:{inventory_slots:inventory.summary.rider_days,riders:plans.length,rider_days:plans.reduce((n,p)=>n+p.days.length,0),race_days:plans.flatMap(p=>p.days).filter(d=>d.kind==='raced_missed').length,blocked_riders:new Set(blocked.map(b=>b.rider_id)).size},plans,blocked};
}
export function buildHistoricalRaceEvidence({ids,raceRows,scheduleRows,profiles,firstRuns,results,loads,through,selections=[]}){
 const state={loads};const stageBySlot={};
 const boundBySlot={};
 const fields=new Map();
 for(const run of firstRuns){
  const entrants=Array.isArray(run.entrant_snapshot)?run.entrant_snapshot.map(e=>typeof e==='string'?e:e?.rider_id):null;
  if(!entrants||!entrants.every(id=>typeof id==='string'&&id)||fields.has(run.race_id))throw new Error('Invalid or ambiguous immutable start field');
  fields.set(run.race_id,new Set(entrants));
 }
 for(const selected of selections){
  if(!fields.has(selected.race_id)||fields.get(selected.race_id).has(selected.rider_id))boundBySlot[`${selected.rider_id}:${selected.season_id}:${selected.game_day}`]=true;
 }
 for(const race of raceRows){
  const rows=scheduleRows.filter(s=>s.race_id===race.id&&s.game_day!=null);if(!rows.length)continue;
  if(!race.stages_completed)continue;
  const entrants=fields.get(race.id);
  if(!entrants)throw new Error('Original race-start snapshot missing; binding is unknown');
  const first=Math.min(...rows.map(r=>r.game_day)),last=Math.max(...rows.map(r=>r.game_day));
  for(const id of ids.filter(id=>entrants.has(id)))for(let day=first;day<=last;day++)boundBySlot[`${id}:${race.season_id}:${day}`]=true;
 }
 for(const load of state.loads){
  if(load.tick_date>through)continue;
  const race=raceRows.find(r=>r.id===load.race_id);
  const row=results.find(r=>r.rider_id===load.rider_id&&r.race_id===load.race_id&&Number(r.stage_number)===Number(load.stage_number)&&(r.result_type==='stage'||(race?.race_type==='single'&&r.result_type==='gc')));
  const schedule=scheduleRows.find(s=>s.race_id===load.race_id&&Number(s.stage_number)===Number(load.stage_number));
  if(!race||!schedule||schedule.game_day!==load.game_day)throw new Error('Canonical load/schedule mismatch');
  const profile=profiles.find(p=>p.race_id===load.race_id&&Number(p.stage_number)===Number(load.stage_number));
  stageBySlot[`${load.rider_id}:${load.season_id}:${load.game_day}`]={raceId:load.race_id,stageNumber:load.stage_number,profileType:profile?.profile_type??'rolling',hasResult:!!row,riderId:load.rider_id,tickDate:copenhagenDateString(new Date(schedule.scheduled_at))};
 }
 for(const row of results){
  const race=raceRows.find(r=>r.id===row.race_id);
  if(row.result_type!=='stage'&&!(race?.race_type==='single'&&row.result_type==='gc'))continue;
  const schedule=scheduleRows.find(s=>s.race_id===row.race_id&&Number(s.stage_number)===Number(row.stage_number));
  if(!schedule)throw new Error('Result has no canonical schedule');
  const date=copenhagenDateString(new Date(schedule.scheduled_at));if(date>through)continue;
  const key=`${row.rider_id}:${race.season_id}:${schedule.game_day}`;
  const existing=stageBySlot[key];if(existing&&(existing.raceId!==row.race_id||Number(existing.stageNumber)!==Number(row.stage_number)))throw new Error('Conflicting stages on one rider slot');
  const profile=profiles.find(p=>p.race_id===row.race_id&&Number(p.stage_number)===Number(row.stage_number));
  stageBySlot[key]={raceId:row.race_id,stageNumber:row.stage_number,profileType:profile?.profile_type??'rolling',hasResult:true,riderId:row.rider_id,tickDate:date};
 }
 return {stageBySlot,boundBySlot};
}
async function main(){
 const opts=parseArgs(process.argv.slice(2));const {createClient}=await import('@supabase/supabase-js');
 const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
 const initial=await loadRecoveryInputs(supabase,opts);const ids=[...new Set(initial.work.flatMap(w=>w.quarantined_rider_ids))];
 const scope={ids,teamIds:[...new Set(initial.work.map(w=>w.team_id))],seasonIds:[...new Set(initial.work.map(w=>w.season_id))]};
 const sourceChecks=await captureCompensationSource(supabase,scope);
 const state=await loadRecoveryInputs(supabase,opts);
 const [fullRiders,abilityRows,seasons]=await Promise.all([
  fetchAllRowsChunkedIn(ids,c=>supabase.from('riders').select('*').in('id',c).order('id')),
  fetchAllRowsChunkedIn(ids,c=>supabase.from('rider_derived_abilities').select('*').in('rider_id',c).order('rider_id')),
  fetchAllRowsChunkedIn([...new Set(state.work.map(w=>w.season_id))],c=>supabase.from('seasons').select('id,number,status').in('id',c).order('id')),
 ]);
 const teamContexts={};for(const teamId of new Set(state.work.map(w=>w.team_id))){
  const weeks=state.weekPlans.filter(w=>w.team_id===teamId);
  const fatigueRules=await loadTeamFatigueRules(supabase,teamId);
  teamContexts[teamId]={rulesByRider:Object.fromEntries(fullRiders.filter(r=>r.team_id===teamId).map(r=>[r.id,fatigueRules?.forRider(r.id)??null])),...await strictStaff(supabase,teamId),programsOn:weeks.some(w=>weekDaysHaveSessions(w.days))?await isTrainingCellsEnabledForTeam(supabase,teamId):false};
 }
 // Discover every season race independently of normalized loads and current
 // ownership/division. Immutable results/start snapshots survive transfers.
 const raceRows=await fetchAllRowsChunkedIn(seasons.map(s=>s.id),c=>supabase.from('races').select('id,season_id,race_type,stages_completed,status').in('season_id',c).order('id'));
 const raceIds=raceRows.map(r=>r.id);
 const [scheduleRows,profiles,firstRuns]=await Promise.all([
  fetchAllRowsChunkedIn(raceIds,c=>supabase.from('race_stage_schedule').select('race_id,stage_number,game_day,scheduled_at').in('race_id',c).order('race_id').order('stage_number')),
  fetchAllRowsChunkedIn(raceIds,c=>supabase.from('race_stage_profiles').select('race_id,stage_number,profile_type').in('race_id',c).order('race_id').order('stage_number')),
  fetchAllRowsChunkedIn(raceIds,c=>supabase.from('race_simulation_runs').select('race_id,stage_number,entrant_snapshot').eq('stage_number',1).in('race_id',c).order('race_id').order('stage_number')),
 ]);
 const results=[];
 for(let from=0;from<ids.length;from+=100){const chunk=ids.slice(from,from+100);results.push(...await fetchAllRowsChunkedIn(raceIds,c=>supabase.from('race_results').select('id,race_id,stage_number,rider_id,result_type').in('race_id',c).in('rider_id',chunk).order('id')));}
 const {stageBySlot,boundBySlot}=buildHistoricalRaceEvidence({ids,raceRows,scheduleRows,profiles,firstRuns,results,loads:state.loads,through:opts.through,selections:sourceChecks.find(c=>c.table==='race_entry_days').rows});
 const result=await calculateCompensation({state,fullRiders,abilityRows,seasons,teamContexts,stageBySlot,boundBySlot});
 if(!sameSource(sourceChecks,await captureCompensationSource(supabase,scope)))throw new Error('Source changed during calculation; repeat dry-run');
 result.source_checks=sourceChecks;
 const directory=resolve(fileURLToPath(new URL('../../..',import.meta.url)),'balance-internals','6061');
 mkdirSync(directory,{recursive:true});
 writeFileSync(resolve(directory,'compensation-current-plans.json'),JSON.stringify(result,null,2));
 writeFileSync(resolve(directory,'compensation-inputs.json'),JSON.stringify({state,fullRiders,abilityRows,seasons,teamContexts,stageBySlot,boundBySlot},null,2));
 console.log(JSON.stringify(result.summary));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
