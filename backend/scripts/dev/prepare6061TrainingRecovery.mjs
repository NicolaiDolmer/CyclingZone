// #6061 read-only inventory. No apply path, mutation RPC or clock-dependent test default.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchAllRows, fetchAllRowsChunkedIn } from '../../lib/supabasePagination.js';
import { copenhagenDateString } from '../../lib/copenhagenTime.js';

const slotKey=(rider,season,day)=>`${rider}:${season}:${day}`;
export function buildRecoveryManifest(state) {
 const asOf=new Date(state.asOf);
 if(!Number.isFinite(asOf.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(state.through??'') || state.through>=copenhagenDateString(asOf)) throw new Error('Explicit closed date cutoff and valid asOf required');
 const candidates=[];const lost=new Set();const byDate=new Map();const owners=new Map();
 const work=state.work.filter(w=>w.tick_date<=state.through);
 for(const w of work) for(const id of w.quarantined_rider_ids??[]){
  const key=`${id}:${w.season_id}:${w.tick_date}`;
  if(!owners.has(key)) owners.set(key,new Set());owners.get(key).add(w.team_id);
 }
 for(const w of work){
  if(w.game_days.length!==5 || new Set(w.game_days).size!==5 || w.game_days.some(d=>!Number.isInteger(d))) throw new Error('Five unique integer race days required');
  for(const id of w.quarantined_rider_ids??[]){
   const rider=state.riders.find(r=>r.id===id);const condition=state.conditions.find(r=>r.rider_id===id);
   const ticks=state.ticks.filter(t=>t.rider_id===id);
   const blockers=[];
   if(!rider?.team_id || rider.is_retired) blockers.push('current_ownership_unavailable');
   if(rider?.team_id && rider.team_id!==w.team_id) blockers.push('ownership_changed');
   if(owners.get(`${id}:${w.season_id}:${w.tick_date}`).size>1) blockers.push('multiple_date_owners');
   if(!w.opening_conditions?.[id]) blockers.push('missing_opening_condition');
   const days=w.game_days.filter(day=>!ticks.some(t=>t.season_id===w.season_id&&t.game_day===day));
   for(const day of days){const key=slotKey(id,w.season_id,day);lost.add(key);if(!byDate.has(w.tick_date))byDate.set(w.tick_date,new Set());byDate.get(w.tick_date).add(key);}
   const hasHistory=ticks.length || state.settlements.some(s=>s.rider_id===id) || state.legacyReports.some(r=>r.report?.riders?.some(entry=>entry.rider_id===id));
   const recorded=state.loads.filter(l=>l.rider_id===id&&l.season_id===w.season_id&&l.tick_date===w.tick_date&&days.includes(l.game_day));
   if(recorded.some(l=>l.consumed_at!=null)) blockers.push('consumed_race_load_without_receipt');
   const plans=state.plans.filter(p=>p.rider_id===id&&p.team_id===w.team_id);
   const weeks=state.weekPlans.filter(p=>p.team_id===w.team_id&&(p.rider_id===id||p.rider_id==null));
   // Current plan/staff rows are not immutable historical inputs. Inventory
   // keeps them for owner review but cannot certify a retrospective gain.
   blockers.push('missing_historical_training_inputs');
   const ownershipReview=blockers.some(b=>['ownership_changed','multiple_date_owners','current_ownership_unavailable'].includes(b));
   const category=ownershipReview?'ownership_review':condition?'existing_state_review':hasHistory?'missing_state_with_history_review':'first_use_recovery_candidate';
   candidates.push({rider_id:id,team_id:w.team_id,season_id:w.season_id,tick_date:w.tick_date,category,missing_game_days:days,recorded_race_days:recorded,blockers,current_rider:rider??null,current_condition:condition??null,current_plans:plans,current_week_plans:weeks,opening_condition:w.opening_conditions?.[id]??null});
  }
 }
 const summary={riders:new Set(candidates.map(c=>c.rider_id)).size,teams:new Set(candidates.map(c=>c.team_id)).size,rider_days:lost.size,first_use_candidates:new Set(candidates.filter(c=>c.category==='first_use_recovery_candidate'&&!c.blockers.includes('current_ownership_unavailable')).map(c=>c.rider_id)).size,by_date:[...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,days])=>({date,rider_days:days.size})),apply_ready:false};
 const source_fingerprint=createHash('sha256').update(JSON.stringify(state)).digest('hex');
 return {issue:6061,as_of:asOf.toISOString(),through:state.through,apply_ready:false,source_fingerprint,summary,candidates,source_snapshot:state};
}

