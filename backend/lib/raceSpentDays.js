import { fetchAllRows } from './supabasePagination.js';

async function preMigrationEvidence(supabase, raceId, riderIds) {
  const { data: race, error: raceError } = await supabase.from('races').select('season_id').eq('id',raceId).single();
  if (raceError) throw new Error(`spent day season lookup: ${raceError.message}`);
  const target=await fetchAllRows(()=>supabase.from('race_stage_schedule').select('game_day').eq('race_id',raceId).order('stage_number'));
  if (!race?.season_id || !target?.length || target.some(row=>!Number.isInteger(row.game_day))) throw new Error('Canonical race-day evidence required');
  const days=target.map(row=>row.game_day);
  const stages=await fetchAllRows(()=>supabase.from('race_stage_schedule').select('race_id,stage_number,game_day,races!inner(season_id)')
    .eq('races.season_id',race.season_id).neq('race_id',raceId).gte('game_day',Math.min(...days)).lte('game_day',Math.max(...days))
    .order('race_id').order('stage_number'));
  const raceIds=[...new Set(stages.map(row=>row.race_id))];
  const owned=new Set(riderIds); const seen=new Map();
  for(let start=0;start<raceIds.length;start+=200) {
    const chunk=raceIds.slice(start,start+200);
    const [results,runs]=await Promise.all([
      fetchAllRows(()=>supabase.from('race_results').select('race_id,stage_number,rider_id').eq('result_type','stage').in('race_id',chunk).order('id')),
      fetchAllRows(()=>supabase.from('race_simulation_runs').select('race_id,stage_number,entrant_snapshot').in('race_id',chunk).order('id')),
    ]);
    const entries=[...results,...runs.flatMap(run=>(run.entrant_snapshot??[]).map(value=>({race_id:run.race_id,stage_number:run.stage_number,rider_id:typeof value==='string'?value:value.rider_id})))];
    for(const entry of entries) {
      if(!owned.has(entry.rider_id)) continue;
      const stage=stages.find(row=>row.race_id===entry.race_id&&row.stage_number===entry.stage_number);
      if(stage) seen.set(`${entry.rider_id}:${entry.race_id}:${stage.game_day}`,{rider_id:entry.rider_id,race_id:entry.race_id,game_day:stage.game_day});
    }
  }
  return [...seen.values()];
}

export async function loadSpentRaceDays({ supabase,raceId,riderIds }) {
  if(!riderIds?.length) return [];
  const {data,error}=await supabase.rpc('find_spent_race_days',{p_race_id:raceId,p_rider_ids:[...new Set(riderIds)]});
  // Backend deploy precedes auto-migrate. During that short interval use the
  // existing immutable/result evidence, never treat a missing RPC as a free day.
  if(error?.code==='PGRST202' && `${error.message} ${error.details}`.includes('find_spent_race_days')) {
    return preMigrationEvidence(supabase,raceId,riderIds);
  }
  if(error) throw new Error(`spent race-day lookup failed: ${error.message}`);
  if(data!=null && !Array.isArray(data)) throw new Error('Invalid spent race-day lookup response');
  return data??[];
}

export function spentRaceBindingWindows(rows) {
  const groups=new Map();
  for(const row of rows) {
    const key=`${row.race_id}:${row.game_day}`;
    if(!groups.has(key)) groups.set(key,{raceId:row.race_id,riderIds:new Set(),days:new Set()});
    const group=groups.get(key);group.riderIds.add(row.rider_id);group.days.add(row.game_day);
  }
  return [...groups.values()].map(group=>({raceId:group.raceId,riderIds:[...group.riderIds],
    window:{start:Math.min(...group.days),end:Math.max(...group.days),days:[...group.days]}}));
}
