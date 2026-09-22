// Read-only report for task 1b. All artifacts remain under balance-internals.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {fetchAllRows} from '../../lib/supabasePagination.js';
import {ageForSeason} from '../../lib/riderSeasonAge.js';
import {bestRoleForAbilities} from '../../lib/riderValueRefresh.js';
import {VALUATION_ABILITY_COLUMNS, riderOverall} from '../../lib/riderValuation.js';
import {ratingForRole, DISPLAY_RECIPE_ABILITIES} from '../../lib/weights/displayRecipes.js';
import {populationStats, scaleContinuityGate, eliteUnbuyableGate} from '../../lib/valuationV4Scorecard.js';
import {candidateValue, refitBestRole} from './bestRoleRefit5443.js';
const root = fileURLToPath(new URL('../../../balance-internals/', import.meta.url));
const opts = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--(out|simulation|snapshot)=(.+)$/.exec(arg);
  if (!m) throw new Error('Only --out, --simulation and --snapshot are supported. No apply path.');
  opts[m[1]] = m[2];
}
function privatePath(path) {
  const p = resolve(root, path), rel = relative(root,p);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Private output must remain under balance-internals');
  return p;
}
const out = privatePath(opts.out ?? '2026-09-22-best-role-refit');
const simulation = JSON.parse(readFileSync(privatePath(opts.simulation ?? '2026-09-22-best-role-refit/simulation.json')));
const source = JSON.parse(readFileSync(new URL('../../lib/riderValuationModelV5.json', import.meta.url)));
const model = refitBestRole(simulation.samples, source);

const now = new Date().toISOString();
model.fitted_at = now;
model.sim_run_id = createHash('sha256').update(JSON.stringify(simulation)).digest('hex');
model.K = simulation.K;
model.notes = 'Uncalibrated development-only best-role refit. No production activation. Source curve and scale retained; offsets refitted against the attached simulation hash.';
let snapshot;
if (opts.snapshot) snapshot = JSON.parse(readFileSync(privatePath(opts.snapshot)));
else {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {auth:{persistSession:false}});
  const {data:season,error} = await sb.from('seasons').select('number').eq('status','active').maybeSingle();
  if (error || !season) throw new Error(error?.message ?? 'No active season');
  const riders = await fetchAllRows(()=>sb.from('riders').select('id,team_id,firstname,lastname,primary_type,valuation_type,birthdate,potentiale,base_value,is_retired,is_academy').order('id'));
  const abilities = await fetchAllRows(()=>sb.from('rider_derived_abilities').select(`rider_id, ${VALUATION_ABILITY_COLUMNS.join(',')}`).order('rider_id'));
  const teams = await fetchAllRows(()=>sb.from('teams').select('id,name,balance,is_ai,is_test_account,is_frozen,is_bank').order('id'));
  snapshot = {read_at:now,season_number:season.number,riders,abilities,teams};
}
if (snapshot.season_number !== simulation.season_number) throw new Error('Simulation and snapshot seasons differ');
mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'snapshot.json'), JSON.stringify(snapshot));
writeFileSync(resolve(out,'riderValuationModelV5.best-role.candidate.json'), JSON.stringify(model,null,2));
const abilities = new Map(snapshot.abilities.map(a=>[a.rider_id,a]));
const teams = new Map(snapshot.teams.map(t=>[t.id,t]));
const isHuman = t => t && t.is_ai === false && !t.is_test_account && !t.is_bank;
const rows = [], perturbations = [], exclusions = [];
let probes = 0;
for (const raw of snapshot.riders) {
  if (raw.is_retired) continue;
  const r = {...raw, age:ageForSeason(raw.birthdate,snapshot.season_number)};
  const ab = abilities.get(r.id), best = bestRoleForAbilities(ab), t = teams.get(r.team_id);
  const after = candidateValue(r,ab,model);
  if (after === null || !(r.base_value > 0)) {exclusions.push(r.id); continue;}
  const naturalValue = candidateValue(r,ab,model,r.primary_type);
  const rec = {id:r.id,name:`${r.firstname} ${r.lastname}`,team_id:r.team_id,team:t?.name??null,human:!!isHuman(t),frozen:!!t?.is_frozen,
    primary_type:r.primary_type,...best,age:r.age,rating_before:ratingForRole(ab,r.primary_type),before:r.base_value,after,
    delta_pct:(after/r.base_value-1)*100,natural_value_same_fit:naturalValue,role_only_pct:naturalValue>0?(after/naturalValue-1)*100:null,overall:riderOverall(ab)};
  rows.push(rec);
  // Exhaustive one-point probes across displayed ability inputs on human teams.
  // Synthetic sensitivity, not a claim about the time/cost needed to train a point.
  if (!rec.human) continue;
  for (const key of DISPLAY_RECIPE_ABILITIES) {
    if (ab[key] == null || !Number.isFinite(Number(ab[key])) || Number(ab[key]) >= 99) continue;
    const bumped = {...ab,[key]:Math.min(99,Number(ab[key])+1)};
    const nextRole = bestRoleForAbilities(bumped).best_role;
    const next = candidateValue(r,bumped,model);
    const held = candidateValue(r,bumped,model,best.best_role);
    probes++;
    perturbations.push({id:r.id,name:rec.name,team:rec.team,ability:key,from:best.best_role,to:nextRole,switched:nextRole!==best.best_role,
      before:after,after:next,held_role_value:held,total_pct:(next/after-1)*100,role_jump_pct:(next/held-1)*100});
  }
}
const human = rows.filter(r=>r.human), switches=perturbations.filter(x=>x.switched);
const summarize = rs => ({n:rs.length,before:populationStats(rs.map(r=>r.before)),after:populationStats(rs.map(r=>r.after)),
  losses_over_half:rs.filter(r=>r.after<r.before/2).length,delta_pct:populationStats(rs.map(r=>r.delta_pct))});
