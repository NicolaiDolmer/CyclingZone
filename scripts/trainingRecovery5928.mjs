// Offline proposal only. No credentials, network client or production apply mode.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTeamTrainingDay } from '../backend/lib/dailyTrainingEngine.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const neutral = id => ({rider_id:id,form:50,fatigue:0,injured_until:null,injury_cause:null,
  injury_end_game_day:null,injury_season_id:null,injury_race_days_left:null});
const requiredTables = ['training_date_work','riders','rider_derived_abilities','training_plans',
  'training_week_plans','team_facilities','team_staff','staff_derived_abilities','finance_transactions',
  'app_config','teams','users','races','race_stage_schedule','race_results','race_stage_profiles',
  'race_entry_days','race_simulation_runs','training_race_loads','rider_condition','training_day_runs','training_rider_ticks'];

const approvedScope=Object.freeze({riders:84,teams:17,eligible:75,excluded:9});
export function validateSnapshot(snapshot, scope=approvedScope) {
  check(snapshot.tick_date==='2026-09-29','Only the approved historical date is supported');
  check(Number.isFinite(Date.parse(snapshot.exported_at)),'Explicit snapshot time required');
  const t=snapshot.tables;
  for(const name of requiredTables) check(Array.isArray(t?.[name]),`Missing snapshot table ${name}`);
  for(const key of ['training_condition_per_date','training_tick_per_race_day','race_day_engine_enabled','race_day_development_enabled','training_programs']) {
    const flags=t.app_config.filter(f=>f.key===key);
    check(flags.length===1 && ['on','off','beta',true,false].includes(flags[0].value),`Missing/invalid flag evidence ${key}`);
    if(key!=='training_programs') check(flags[0].value==='on' || flags[0].value===true,`Unexpected historical flag ${key}`);
  }
  check(t.training_date_work.length===scope.teams,'Recovery scope team count changed');
  const eligible=[],excluded=[],seen=new Set();
  for(const w of t.training_date_work) {
    check(w.tick_date===snapshot.tick_date && Number.isFinite(Date.parse(w.created_at)),'Invalid frozen date');
    check(w.game_days?.length===5 && new Set(w.game_days).size===5 && w.game_days.every(Number.isInteger),'Complete five-game-day date required');
    for(const id of w.quarantined_rider_ids) {
      check(!seen.has(id),`Duplicate rider ${id}`);seen.add(id);
      const r=t.riders.find(r=>r.id===id);
      check(r && r.team_id===w.team_id && r.is_retired===false && w.expected_rider_ids.includes(id),`Unsafe owner/roster ${id}`);
      check(t.rider_derived_abilities.filter(a=>a.rider_id===id).length===1,`Missing/duplicate abilities ${id}`);
      const evidence=snapshot.evidence?.filter(e=>e.rider_id===id);
      check(evidence?.length===1,`Missing/duplicate evidence ${id}`);
      for(const k of ['condition_count','receipt_count','settlement_count','race_load_count','race_result_count','canonical_report_count','history_after_work_count']) {
        check(evidence[0][k]===0,`Unsafe evidence ${id}: ${k}`);
      }
      check(!t.rider_condition.some(c=>c.rider_id===id),'Existing condition cannot be initialized');
      const plans=t.training_plans.filter(p=>p.rider_id===id && p.team_id===w.team_id && p.season_id===w.season_id);
      check(plans.length<=1,`Duplicate plan ${id}`);
      if(plans.some(p=>!p.updated_at || p.updated_at>w.created_at)) {excluded.push({rider_id:id,team_id:w.team_id,reason:'plan_changed'});continue;}
      eligible.push({rider_id:id,team_id:w.team_id});
    }
    for(const p of t.training_week_plans.filter(p=>p.team_id===w.team_id)) check(p.updated_at && p.updated_at<=w.created_at,'Week program changed after historical work');
    for(const f of t.team_facilities.filter(f=>f.team_id===w.team_id && f.track==='training')) check(f.updated_at && f.updated_at<=w.created_at,'Facility changed after historical work');
    for(const s of t.team_staff.filter(s=>s.team_id===w.team_id && s.role==='training')) {
      check(s.created_at && s.created_at<=w.created_at,'Training staff hired after historical work');
      for(const a of t.staff_derived_abilities.filter(a=>a.staff_id===s.id)) check(a.updated_at && a.updated_at<=w.created_at,'Training staff abilities changed after historical work');
      if(s.status==='fired' && s.fired_season===snapshot.season_number) {
        const keys=[`staff_severance:${s.team_id}:training:${s.id}`,`staff_release_severance:${s.team_id}:${s.id}`];
        const audit=t.finance_transactions.filter(f=>f.team_id===s.team_id && keys.includes(f.idempotency_key));
        check(audit.length===1 && audit[0].created_at<=w.created_at,'Training staff firing audit unknown or after work');
      } else check(s.status==='active' || (s.status==='fired' && Number.isInteger(s.fired_season) && s.fired_season<snapshot.season_number),'Unknown training staff status');
    }
  }
  check(seen.size===scope.riders,'Recovery scope rider count changed');
  check(eligible.length===scope.eligible && excluded.length===scope.excluded,'Approved eligible/excluded scope changed');
  if(snapshot.manifest) {
    check(JSON.stringify([...snapshot.manifest.eligible].sort())===JSON.stringify(eligible.map(r=>r.rider_id).sort()),'Eligible manifest mismatch');
    check(JSON.stringify([...snapshot.manifest.excluded].sort())===JSON.stringify(excluded.map(r=>r.rider_id).sort()),'Excluded manifest mismatch');
  } else check(scope!==approvedScope,'Approved recovery manifest required');
  const programsFlag=t.app_config.find(f=>f.key==='training_programs').value;
  if(programsFlag==='beta') {
    for(const w of t.training_date_work) {
      if(!t.training_week_plans.some(p=>p.team_id===w.team_id && JSON.stringify(p.days).includes('"session"')))continue;
      const team=t.teams.filter(r=>r.id===w.team_id);
      check(team.length===1,'Missing program owner team evidence');
      if(team[0].user_id) check(t.users.filter(u=>u.id===team[0].user_id).length===1,'Missing program owner beta evidence');
    }
  }
  return {eligible,excluded};
}

