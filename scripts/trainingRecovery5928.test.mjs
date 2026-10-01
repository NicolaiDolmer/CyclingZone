import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, createOfflineClient, replaySnapshot,renderProposalHtml } from './trainingRecovery5928.mjs';

const fixture = () => ({
  tick_date:'2026-09-29', exported_at:'2026-09-30T06:00:00Z', season_number:4,
  evidence:[{rider_id:'r',condition_count:0,receipt_count:0,settlement_count:0,race_load_count:0,race_result_count:0,canonical_report_count:0,history_after_work_count:0}],
  tables:{
    training_date_work:[{team_id:'t',season_id:'s',tick_date:'2026-09-29',game_days:[5,6,7,8,9],expected_rider_ids:['r','teammate'],quarantined_rider_ids:['r'],opening_conditions:{},created_at:'2026-09-29T18:00:00Z'}],
    riders:[{id:'r',team_id:'t',is_retired:false,is_academy:false,firstname:'R',lastname:'Test',birthdate:'2000-01-01',primary_type:'climber',secondary_type:null,potentiale:70}],
    rider_derived_abilities:[{rider_id:'r',endurance:35,vo2max:35,vo2max_climb:35,sprint:35,anaerobic_capacity:35,flat_efficiency:35,climbing_efficiency:35,time_trial:35,tactics:35,descending:35,teamwork:35,leadership:35,ability_progress:{},ability_caps:{}}],
    training_plans:[], training_week_plans:[], team_facilities:[],team_staff:[],staff_derived_abilities:[],finance_transactions:[],
    app_config:[...['training_condition_per_date','training_tick_per_race_day','race_day_engine_enabled','race_day_development_enabled'].map(key=>({key,value:'on'})),{key:'training_programs',value:'off'}],
    teams:[{id:'t',name:'Test',league_division_id:1}],users:[],races:[],race_stage_schedule:[],race_results:[],race_stage_profiles:[],race_entry_days:[],race_simulation_runs:[],training_race_loads:[],rider_condition:[],training_day_runs:[],training_rider_ticks:[],
  },
});
const scope={riders:1,teams:1,eligible:1,excluded:0};

test('excludes changed plans without substituting current input',()=>{
  const s=fixture();s.tables.training_plans=[{rider_id:'r',team_id:'t',season_id:'s',updated_at:'2026-09-30T01:00:00Z'}];
  const v=validateSnapshot(s,{...scope,eligible:0,excluded:1});assert.equal(v.eligible.length,0);assert.equal(v.excluded[0].reason,'plan_changed');
});
test('rejects missing evidence or later effects and incomplete dates',()=>{
  const s=fixture();s.evidence=[];assert.throws(()=>validateSnapshot(s,scope),/evidence/);
  const s2=fixture();s2.evidence[0].settlement_count=1;assert.throws(()=>validateSnapshot(s2,scope),/settlement_count/);
  const s3=fixture();s3.tables.training_date_work[0].game_days=[5,6];assert.throws(()=>validateSnapshot(s3,scope),/five/);
});
test('rejects staff with unknown firing time or changed abilities',()=>{
  const s=fixture();s.tables.team_staff=[{id:'c',team_id:'t',role:'training',status:'fired',fired_season:4,created_at:'2026-09-28T00:00:00Z'}];
  assert.throws(()=>validateSnapshot(s,scope),/staff.*audit/);
  s.tables.finance_transactions=[{team_id:'t',idempotency_key:'staff_release_severance:t:c',created_at:'2026-09-29T12:00:00Z'}];
  assert.equal(validateSnapshot(s,scope).eligible.length,1);
  s.tables.staff_derived_abilities=[{staff_id:'c',updated_at:'2026-09-30T01:00:00Z'}];assert.throws(()=>validateSnapshot(s,scope),/staff.*changed/);
});
test('offline client rejects unknown tables and all direct mutations, even if callers swallow errors',()=>{
  const c=createOfflineClient(fixture().tables);
  assert.throws(()=>c.from('invented'),/Unsupported/);
  assert.throws(()=>c.from('riders').update({}),/mutation/);
  assert.throws(()=>c.assertHealthy(),/Unsupported/);
});
test('actual engine replay is deterministic, scoped, sequential and settles condition once',async()=>{
  const s=fixture();const original=structuredClone(s);
  const a=await replaySnapshot(s,scope);const b=await replaySnapshot(s,scope);
  assert.deepEqual(s,original);assert.deepEqual(a,b);
  assert.equal(a.riders.length,1);assert.equal(a.commits.length,5);
  assert.deepEqual(a.commits.map(p=>p.p_game_day),[5,6,7,8,9]);
  assert.equal(a.commits.flatMap(p=>p.p_conditions).length,1);
  assert.ok(a.commits.flatMap(p=>p.p_report.riders).every(r=>r.rider_id==='r'));
  assert.equal(a.receipts.length,5);
  assert.deepEqual(a.commits[1].p_report.riders[0].progress_before,a.commits[0].p_abilities[0].patch.ability_progress);
});
test('rejects scope count drift and manifest substitutions',()=>{
  assert.throws(()=>validateSnapshot(fixture()),/scope team/);
  const s=fixture();s.manifest={eligible:['wrong'],excluded:[]};assert.throws(()=>validateSnapshot(s,scope),/manifest/);
  assert.throws(()=>validateSnapshot(fixture(),{...scope,eligible:0,excluded:1}),/scope changed/);
});
test('rejects missing flag rows and missing applicable beta owner evidence',()=>{
  const s=fixture();s.tables.app_config=s.tables.app_config.filter(f=>f.key!=='race_day_engine_enabled');assert.throws(()=>validateSnapshot(s,scope),/flag evidence/);
  const s2=fixture();s2.tables.app_config.find(f=>f.key==='training_programs').value='beta';
  s2.tables.teams[0].user_id='u';s2.tables.training_week_plans=[{team_id:'t',updated_at:'2026-09-28T00:00:00Z',days:{monday:{session:'test'}}}];
  assert.throws(()=>validateSnapshot(s2,scope),/beta evidence/);
});
test('private report escapes untrusted rider names and includes the concrete checksum',async()=>{
  const s=fixture();s.tables.riders[0].firstname='<script>bad</script>';
  const p=await replaySnapshot(s,scope);const html=renderProposalHtml(p,s);
  assert.ok(!html.includes('<script>bad</script>'));assert.ok(html.includes('&lt;script&gt;bad'));
  assert.ok(html.includes(p.proposal_sha256));assert.ok(html.includes('Ingen spillerdata er ændret'));
});
