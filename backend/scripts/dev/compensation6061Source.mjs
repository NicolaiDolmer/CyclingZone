import {fetchAllRowsChunkedIn} from '../../lib/supabasePagination.js';
// Private compare-before-write evidence, including phantom inserts. Never print rows.
export async function captureCompensationSource(supabase,{ids,teamIds,seasonIds}){
 const checks=[];
 const primaryKeys={teams:['id'],users:['id'],app_config:['key'],riders:['id'],seasons:['id'],training_race_loads:['rider_id','race_id','stage_number'],training_rider_ticks:['rider_id','season_id','game_day'],training_condition_settlements:['rider_id','season_id','tick_date'],training_date_work:['team_id','season_id','tick_date'],training_plans:['id'],training_week_plans:['id'],team_training_rules:['id'],training_groups:['id'],training_group_members:['rider_id'],team_facilities:['id'],team_staff:['id'],staff_derived_abilities:['staff_id'],races:['id'],race_stage_schedule:['race_id','stage_number'],race_stage_profiles:['id'],race_simulation_runs:['id'],race_results:['id'],race_entry_days:['race_id','rider_id','game_day']};
 async function read(table,key,values){
  const rows=await fetchAllRowsChunkedIn(values,c=>{let q=supabase.from(table).select('*').in(key,c);for(const col of primaryKeys[table])q=q.order(col);return q;});
  checks.push({table,key,values,rows});return rows;
 }
 const teams=await read('teams','id',teamIds);await read('users','id',teams.map(t=>t.user_id).filter(Boolean));
 await read('app_config','key',['training_condition_per_date','training_tick_per_race_day','race_day_development_enabled','race_day_engine_enabled','training_programs','training_program_cells','training_fatigue_rules','training_groups']);
 await read('riders','id',ids);await read('seasons','id',seasonIds);
 for(const table of ['training_race_loads','training_rider_ticks','training_condition_settlements'])await read(table,'rider_id',ids);
 for(const table of ['training_date_work','training_plans','training_week_plans','team_training_rules','training_groups','training_group_members','team_facilities'])await read(table,'team_id',teamIds);
 const staff=await read('team_staff','team_id',teamIds);await read('staff_derived_abilities','staff_id',staff.map(s=>s.id));
 const races=await read('races','season_id',seasonIds,'id');const raceIds=races.map(r=>r.id);
 for(const table of ['race_stage_schedule','race_stage_profiles','race_simulation_runs'])await read(table,'race_id',raceIds);
 await read('race_results','rider_id',ids,'id');
 await read('race_entry_days','rider_id',ids);
 return checks;
}
export function sameSource(a,b){
 const normalize=checks=>checks.map(c=>({...c,rows:c.rows.map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))))).sort()}));
 return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}