// These are read operations over the exported copy, never a live Supabase client.
// Errors remain latched: production's deliberate best-effort lookups cannot hide
// missing export tables or an unsupported adapter operation during a proposal.
export function createOfflineClient(tables) {
  const state=structuredClone(tables),commits=[],errors=[];
  const fail=message=>{const e=new Error(message);errors.push(e);throw e;};
  function from(table) {
    if(!Array.isArray(state[table])) return fail(`Unsupported snapshot table ${table}`);
    let filters=[],orders=[],cap=null,single=false;
    const q={
      select(){return q;},
      eq(k,v){filters.push(r=>r[k]===v);return q;},
      in(k,v){filters.push(r=>v.includes(r[k]));return q;},
      is(k,v){filters.push(r=>r[k]===v);return q;},
      gte(k,v){filters.push(r=>r[k]>=v);return q;},
      lte(k,v){filters.push(r=>r[k]<=v);return q;},
      order(k,{ascending=true}={}){orders.push([k,ascending]);return q;},
      limit(n){cap=n;return q;},
      maybeSingle(){single=true;return q;},
      update(){return fail('Direct mutation forbidden');},insert(){return fail('Direct mutation forbidden');},
      upsert(){return fail('Direct mutation forbidden');},delete(){return fail('Direct mutation forbidden');},
      then(resolve,reject){return Promise.resolve().then(()=>{
        let data=state[table].filter(r=>filters.every(f=>f(r)));
        if(orders.length) data.sort((a,b)=>{for(const [k,asc] of orders){if(a[k]!==b[k])return (a[k]<b[k]?-1:1)*(asc?1:-1);}return 0;});
        if(cap!=null)data=data.slice(0,cap);
        if(single && data.length>1) return fail(`Ambiguous single row ${table}`);
        return {data:structuredClone(single?(data[0]??null):data),error:null};
      }).then(resolve,reject);},
    };return q;
  }
  function rpc(name,p) {
    const work=state.training_date_work.find(w=>w.team_id===p.p_team_id && w.season_id===p.p_season_id && w.tick_date===p.p_tick_date);
    if(!work) return fail('Offline frozen work missing');
    if(name==='register_training_date_work') return Promise.resolve({data:structuredClone(work),error:null});
    if(name!=='commit_training_date_tick') return fail(`Unsupported offline RPC ${name}`);
    const ids=new Set(work.expected_rider_ids);
    const riders=p.p_report.riders;
    check(riders.length===ids.size && riders.every(r=>ids.has(r.rider_id)),'Commit outside approved replay scope');
    check(!state.training_rider_ticks.some(r=>ids.has(r.rider_id)&&r.game_day===p.p_game_day),'Duplicate offline receipt');
    check(work.game_days.filter(g=>g<p.p_game_day).every(g=>state.training_rider_ticks.filter(r=>ids.has(r.rider_id)&&r.game_day===g).length===ids.size),'Earlier offline receipts missing');
    for(const a of p.p_abilities){check(ids.has(a.riderId),'Ability write outside scope');Object.assign(state.rider_derived_abilities.find(r=>r.rider_id===a.riderId),structuredClone(a.patch));}
    for(const c of p.p_conditions){check(ids.has(c.rider_id)&&p.p_game_day===work.game_days.at(-1),'Unexpected condition write');Object.assign(state.rider_condition.find(r=>r.rider_id===c.rider_id),structuredClone(c));}
    for(const r of riders) state.training_rider_ticks.push({rider_id:r.rider_id,team_id:p.p_team_id,season_id:p.p_season_id,game_day:p.p_game_day,tick_date:p.p_tick_date,report:structuredClone(r)});
    commits.push(structuredClone(p));
    return Promise.resolve({data:{already_ran:false,report:structuredClone(p.p_report),work_status:'offline_only'},error:null});
  }
  return {from,rpc,state,commits,assertHealthy(){if(errors.length)throw errors[0];}};
}

