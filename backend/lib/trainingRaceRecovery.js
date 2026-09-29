// Recovery from authoritative stored race condition snapshots only.
import { copenhagenDateString } from './copenhagenTime.js';
import { fetchAllRows } from './supabasePagination.js';
import { isTrainingConditionPerDateEnabled } from './trainingDateConditionFlag.js';
import { recomputeSeasonRaceDays } from './seasonRaceDays.js';
import { refreshRankingMatviewsSafe } from './refreshRankingMatviews.js';
import { flushDeferredTransfersForRace } from './stageRaceTransferDefer.js';
import { flushDeferredAcademySigningsForRace } from './academySigningDefer.js';
import { notifyTeamOwner as notifyOwner } from './notificationService.js';

/** Dry-run by default. Never calls a simulator or a condition/injury writer. */
export async function recoverRecordedRaceLoads({supabase,raceId,stageNumbers=null,apply=false,now=new Date()}) {
  if(!raceId||!supabase?.from) throw new Error('Race and Supabase client required');
  const enabled=await isTrainingConditionPerDateEnabled(supabase);
  if(!enabled) {
    const plan={raceId,dryRun:!apply,canApply:false,reason:'flag_off',stages:[],blockers:['Normalized condition flag is off']};
    if(apply){const error=new Error('Recorded race recovery blocked: normalized condition flag is off');error.plan=plan;throw error;}
    return plan;
  }
  const [{data:race,error:raceError},{data:schedule,error:scheduleError},{data:runs,error:runError}]=await Promise.all([
    supabase.from('races').select('id,season_id,status,stages_completed,finalize_state').eq('id',raceId).maybeSingle(),
    fetchAllRows(()=>supabase.from('race_stage_schedule').select('stage_number,game_day,scheduled_at').eq('race_id',raceId).order('stage_number')).then(data=>({data,error:null})),
    // schema-columns-ok: owner-approved temporary annotation; date.sql in this PR adds condition_load_snapshot jsonb, verified by actual SQL tests. The flag-off guard above prevents this read before activation; remove after post-apply snapshot refresh (#5928).
    supabase.from('race_simulation_runs').select('stage_number,entrant_snapshot,condition_load_snapshot').eq('race_id',raceId).order('stage_number'),
  ]);
  if(raceError||scheduleError||runError) throw new Error(`Recovery inputs: ${(raceError??scheduleError??runError).message}`);
  if(!race) throw new Error('Recovery race not found');
  const selected=stageNumbers==null?[...new Set((runs??[]).map(run=>Number(run.stage_number)))]:[...new Set(stageNumbers.map(Number))];
  if(!selected.length||selected.some(stage=>!Number.isInteger(stage)||stage<1)) throw new Error('Explicit stored stages required for recovery');
  selected.sort((a,b)=>a-b);
  const ledger=await fetchAllRows(()=>supabase.from('training_race_loads').select('rider_id,stage_number,load,game_day,tick_date,reconciliation_required')
    .eq('race_id',raceId).in('stage_number',selected).order('rider_id').order('stage_number'));
  const blockers=enabled?[]:['Normalized condition ownership must be enabled before recovery'];
  const stages=[];
  for(const stageNumber of selected) {
    const stageBlockers=[];
    const stageRuns=(runs??[]).filter(run=>Number(run.stage_number)===stageNumber);
    const stageSchedule=(schedule??[]).filter(row=>Number(row.stage_number)===stageNumber);
    const run=stageRuns[0];const scheduled=stageSchedule[0];
    const starterIds=Array.isArray(run?.entrant_snapshot)?run.entrant_snapshot.map(entry=>typeof entry==='string'?entry:entry?.rider_id):[];
    const loads=run?.condition_load_snapshot;
    if(stageRuns.length!==1||!starterIds.length||starterIds.some(id=>typeof id!=='string'||!id)||new Set(starterIds).size!==starterIds.length) stageBlockers.push('original immutable starter snapshot is missing or ambiguous');
    if(!Array.isArray(loads)||loads.length!==starterIds.length||new Set(loads.map(row=>row.rider_id)).size!==starterIds.length||loads.some(row=>!starterIds.includes(row.rider_id)||!Number.isFinite(Number(row.load))||Number(row.load)<0)) stageBlockers.push('original condition_load_snapshot with stage effort is required; current rider state is not a substitute');
    const validDate=stageSchedule.length===1&&Number.isInteger(scheduled?.game_day)&&scheduled?.scheduled_at&&Number.isFinite(Date.parse(scheduled.scheduled_at));
    if(!validDate) stageBlockers.push('one canonical stage date and game day are required');
    const state=race.finalize_state;
    const resultWritten=race.status==='completed'||Number(race.stages_completed)>=stageNumber||(Number(state?.stage_number)===stageNumber&&state?.done?.includes('write'));
    if(!resultWritten) stageBlockers.push('durable result-write or completed-stage evidence is missing');
    const tickDate=validDate?copenhagenDateString(new Date(scheduled.scheduled_at)):null;
    const existing=ledger.filter(row=>Number(row.stage_number)===stageNumber);
    if(Array.isArray(loads)&&existing.some(row=>!loads.some(load=>load.rider_id===row.rider_id&&Number(load.load)===Number(row.load))||row.tick_date!==tickDate||Number(row.game_day)!==scheduled?.game_day)) stageBlockers.push('existing ledger conflicts with the original snapshot/calendar');
    const missing=starterIds.filter(id=>!existing.some(row=>row.rider_id===id));
    let reconciliationCount=0;
    if(tickDate&&missing.length) {
      for(let index=0;index<missing.length;index+=500) {
        const {data:settlements,error}=await supabase.from('training_condition_settlements').select('rider_id,status')
          .eq('season_id',race.season_id).eq('tick_date',tickDate).in('rider_id',missing.slice(index,index+500));
        if(error) throw new Error(`Recovery settlements: ${error.message}`);
        if((settlements??[]).some(row=>row.status!=='needs_reconciliation')) stageBlockers.push('missing load belongs to an already complete settlement; explicit reconciliation evidence is required');
        reconciliationCount+=(settlements??[]).filter(row=>row.status==='needs_reconciliation').length;
      }
    }
    blockers.push(...stageBlockers.map(reason=>`Stage ${stageNumber}: ${reason}`));
    stages.push({stageNumber,tickDate,gameDay:scheduled?.game_day??null,riderCount:starterIds.length,recordedCount:existing.length,missingCount:missing.length,lateReconciliationCount:reconciliationCount,blockers:stageBlockers});
  }
  const result={raceId,dryRun:!apply,canApply:blockers.length===0,stages,blockers,
    scope:'Recorded loads and the durable fatigue step only; no race re-simulation, condition repair, incidents, board or notifications.',
    finalizationHeld:race.status!=='completed'};
  if(!apply) return result;
  if(blockers.length){const error=new Error(`Recorded race recovery blocked: ${blockers.join('; ')}`);error.plan=result;throw error;}
  let expectedState=race.finalize_state??null;
  const applied=[];
  for(const stage of stages) {
    const {data,error}=await supabase.rpc('recover_training_race_load_stage',{
      p_race_id:raceId,p_stage_number:stage.stageNumber,p_expected_finalize_state:expectedState,p_now:now.toISOString(),
    });
    if(error) throw new Error(`Recorded race recovery stage ${stage.stageNumber}: ${error.message}. Re-run the dry-run; already restored loads are idempotent.`);
    expectedState=data.finalize_state??null;
    applied.push({stageNumber:stage.stageNumber,recorded:data.recorded,markerUpdated:data.marker_updated});
  }
  return {...result,applied,finalizeState:expectedState,finalizationHeld:!!expectedState?.condition_recovery_hold};
}