const humanTeams = snapshot.teams.filter(isHuman);
const cash = humanTeams.reduce((s,t)=>s+Number(t.balance??0),0);
const teamRows = humanTeams.map(t=>({id:t.id,name:t.name,cash_before:t.balance,cash_after:t.balance,...summarize(human.filter(r=>r.team_id===t.id))}));
const scorecard = [scaleContinuityGate(human.map(r=>r.before),human.map(r=>r.after),{baselineLabel:'stored'}),
  eliteUnbuyableGate(rows.map(r=>({...r,v4Value:r.after})),{ceiling:model.elite_premium?.affordability_ceiling})];
const summary = {generated_at:now,written_to_prod:0,calibration:'pending_owner_target; source v5 scale unchanged',
  simulation:{runs:simulation.K,seed:simulation.base_seed,season:simulation.season_number,population:simulation.population,samples:simulation.samples.length},
  refit:model.refit,r2_log:model.fit.r2_log,all:summarize(rows),human:summarize(human),excluded:exclusions.length,
  cash:{human_teams:humanTeams.length,before:cash,after:cash,explanation:'No balance mutation. Rider values are not cash.'},
  one_point:{probes,switches:switches.length,all_gain_pct:populationStats(perturbations.map(x=>x.total_pct)),
    switch_gain_pct:populationStats(switches.map(x=>x.total_pct)),isolated_role_jump_pct:populationStats(switches.map(x=>x.role_jump_pct))},
  scorecard,gate_status:'Report only. Existing scorecard thresholds are regression floors, not owner approval.'};
for (const [name,data] of Object.entries({summary,rows,teams:teamRows,losses_over_half:human.filter(r=>r.after<r.before/2),
  top20_role_switches:[...switches].sort((a,b)=>Math.abs(b.role_jump_pct)-Math.abs(a.role_jump_pct)).slice(0,20),
  top20_training_gains:[...perturbations].sort((a,b)=>b.total_pct-a.total_pct).slice(0,20),perturbations})) {
  writeFileSync(resolve(out,`${name}.json`),JSON.stringify(data,null,2));
}
console.log(JSON.stringify(summary,null,2));
