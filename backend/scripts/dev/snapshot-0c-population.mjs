// Read-only population-snapshot til Race Hub Fase 0c (bund-ryttere) brainstorm.
// Svarer på: (1) hvor mange ryttere har ægte hold nu? (2) hvor mange løb overlapper
// typisk samtidig pr. pulje (= hvor mange hold-sæt skal kunne fordeles)? (3) hvor svagt
// er det nuværende evne-gulv? INGEN writes.
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/snapshot-0c-population.mjs
import { createClient } from "@supabase/supabase-js";
import { raceTimeWindow } from "../../lib/raceBinding.js";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const pctl = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (arr) => arr.length
  ? `n=${arr.length} min=${Math.min(...arr)} p10=${pctl(arr, .1)} p25=${pctl(arr, .25)} median=${pctl(arr, .5)} p75=${pctl(arr, .75)} p90=${pctl(arr, .9)} max=${Math.max(...arr)}`
  : "n=0";

async function readAllIn(table, cols, inCol, ids, extra) {
  const out = []; const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    let q = sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

// ── Sæson + hold ────────────────────────────────────────────────────────────────
const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number} (${season.id})\n`);

const { data: teams } = await sb.from("teams")
  .select("id, is_ai, is_test_account, is_frozen, league_division_id")
  .or("is_test_account.is.null,is_test_account.eq.false");
const live = teams.filter((t) => !t.is_frozen);
const realTeams = live.filter((t) => t.is_ai === false);
const aiTeams = live.filter((t) => t.is_ai === true);

// Rytter-antal pr. hold (ikke-retired).
const teamIds = live.map((t) => t.id);
const riders = await readAllIn("riders", "id, team_id, base_value", "team_id", teamIds, (q) => q.or("is_retired.is.null,is_retired.eq.false"));
const countByTeam = new Map();
for (const r of riders) countByTeam.set(r.team_id, (countByTeam.get(r.team_id) || 0) + 1);
const realCounts = realTeams.map((t) => countByTeam.get(t.id) || 0);
const aiCounts = aiTeams.map((t) => countByTeam.get(t.id) || 0);

console.log("=== RYTTER-ANTAL PR. HOLD ===");
console.log(`ÆGTE managers (is_ai=false): ${stat(realCounts)}`);
console.log(`AI-hold:                     ${stat(aiCounts)}`);
console.log(`Ægte hold med <12 ryttere: ${realCounts.filter((n) => n < 12).length}/${realCounts.length}`);
console.log(`Ægte hold med <16 ryttere: ${realCounts.filter((n) => n < 16).length}/${realCounts.length}`);

// ── Overlap-grad: peak samtidige løb pr. pulje ────────────────────────────────────
const { data: races } = await sb.from("races").select("id, league_division_id, race_class").eq("season_id", season.id);
const raceIds = races.map((r) => r.id);
const sched = await readAllIn("race_stage_schedule", "race_id, scheduled_at", "race_id", raceIds);
const schedByRace = new Map();
for (const s of sched) { if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []); schedByRace.get(s.race_id).push(s); }
const windowByRace = new Map(raceIds.map((id) => [id, raceTimeWindow(schedByRace.get(id))]));

// Pr. pulje: peak concurrency via interval-sweep (max samtidigt aktive vinduer).
const racesByPool = new Map();
for (const r of races) {
  const w = windowByRace.get(r.id); if (!w) continue;
  const k = r.league_division_id ?? "null";
  if (!racesByPool.has(k)) racesByPool.set(k, []);
  racesByPool.get(k).push(w);
}
function peakConcurrency(windows) {
  const ev = [];
  for (const w of windows) { ev.push([w.start, 1], [w.end, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ende før start ved lig → vinduer der lige rører tæller ikke dobbelt... men windowsOverlap er inklusiv; vi vil have inklusiv
  // Inklusiv overlap: behandl start før end ved samme tid.
  ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let cur = 0, peak = 0;
  for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur); }
  return peak;
}
const peaks = [];
for (const [k, ws] of racesByPool) peaks.push({ pool: k, races: ws.length, peak: peakConcurrency(ws) });
peaks.sort((a, b) => b.peak - a.peak);
console.log("\n=== OVERLAP: peak samtidige løb pr. pulje ===");
console.log("(peak = max antal løb hvis tidsvinduer overlapper samtidig = hvor mange hold-sæt der skal kunne fordeles på én gang)");
for (const p of peaks) console.log(`  pulje ${String(p.pool).padStart(4)}: ${p.races} løb, peak samtidige = ${p.peak}`);
const peakVals = peaks.map((p) => p.peak);
console.log(`Peak-fordeling på tværs af puljer: ${stat(peakVals)}`);

// ── Evne-gulv: top-evne pr. rytter (ægte hold) ────────────────────────────────────
const riderIds = riders.map((r) => r.id);
const abilities = await readAllIn("rider_derived_abilities", ["rider_id", ...ABILITY_KEYS].join(", "), "rider_id", riderIds);
const abById = new Map(abilities.map((a) => [a.rider_id, a]));
const topAbilityReal = [];
const baseValReal = [];
for (const r of riders) {
  if (!realTeams.find((t) => t.id === r.team_id)) continue;
  const ab = abById.get(r.id); if (!ab) continue;
  const vals = ABILITY_KEYS.map((k) => ab[k]).filter(Number.isFinite);
  if (vals.length) topAbilityReal.push(Math.max(...vals));
  if (Number.isFinite(r.base_value)) baseValReal.push(r.base_value);
}
console.log("\n=== EVNE-GULV (ægte holds ryttere) ===");
console.log(`Per-rytter top-evne (1-99): ${stat(topAbilityReal)}`);
console.log(`base_value (CZ$):           ${stat(baseValReal)}`);
console.log(`Ryttere med top-evne ≤ 25 (svage domestikker): ${topAbilityReal.filter((v) => v <= 25).length}/${topAbilityReal.length}`);
process.exit(0);