/** Complete only the tail whose non-replayable steps have durable original proofs. */
export async function completeRecordedRace({supabase,raceId,apply=false,now=new Date(),effects={}}) {
  const loadPlan=await recoverRecordedRaceLoads({supabase,raceId,now});
  if(loadPlan.reason==='flag_off') {
    const plan={...loadPlan,dryRun:!apply,mode:'complete_stored_results'};
    if(apply){const error=new Error('Stored race completion blocked: normalized condition flag is off');error.plan=plan;throw error;}
    return plan;
  }
  const [{data:race,error},{data:runs,error:runError},{data:schedule,error:scheduleError},results]=await Promise.all([
    supabase.from('races').select('*').eq('id',raceId).maybeSingle(),
    supabase.from('race_simulation_runs').select('stage_number,entrant_snapshot').eq('race_id',raceId),
    fetchAllRows(()=>supabase.from('race_stage_schedule').select('stage_number').eq('race_id',raceId).order('stage_number')).then(data=>({data,error:null})),
    fetchAllRows(()=>supabase.from('race_results').select('id,stage_number,result_type').eq('race_id',raceId).order('id')),
  ]);
  if(error||runError||scheduleError) throw new Error(`Stored completion inputs: ${(error??runError??scheduleError).message}`);
  const alreadyComplete=race.status==='completed'&&race.finalize_state==null;
  const blockers=[...loadPlan.blockers];
  const count=Number(race.stages)||schedule.length;
  const done=race.finalize_state?.done??[];
  if(!alreadyComplete) {
    for(const step of ['write','enrichment','standings','board','notify']) if(!done.includes(step)) {
      const evidence=step==='board'?'original board before-state/evaluation or durable completion proof; view-only events do not prove a partial write was absent'
        :step==='notify'?'original delivery/outbox receipt or durable completion proof; resending can duplicate historical messages'
          :`original ${step} completion proof`;
      blockers.push(`Cannot replay ${step}: require ${evidence}`);
    }
    if(Number(race.finalize_state?.stage_number)!==count) blockers.push('Final-stage durable completion marker is required');
    if(Number(race.stages_completed)<count) blockers.push('Not all original stages have durable result writes');
  }
  if(schedule.length!==count||loadPlan.stages.length!==count) blockers.push('Every canonical stage requires an original run snapshot');
  for(const scheduled of schedule) if(!results.some(row=>Number(row.stage_number)===Number(scheduled.stage_number)&&(row.result_type==='stage'||row.result_type==='gc'))) blockers.push(`Stage ${scheduled.stage_number}: persisted original result rows are missing`);
  if(!results.some(row=>row.result_type==='gc'&&Number(row.stage_number)===count)) blockers.push('Original final GC is required; recovery never derives a replacement race result');
  const originalRiderIds=[...new Set(runs.flatMap(run=>Array.isArray(run.entrant_snapshot)?run.entrant_snapshot.map(entry=>typeof entry==='string'?entry:entry?.rider_id):[]))];
  const plan={...loadPlan,dryRun:!apply,canApply:blockers.length===0,blockers,mode:'complete_stored_results',alreadyComplete,
    scope:'Restores recorded loads; preserves original results, board and notification effects. Completes idempotent counters, ranking refresh and pending participant flushes, then clears the hold.'};
  if(!apply) return plan;
  if(blockers.length){const failure=new Error(`Stored race completion blocked: ${blockers.join('; ')}`);failure.plan=plan;throw failure;}
  const recovered=await recoverRecordedRaceLoads({supabase,raceId,apply:true,now});
  if(alreadyComplete) return {...plan,raceComplete:true,alreadyComplete:true,loadRecovery:recovered.applied};
  const {data:prepared,error:prepareError}=await supabase.rpc('prepare_recorded_race_completion',{
    p_race_id:raceId,p_expected_finalize_state:recovered.finalizeState,p_now:now.toISOString(),
  });
  if(prepareError) throw new Error(`Stored completion preparation: ${prepareError.message}`);
  if(prepared.already_complete) return {...plan,raceComplete:true,alreadyComplete:true};
  // Each operation is repeat-safe. A failure retains the durable hold and the
  // prepared marker; rerunning --complete cannot repeat board/race notifications.
  await (effects.recomputeRaceDays??recomputeSeasonRaceDays)({supabase,seasonId:race.season_id});
  const notifyTeamOwner=effects.notifyTeamOwner??((teamId,type,title,message,relatedId=null,metadata=null)=>notifyOwner({supabase,teamId,type,title,message,relatedId,metadata}));
  const transfers=await (effects.flushTransfers??flushDeferredTransfersForRace)(supabase,race,{originalRiderIds,notifyTeamOwner,now});
  const academy=await (effects.flushAcademy??flushDeferredAcademySigningsForRace)(supabase,race,{originalRiderIds,notifyTeamOwner});
  const refreshed=await (effects.refreshRankings??refreshRankingMatviewsSafe)(supabase);
  if(refreshed!==true) throw new Error('Stored completion ranking refresh failed; hold retained for idempotent retry');
  const {error:finishError}=await supabase.rpc('finish_recorded_race_completion',{
    p_race_id:raceId,p_expected_finalize_state:prepared.finalize_state,p_now:now.toISOString(),
  });
  if(finishError) throw new Error(`Stored completion finish: ${finishError.message}`);
  return {...plan,raceComplete:true,finalizationHeld:false,loadRecovery:recovered.applied,transfers,academy};
}