export async function replaySnapshot(snapshot, scope=approvedScope, {engineRevision=null}={}) {
  const validation=validateSnapshot(snapshot,scope),t=structuredClone(snapshot.tables);
  const original=structuredClone(t.rider_derived_abilities);
  const workOriginal=structuredClone(t.training_date_work);
  const selected=new Set(validation.eligible.map(r=>r.rider_id));
  t.training_rider_ticks=[];
  t.training_date_work=t.training_date_work.map(w=>{
    const ids=w.quarantined_rider_ids.filter(id=>selected.has(id));
    return {...w,expected_rider_ids:ids,quarantined_rider_ids:[],opening_conditions:Object.fromEntries(ids.map(id=>[id,neutral(id)])),status:'partial'};
  }).filter(w=>w.expected_rider_ids.length);
  t.rider_condition=[...t.rider_condition,...validation.eligible.map(r=>neutral(r.rider_id))];
  const client=createOfflineClient(t);
  for(const w of t.training_date_work) {
    for(const gameDay of w.game_days) {
      const result=await runTeamTrainingDay({supabase:client,teamId:w.team_id,seasonId:w.season_id,
        seasonNumber:snapshot.season_number,executedBy:'assistant',now:new Date(w.created_at),
        gameDay,dateGameDays:w.game_days,tickDateOverride:w.tick_date,eligibleRiderIds:w.expected_rider_ids});
      client.assertHealthy();check(!result.alreadyRan,'Unexpected skipped offline tick');
    }
  }
  const riders=validation.eligible.map(({rider_id,team_id})=>{
    const rider=t.riders.find(r=>r.id===rider_id);
    const before=original.find(r=>r.rider_id===rider_id),after=client.state.rider_derived_abilities.find(r=>r.rider_id===rider_id);
    const changes={};for(const [k,v] of Object.entries(after)) if(JSON.stringify(v)!==JSON.stringify(before[k]))changes[k]={before:before[k],after:v};
    const reports=client.state.training_rider_ticks.filter(r=>r.rider_id===rider_id).map(r=>r.report);
    return {rider_id,team_id,name:`${rider.firstname} ${rider.lastname}`,changes,condition_before:null,
      opening:neutral(rider_id),condition_after:client.state.rider_condition.find(c=>c.rider_id===rider_id),
      reports};
  });
  const proposal={issue:5928,tick_date:snapshot.tick_date,exported_at:snapshot.exported_at,
    snapshot_sha256:digest(snapshot),engine_revision:engineRevision,manifest:snapshot.manifest,mode:'offline_dry_run',riders,excluded:validation.excluded,
    commits:client.commits,receipts:client.state.training_rider_ticks,original_work:workOriginal,
    rollback:{abilities:original.filter(a=>selected.has(a.rider_id)),absent_conditions:[...selected],
      rules:['Fresh comparison of all inputs, receipts, loads and ownership before apply',
        'Atomic recovery owns exactly the approved riders and its inserted receipts/history/scores',
        'Preserve teammate records in reports and work; nine excluded quarantines remain',
        'Restore exported abilities and remove only recovery-owned rows if no newer effects',
        'Refuse rollback after later activity; chronological repair requires a new proposal']},
    limitations:['Current unchanged input rows and finance audit reconstruct the historical state; deleted plan history is unavailable',
      'Proposal is not an apply script; production quarantine reopening and CAS transaction need separate review',
      'Historical feature-stage values use the documented active release; export their current values for verification']};
  return {...proposal,proposal_sha256:digest(proposal)};
}

