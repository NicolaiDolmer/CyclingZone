// #6061 read-only inventory. No apply path, mutation RPC or clock-dependent test default.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchAllRows, fetchAllRowsChunkedIn } from '../../lib/supabasePagination.js';
import { copenhagenDateString } from '../../lib/copenhagenTime.js';

const slotKey=(rider,season,day)=>`${rider}:${season}:${day}`;
const reportRiders=r=>Array.isArray(r?.report?.riders)?r.report.riders:[];
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
   const hasHistory=ticks.length || state.settlements.some(s=>s.rider_id===id) || state.legacyReports.some(r=>reportRiders(r).some(entry=>entry?.rider_id===id));
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

// #7832: one approved case is one team-date. The filter narrows the work rows
// BEFORE the rider list is built, so other dates (already paid or not yet
// approved) never reach the inventory, the source hashes or the payload.
export function selectCaseWork(work,{team,tickDate}={}){
 const quarantined=work.filter(w=>w.quarantined_rider_ids?.length);
 if(!team)return quarantined;
 const selected=quarantined.filter(w=>w.team_id===team&&w.tick_date===tickDate);
 if(!selected.length)throw new Error('No quarantined work row matches --team and --tick-date');
 // A rider quarantined on the same date by another team is an ownership
 // ambiguity the unfiltered inventory would flag; a filtered run must not hide it.
 const riders=new Set(selected.flatMap(w=>w.quarantined_rider_ids));
 const keys=new Set(selected.map(w=>`${w.season_id}:${w.tick_date}`));
 if(quarantined.some(w=>w.team_id!==team&&keys.has(`${w.season_id}:${w.tick_date}`)&&w.quarantined_rider_ids.some(id=>riders.has(id))))throw new Error('Another team quarantined a selected rider on the same date; run the unfiltered review');
 return selected;
}
export async function loadRecoveryInputs(supabase,{through,asOf,team,tickDate}){
 // schema-columns-ok: date-work/settlement/tick columns come from the tested #5928 migrations and were checked through information_schema on 3/10.
 const work=await fetchAllRows(()=>{
  let q=supabase.from('training_date_work').select('team_id,season_id,tick_date,game_days,quarantined_rider_ids,opening_conditions,quarantine_evidence,updated_at').lte('tick_date',through);
  // Date only, not team: the ambiguity check above needs the other owners of that date.
  if(team)q=q.eq('tick_date',tickDate);
  return q.order('season_id').order('tick_date').order('team_id');
 });
 const relevant=selectCaseWork(work,{team,tickDate});const ids=[...new Set(relevant.flatMap(w=>w.quarantined_rider_ids))];const teamIds=[...new Set(relevant.map(w=>w.team_id))];
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
 // #6490: report history comes from rider_training_seen. Per-date reports are
 // already covered by the tick receipts. A rider seen without ticks is looked up
 // by first_run_id (btree pkey) when the earliest source was a report. When the
 // earliest source was a race load (first_run_id NULL), a later legacy report can
 // still exist, so those few riders fall back to an explicit containment query
 // (heap is small; works with or without the GIN). Not seen at all = no report.
 const seen=await read('rider_training_seen','rider_id,first_run_id','rider_id',ids,['rider_id']);
 const withTicks=new Set(ticks.map(t=>t.rider_id));const wanted=new Set(ids);
 const noTicks=seen.filter(s=>!withTicks.has(s.rider_id));
 const runIds=[...new Set(noTicks.map(s=>s.first_run_id).filter(Boolean))];
 const fallbackRiders=noTicks.filter(s=>!s.first_run_id).map(s=>s.rider_id);
 const byId=new Map();
 const runs=await read('training_day_runs','id,team_id,tick_date,report','id',runIds,['id']);
 for(const r of runs)byId.set(r.id,r);
 for(const riderId of fallbackRiders){
  const rows=await fetchAllRows(()=>supabase.from('training_day_runs').select('id,team_id,tick_date,report').contains('report->riders',JSON.stringify([{rider_id:riderId}])).order('id'));
  for(const r of rows)byId.set(r.id,r);
 }
 const legacyReports=[...byId.values()].filter(r=>reportRiders(r).some(entry=>wanted.has(entry?.rider_id)));
 return {through,asOf,work:relevant,riders,conditions,ticks,settlements,loads,plans,weekPlans,legacyReports};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isCalendarDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
export function parseArgs(argv){
 const opts={};for(const arg of argv){if(arg.startsWith('--through='))opts.through=arg.slice(10);else if(arg.startsWith('--as-of='))opts.asOf=arg.slice(8);
  else if(arg.startsWith('--team='))opts.team=arg.slice(7);else if(arg.startsWith('--tick-date='))opts.tickDate=arg.slice(12);else if(arg.startsWith('--case='))opts.caseId=arg.slice(7);
  else throw new Error(`Unsupported argument: ${arg}; this tool is read-only`);}
 if(!opts.through||!opts.asOf)throw new Error('Use --through=YYYY-MM-DD --as-of=ISO_TIMESTAMP');
 // Presence, not truthiness: an empty value (an unset shell variable) must
 // fail validation instead of silently becoming an unfiltered run.
 const hasTeam=opts.team!==undefined,hasDate=opts.tickDate!==undefined;
 if(hasTeam!==hasDate)throw new Error('--team and --tick-date must be given together');
 if(opts.caseId!==undefined&&!hasTeam)throw new Error('--case requires --team and --tick-date');
 if(hasTeam){
  if(!UUID.test(opts.team))throw new Error('--team must be a team uuid');
  if(!isCalendarDate(opts.tickDate))throw new Error('--tick-date must be YYYY-MM-DD');
  if(opts.tickDate>opts.through)throw new Error('--tick-date must not be after --through');
  if(opts.caseId!==undefined&&!/^[a-z0-9][a-z0-9-]{0,63}$/.test(opts.caseId))throw new Error('--case must be lowercase letters, digits and dashes');
  opts.team=opts.team.toLowerCase();
 }
 return opts;
}
// Without a filter the shared directory and fixed names stay as before. A
// filtered run writes into its own case folder so two cases never overwrite.
export function outputDirectory(repoRoot,{team,tickDate,caseId}={}){
 const base=resolve(repoRoot,'balance-internals','6061');
 return team?resolve(base,caseId??`${tickDate}-${team.slice(0,8)}`):base;
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
 if(opts.team)result.case_filter={team_id:opts.team,tick_date:opts.tickDate};
 const directory=outputDirectory(fileURLToPath(new URL('../../..',import.meta.url)),opts);mkdirSync(directory,{recursive:true});
 writeFileSync(resolve(directory,`recovery-${opts.through}.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify({through:result.through,as_of:result.as_of,...result.summary}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
