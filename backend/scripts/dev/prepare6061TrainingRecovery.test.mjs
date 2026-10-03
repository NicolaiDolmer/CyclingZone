import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryManifest, parseArgs } from './prepare6061TrainingRecovery.mjs';
const base=()=>({asOf:'2026-10-03T09:00:00Z',through:'2026-10-02',
 work:[{team_id:'team',season_id:'season',tick_date:'2026-10-02',game_days:[20,21,22,23,24],quarantined_rider_ids:['rider'],opening_conditions:{}}],
 riders:[{id:'rider',team_id:'team',is_retired:false}],conditions:[],ticks:[],settlements:[],legacyReports:[],loads:[],plans:[],weekPlans:[]});
test('missing receipts are inventoried but never marked apply-ready without historical inputs',()=>{
 const result=buildRecoveryManifest(base());assert.equal(result.summary.rider_days,5);assert.equal(result.summary.riders,1);
 assert.equal(result.apply_ready,false);assert.ok(result.candidates[0].blockers.includes('missing_opening_condition'));
 assert.ok(result.candidates[0].blockers.includes('missing_historical_training_inputs'));
});
test('two owner rows share one rider-day and are explicit ambiguity, never double credit',()=>{
 const state=base();state.work.push({...state.work[0],team_id:'old-team'});
 const result=buildRecoveryManifest(state);assert.equal(result.summary.rider_days,5);
 assert.ok(result.candidates.every(c=>c.blockers.includes('multiple_date_owners')));
});
test('recorded receipts are excluded and an existing condition forbids first-use initialization',()=>{
 const state=base();state.ticks=[{rider_id:'rider',season_id:'season',game_day:20,tick_date:'2026-10-02',team_id:'team'}];
 state.conditions=[{rider_id:'rider',form:62,fatigue:48}];
 const result=buildRecoveryManifest(state);assert.equal(result.summary.rider_days,4);
 assert.equal(result.candidates[0].category,'existing_state_review');
});
test('retired or no-longer-owned rider is retained as blocked evidence',()=>{
 const state=base();state.riders[0].team_id=null;
 assert.ok(buildRecoveryManifest(state).candidates[0].blockers.includes('current_ownership_unavailable'));
});
test('an immutable load alone is not an applied condition or a completed development receipt',()=>{
 const state=base();state.loads=[{rider_id:'rider',season_id:'season',game_day:20,tick_date:'2026-10-02',load:12,consumed_at:null}];
 const result=buildRecoveryManifest(state);assert.equal(result.summary.rider_days,5);
 assert.equal(result.candidates[0].recorded_race_days.length,1);assert.equal(result.apply_ready,false);
});
test('current plans updated after a missing date cannot substitute for historical training inputs',()=>{
 const state=base();state.plans=[{rider_id:'rider',team_id:'team',focus:'climbing',intensity:'normal',updated_at:'2026-10-03T08:00:00Z'}];
 assert.ok(buildRecoveryManifest(state).candidates[0].blockers.includes('missing_historical_training_inputs'));
});
test('explicit cutoff rejects current/future dates and invalid date contracts',()=>{
 const state=base();state.through='2026-10-03';assert.throws(()=>buildRecoveryManifest(state),/closed date/i);
 const invalid=base();invalid.work[0].game_days=[1,1];assert.throws(()=>buildRecoveryManifest(invalid),/five.*unique/i);
});

test('apply and unknown arguments are rejected before credentials or network',()=>{
 assert.throws(()=>parseArgs(['--apply']),/read-only/);
 assert.throws(()=>parseArgs([]),/through/);
});
test('legacy report containment serializes a JSON array rather than a PostgreSQL array',async()=>{
 const {createClient}=await import('@supabase/supabase-js');let encoded;
 const supabase=createClient('https://synthetic.supabase.co','placeholder',{global:{fetch:async url=>{encoded=new URL(url).searchParams.get('report->riders');return new Response('[]',{headers:{'content-type':'application/json'}});}}});
 await supabase.from('training_day_runs').select('id').contains('report->riders',JSON.stringify([{rider_id:'synthetic'}]));
 assert.equal(encoded,'cs.[{"rider_id":"synthetic"}]');
});

test('changed or ambiguous ownership is a separate review class, never a first-use count',()=>{
 const changed=base();changed.riders[0].team_id='new-team';
 let result=buildRecoveryManifest(changed);assert.equal(result.candidates[0].category,'ownership_review');assert.equal(result.summary.first_use_candidates,0);
 const ambiguous=base();ambiguous.work.push({...ambiguous.work[0],team_id:'other-team'});
 result=buildRecoveryManifest(ambiguous);assert.equal(result.summary.first_use_candidates,0);
 assert.ok(result.candidates.every(c=>c.category==='ownership_review'));
});
