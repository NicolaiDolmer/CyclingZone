// Read-only simulér-før-ship: mål 0b-generatorens fyldnings-grad MED kalender-overlap
// (planRaceSchedules tracks=2) vs. den faktiske sekventielle prod-baseline. Genbruger de
// rene byggeklodser (assignTeamAcrossRaces, selectionSizeForRace). INGEN writes.
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/simulate-overlap-fill.mjs
import { createClient } from "@supabase/supabase-js";
import { assignTeamAcrossRaces } from "../../lib/raceEntryGenerator.js";
import { selectionSizeForRace } from "../../lib/raceAutopick.js";
import { raceTimeWindow } from "../../lib/raceBinding.js";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { planRaceSchedules } from "../backfillRaceScheduledFor.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number}\n`);

// Løb + eksisterende (sekventielle) vinduer.
const { data: races } = await sb.from("races").select("id, name, race_class, league_division_id, stages").eq("season_id", season.id);
const raceIds = races.map((r) => r.id);
const sched = await readAllIn("race_stage_schedule", "race_id, scheduled_at", "race_id", raceIds);
const schedByRace = new Map();
for (const s of sched) { if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []); schedByRace.get(s.race_id).push(s); }
const baselineWin = new Map(raceIds.map((id) => [id, raceTimeWindow(schedByRace.get(id))]));

// Profiler (autopick scorer på dem).
const profiles = await readAllIn("race_stage_profiles", "race_id, stage_number, profile_type, finale_type, demand_vector", "race_id", raceIds);
const stagesByRace = new Map();
for (const p of profiles) { if (!stagesByRace.has(p.race_id)) stagesByRace.set(p.race_id, []); stagesByRace.get(p.race_id).push(p); }
for (const arr of stagesByRace.values()) arr.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

// Hold + ryttere + abilities + fatigue (eligible: ikke-test, ikke-frosset).
const { data: allTeams } = await sb.from("teams").select("id, is_test_account, is_frozen, league_division_id").or("is_test_account.is.null,is_test_account.eq.false");
const teams = (allTeams || []).filter((t) => !t.is_frozen);
const teamIds = teams.map((t) => t.id);
const riders = await readAllIn("riders", "id, team_id", "team_id", teamIds, (q) => q.or("is_retired.is.null,is_retired.eq.false"));
const riderIds = riders.map((r) => r.id);
const abilities = await readAllIn("rider_derived_abilities", ["rider_id", ...ABILITY_KEYS].join(", "), "rider_id", riderIds);
const abById = new Map(abilities.map((a) => [a.rider_id, a]));
const cond = await readAllIn("rider_condition", "rider_id, fatigue", "rider_id", riderIds);
const fatById = new Map(cond.map((c) => [c.rider_id, c.fatigue]));
const ridersByTeam = new Map();
for (const r of riders) {
  const ab = abById.get(r.id); if (!ab) continue;
  if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
  ridersByTeam.get(r.team_id).push({ rider_id: r.id, abilities: ab, fatigue: fatById.get(r.id) });
}

// Overlap-vinduer (tracks=2) pr. pulje, in-memory.
const racesByPool = new Map();
for (const r of races) { const k = r.league_division_id ?? "null"; if (!racesByPool.has(k)) racesByPool.set(k, []); racesByPool.get(k).push(r); }
const overlapWin = new Map();
const anchor = new Date("2026-07-01T00:00:00Z"); // fast anker (determinisme); kun relativ tid betyder noget
for (const [, poolRaces] of racesByPool) {
  const { stageRows } = planRaceSchedules({ races: poolRaces.map((r) => ({ id: r.id, name: r.name, stages: r.stages })), from: anchor, tracks: 2 });
  const byRace = new Map();
  for (const s of stageRows) { if (!byRace.has(s.race_id)) byRace.set(s.race_id, []); byRace.get(s.race_id).push(s); }
  for (const [id, rows] of byRace) overlapWin.set(id, raceTimeWindow(rows));
}

// Kør assignTeamAcrossRaces pr. pulje/hold mod et givet vindue-opslag → scorecard.
const teamsByPool = new Map();
for (const t of teams) { const k = t.league_division_id ?? "null"; if (!teamsByPool.has(k)) teamsByPool.set(k, []); teamsByPool.get(k).push(t); }

function score(winByRace, label) {
  let slots = 0, any = 0, full = 0, noShow = 0;
  let peakSum = 0, pools = 0;
  for (const [poolKey, poolRaces] of racesByPool) {
    const usable = poolRaces.filter((r) => winByRace.get(r.id));
    // Peak-concurrency pr. pulje (interval-sweep).
    const ev = [];
    for (const r of usable) { const w = winByRace.get(r.id); ev.push([w.start, 1], [w.end, -1]); }
    ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let cur = 0, peak = 0; for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur); }
    peakSum += peak; pools++;
    for (const team of teamsByPool.get(poolKey) || []) {
      const teamRaces = usable.map((r) => ({ race_id: r.id, window: winByRace.get(r.id), stages: stagesByRace.get(r.id) || [], sizeRule: selectionSizeForRace(r) }));
      const assignment = assignTeamAcrossRaces({ riders: ridersByTeam.get(team.id) || [], races: teamRaces });
      for (const r of usable) {
        const picks = assignment[r.id] || [];
        const min = selectionSizeForRace(r)?.min ?? 6;
        slots++;
        if (picks.length >= 1) any++; else noShow++;
        if (picks.length >= min) full++;
      }
    }
  }
  console.log(`\n=== ${label} ===`);
  console.log(`Peak-concurrency (snit pr. pulje): ${(peakSum / pools).toFixed(2)}`);
  console.log(`Hold-slots: ${slots}`);
  console.log(`  >=1 rytter:  ${any}/${slots} (${Math.round(100 * any / slots)}%)`);
  console.log(`  FULDT hold: ${full}/${slots} (${Math.round(100 * full / slots)}%)`);
  console.log(`  auto-no-show (0 ryttere): ${noShow}/${slots} (${Math.round(100 * noShow / slots)}%)`);
  return { slots, any, full, noShow };
}

const base = score(baselineWin, "BASELINE (faktisk sekventiel kalender)");
const ovl = score(overlapWin, "OVERLAP (tracks=2, simuleret)");
console.log("\n=== SCORECARD-DELTA ===");
console.log(`FULDT hold: ${Math.round(100 * base.full / base.slots)}% -> ${Math.round(100 * ovl.full / ovl.slots)}% (${Math.round(100 * (ovl.full - base.full) / base.slots)} pp)`);
console.log(`auto-no-show: ${Math.round(100 * base.noShow / base.slots)}% -> ${Math.round(100 * ovl.noShow / ovl.slots)}%`);
console.log("\n(Faldet i FULDT-hold-grad = bund-rytter-behovet naeste fase skal lukke.)");
process.exit(0);
