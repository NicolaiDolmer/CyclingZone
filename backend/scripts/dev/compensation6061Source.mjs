// #6061/#6129 compare-before-write evidence. The database computes one hash per
// source table over explicit, relevant columns (never presence/UI columns), and
// the writer recomputes the same function under lock. Raw rows stay local.
import {createHash} from 'node:crypto';

export const SOURCE_HASH_FUNCTION='training_compensation_6061_source_hashes';
export const SOURCE_HASH_TABLES=Object.freeze(['app_config','race_entry_days','race_results','race_simulation_runs','race_stage_profiles','race_stage_schedule','races','riders','seasons','staff_derived_abilities','team_facilities','team_staff','team_training_rules','teams','training_condition_settlements','training_date_work','training_group_members','training_groups','training_plans','training_race_loads','training_rider_ticks','training_week_plans','users']);
// The SQL writer refuses anything larger; the current plan is far below it.
export const MAX_APPLY_PAYLOAD_BYTES=2*1024*1024;
const HEX64=/^[a-f0-9]{64}$/;
const sortedUnique=values=>[...new Set(values.filter(Boolean))].sort();

export function normalizeScope({ids,teamIds,seasonIds}){
 return {rider_ids:sortedUnique(ids??[]),team_ids:sortedUnique(teamIds??[]),season_ids:sortedUnique(seasonIds??[])};
}

export function assertSourceHashes(hashes){
 const keys=Object.keys(hashes??{}).sort();
 if(JSON.stringify(keys)!==JSON.stringify([...SOURCE_HASH_TABLES].sort())||!keys.every(k=>HEX64.test(hashes[k])))throw new Error('Complete source hashes required');
 return hashes;
}

export async function captureSourceHashes(supabase,scope,through){
 const {data,error}=await supabase.rpc(SOURCE_HASH_FUNCTION,{p_rider_ids:scope.rider_ids,p_team_ids:scope.team_ids,p_season_ids:scope.season_ids,p_through:through});
 if(error)throw new Error('Source hash capture failed; nothing was written');
 return assertSourceHashes(data);
}

export function changedSourceTables(a,b){
 return SOURCE_HASH_TABLES.filter(t=>a?.[t]!==b?.[t]);
}

// Exactly what the atomic writer needs: plans, scope and per-table hashes.
export function buildApplyPayload(result,{scope,sourceHashes}){
 if(!result?.plans?.length)throw new Error('Verified compensation plan required');
 assertSourceHashes(sourceHashes);
 const plans=result.plans.map(p=>{
  const perDay=new Map((p.perDay??[]).map(d=>[d.key,d]));
  return {rider_id:p.rider_id,team_id:p.team_id,season_id:p.season_id,current_condition:p.current_condition??null,expected_abilities:p.expected_abilities,patch:p.patch??{},
   days:p.days.map(d=>({key:d.key,gameDay:d.gameDay,tickDate:d.tickDate,kind:d.kind,progress:perDay.get(d.key)?.progress??null,gains:perDay.get(d.key)?.gains??{}}))};
 });
 return {issue:6061,policy:result.policy,through:result.through,calculation_hash:result.source_hash,source_scope:scope,source_hashes:Object.fromEntries(SOURCE_HASH_TABLES.map(t=>[t,sourceHashes[t]])),
  summary:{riders:plans.length,rider_days:plans.reduce((n,p)=>n+p.days.length,0)},plans};
}

export function serializeApplyPayload(payload){
 const raw=JSON.stringify(payload);const bytes=Buffer.byteLength(raw,'utf8');
 if(bytes>MAX_APPLY_PAYLOAD_BYTES)throw new Error('Apply payload too large; refuse to send');
 return {raw,bytes,sha256:createHash('sha256').update(raw).digest('hex')};
}