export function renderProposalHtml(proposal,snapshot) {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cell=value=>`<td>${escape(value)}</td>`;
  const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
  const teamName=id=>snapshot.tables.teams.find(t=>t.id===id)?.name??id;
  const teamRows=snapshot.tables.teams.map(t=>[t.name,proposal.riders.filter(r=>r.team_id===t.id).length,proposal.excluded.filter(r=>r.team_id===t.id).length]);
  const riderRows=proposal.riders.map(r=>{
    const progress=r.changes.ability_progress;
    const deltas=Object.keys(progress?.after??{}).map(k=>[k,Number(progress.after[k])-Number(progress.before?.[k]??0)]).filter(([,delta])=>delta!==0);
    const visible=Object.entries(r.changes).filter(([,v])=>typeof v.before==='number'&&typeof v.after==='number').map(([k,v])=>`${k}: ${v.before} → ${v.after}`).join('; ')||'Ingen hele point';
    return [teamName(r.team_id),r.name,r.rider_id,visible,deltas.map(([k,d])=>`${k}: ${d.toFixed(6)}`).join('; ')||'Hvile/ingen evnefremdrift',`${r.opening.form} → ${r.condition_after.form}`,`${r.opening.fatigue} → ${r.condition_after.fatigue}`,r.condition_after.injured_until??'Ingen'];
  });
  const exclusions=proposal.excluded.map(r=>{const rider=snapshot.tables.riders.find(x=>x.id===r.rider_id);return [teamName(r.team_id),`${rider.firstname} ${rider.lastname}`,r.rider_id,'Plan ændret efter den manglende afregning'];});
  const detail=proposal.riders.map(r=>`<details><summary>${escape(teamName(r.team_id))}: ${escape(r.name)} · præcise før/efter-værdier</summary><pre>${escape(JSON.stringify({rider_id:r.rider_id,changes:r.changes,condition_before:r.condition_before,opening:r.opening,condition_after:r.condition_after},null,2))}</pre></details>`).join('');
  return `<!doctype html><html lang="da"><meta charset="utf-8"><title>#5928 · privat prøvekørsel</title><style>body{font:15px system-ui;margin:28px;color:#17202a}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ddd;padding:7px;text-align:left;vertical-align:top;font-variant-numeric:tabular-nums}th{background:#eef2f5}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:10px 0}p{max-width:1000px}</style><h1>Prøvekørsel af træningen 29/9</h1><p>Privat godkendelsesgrundlag. Ingen spillerdata er ændret. ${proposal.riders.length} ryttere foreslås efterreguleret; ${proposal.excluded.length} holdes udenfor. ${proposal.receipts.length} trin og ${proposal.riders.length} tilstandsafregninger. Holdkammerater får ingen ekstra træning.</p><p>Form og træthed sammenlignes med motorens eksisterende neutrale starttilstand. Rytterne havde ingen tilstandsrække. Evnefremdrift er ændringen i gemte brøkdele af næste point; de fulde før/efter-værdier findes nedenfor og i JSON-filen. Modellen ændres ikke.</p><p>Snapshot: ${escape(proposal.exported_at)}. Forslagets SHA-256: <code>${escape(proposal.proposal_sha256)}</code>.</p><h2>Hold</h2>${table(['Hold','Foreslået','Afventer'],teamRows)}<h2>Ryttere</h2>${table(['Hold','Rytter','ID','Synlige evner','Gemte pointbrøkdele','Form','Træthed','Skade til'],riderRows)}<h2>Ni undtagelser</h2>${table(['Hold','Rytter','ID','Årsag'],exclusions)}<h2>Forudsætninger og begrænsninger</h2><p>Uændrede inputrækker og finansens opsigelseslog dokumenterer de fundne programmer og trænere. Historik over slettede planer findes ikke. De historiske flag følger den dokumenterede release. Nye effekter siden snapshot stopper udførelsen og kræver et nyt forslag.</p><h2>Udførelse og tilbagerulning</h2><p>Efter godkendelse skal en særskilt transaktion sammenligne snapshot og aktuelle værdier, låse dato/hold/ryttere, bevare de ni undtagelser og alle holdkammerater og indsætte de godkendte trin atomisk. En dublet skal gøre intet. Udførelses-scriptet skal gennemgå review før prod-skrivning.</p><p>Backup indeholder de 75 rytters præcise evner og deres oprindelige fravær af tilstand. Tilbagerulning genskaber kun disse før-værdier og fjerner kun recovery-ejede kvitteringer, historik, score og rapportbidrag. Den oprindelige karantæne genetableres. Er der kommet senere aktivitet, afvises tilbagerulning; der laves en kronologisk rettelse.</p><h2>Præcise ændringer pr. rytter</h2>${detail}</html>`;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  check(process.argv.length===4,'Usage: node scripts/trainingRecovery5928.mjs PRIVATE_SNAPSHOT.json PRIVATE_PROPOSAL.json');
  const snapshot=JSON.parse(await readFile(process.argv[2],'utf8'));
  const engineRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'}).trim();
  const proposal=await replaySnapshot(snapshot,approvedScope,{engineRevision});
  await writeFile(process.argv[3],JSON.stringify(proposal,null,2),{flag:'wx'});
  await writeFile(`${process.argv[3]}.html`,renderProposalHtml(proposal,snapshot),{flag:'wx'});
  console.log(JSON.stringify({mode:proposal.mode,riders:proposal.riders.length,excluded:proposal.excluded.length,
    commits:proposal.commits.length,sha256:proposal.proposal_sha256}));
}