export async function loadRecoveryInputs(supabase,{through,asOf}){
 // schema-columns-ok: date-work/settlement/tick columns come from the tested #5928 migrations and were checked through information_schema on 3/10.
 const work=await fetchAllRows(()=>supabase.from('training_date_work').select('team_id,season_id,tick_date,game_days,quarantined_rider_ids,opening_conditions,quarantine_evidence,updated_at').lte('tick_date',through).order('season_id').order('tick_date').order('team_id'));
 const relevant=work.filter(w=>w.quarantined_rider_ids?.length);const ids=[...new Set(relevant.flatMap(w=>w.quarantined_rider_ids))];const teamIds=[...new Set(relevant.map(w=>w.team_id))];
 const read=(table,columns,inColumn,wanted,orders)=>fetchAllRowsChunkedIn(wanted,chunk=>{
  let q=supabase.from(table).select(columns).in(inColumn,chunk);for(const col of orders)q=q.order(col);return q;
 });
 const [riders,conditions,ticks,settlements,loads,plans,weekPlans]=await Promise.all([
  read('riders','id,team_id,is_retired,created_at,acquired_at','id',ids,['id']),
  read('rider_condition','*','rider_id',ids,['rider_id']),
  read('training_rider_ticks','rider_id,season_id,game_day,tick_date,team_id,report','rider_id',ids,['rider_id','season_id','game_day']),
  read('training_condition_settlements','*','rider_id',ids,['rider_id','season_id','tick_date']),
  read('training_race_loads','*','rider_id',ids,['rider_id','race_id','stage_number']),
  read('training_plans','*','team_id',teamIds,['id']),
  read('training_week_plans','*','team_id',teamIds,['id']),
 ]);
 // GIN-indexed containment catches legacy reports even under a previous owner.
 const legacyReports=[];
 for(const id of ids)legacyReports.push(...await fetchAllRows(()=>supabase.from('training_day_runs').select('id,team_id,tick_date,report').contains('report->riders',JSON.stringify([{rider_id:id}])).order('id')));
 return {through,asOf,work:relevant,riders,conditions,ticks,settlements,loads,plans,weekPlans,legacyReports};
}
export function parseArgs(argv){
 const opts={};for(const arg of argv){if(arg.startsWith('--through='))opts.through=arg.slice(10);else if(arg.startsWith('--as-of='))opts.asOf=arg.slice(8);else throw new Error(`Unsupported argument: ${arg}; this tool is read-only`);}
 if(!opts.through||!opts.asOf)throw new Error('Use --through=YYYY-MM-DD --as-of=ISO_TIMESTAMP');return opts;
}
async function main(){
 const opts=parseArgs(process.argv.slice(2));
 // Validate closed cutoff before obtaining credentials or reading any data.
 buildRecoveryManifest({...opts,work:[],riders:[],conditions:[],ticks:[],settlements:[],loads:[],plans:[],weekPlans:[],legacyReports:[]});
 const {createClient}=await import('@supabase/supabase-js');
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_KEY)throw new Error('Supabase credentials required');
 const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
 const result=buildRecoveryManifest(await loadRecoveryInputs(supabase,opts));
 result.captured_at=new Date().toISOString(); // observation time, distinct from the explicit cutoff evaluation clock
 const directory=resolve(fileURLToPath(new URL('../../..',import.meta.url)),'balance-internals','6061');mkdirSync(directory,{recursive:true});
 writeFileSync(resolve(directory,`recovery-${opts.through}.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify({through:result.through,as_of:result.as_of,...result.summary}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
