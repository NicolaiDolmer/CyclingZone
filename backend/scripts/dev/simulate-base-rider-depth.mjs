// Read-only simulér-før-ship for bund-rytter-dybde-fasen (race-hub "0c").
// Udvider simulate-overlap-fill.mjs: modellerer en ENGANGS dybde-top-up in-memory
// (top hvert ægte hold op til N med friskt-genererede svage hale-ryttere) og måler
// fyldnings-scorecardet + styrke-spredningen MOD overlap-kalenderen (tracks=2), ved
// et grid af trup-størrelser × hale-vinduer. INGEN writes.
//
// Synthetic-ryttere: buildWeakStarterPool (samme mekanik som allocatoren) + den rene
// deriveAbilities-fallback (ingen physiology → lineær PCM-remap, ingen kontrast) →
// præcis de evner relaunch/akademi-ryttere får. Determinisk (per-hold seed).
//
// Fyldning er antals-/binding-drevet (autopick.slice(0,max), ingen kvalitets-tærskel)
// → window-uafhængig; kun styrke-spredningen afhænger af hale-vinduet.
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/simulate-base-rider-depth.mjs
import { createClient } from "@supabase/supabase-js";
import { assignTeamAcrossRaces } from "../../lib/raceEntryGenerator.js";
import { selectionSizeForRace } from "../../lib/raceAutopick.js";
import { raceTimeWindow } from "../../lib/raceBinding.js";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { planRaceSchedules } from "../backfillRaceScheduledFor.js";
import { buildWeakStarterPool, hashStringToSeed } from "../../lib/starterSquadAllocator.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Grid (åbent: ejer vælger N + hale-vindue fra scorecardet) ──────────────────
const TRUP_SIZES = [10, 12, 14, 16];          // ud over nuværende baseline + N=8-gulv
const TAIL_WINDOWS = [                          // hi=57 = uniform-kontrol (= nuværende kerne)
  { label: "[50,57] uniform", lo: 50, hi: 57 },
  { label: "[50,54]",         lo: 50, hi: 54 },
  { label: "[50,52]",         lo: 50, hi: 52 },
];
const REFERENCE_YEAR = 2026;
const MAX_N = Math.max(...TRUP_SIZES, 8);

async function readAllIn(table, cols, inCol, ids, extra) {
  const out = []; const CH = 200; const PAGE = 1000;
  for (let i = 0; i < ids.length; i += CH) {
    const slice = ids.slice(i, i + CH);
    // Paginér resultat-rækkerne (PostgREST capper ved 1000/forespørgsel) — ellers
    // trunkeres ryttere ved skala (>1000 rækker for et chunk) → falsk lave tal.
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select(cols).in(inCol, slice).range(from, from + PAGE - 1);
      if (extra) q = extra(q);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number}\n`);

const { data: races } = await sb.from("races").select("id, name, race_class, league_division_id, stages").eq("season_id", season.id);
const raceIds = races.map((r) => r.id);

// Profiler (autopick scorer på dem).
const profiles = await readAllIn("race_stage_profiles", "race_id, stage_number, profile_type, finale_type, demand_vector", "race_id", raceIds);
const stagesByRace = new Map();
for (const p of profiles) { if (!stagesByRace.has(p.race_id)) stagesByRace.set(p.race_id, []); stagesByRace.get(p.race_id).push(p); }
for (const arr of stagesByRace.values()) arr.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

// Hold + ryttere + abilities + fatigue (eligible: ikke-test, ikke-frosset).
const { data: allTeams } = await sb.from("teams").select("id, is_test_account, is_frozen, is_ai, is_bank, league_division_id").or("is_test_account.is.null,is_test_account.eq.false");
const teams = (allTeams || []).filter((t) => !t.is_frozen);
const isManager = (t) => !t.is_ai && !t.is_bank; // top-up-population (= getBetaManagerTeams)
const managerIds = new Set(teams.filter(isManager).map((t) => t.id));
console.log(`Hold: ${teams.length} eligible (${managerIds.size} ægte managere, ${teams.length - managerIds.size} AI/bank)\n`);
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

// Overlap-vinduer (tracks=2) pr. pulje, in-memory (fast anker → determinisme).
const racesByPool = new Map();
for (const r of races) { const k = r.league_division_id ?? "null"; if (!racesByPool.has(k)) racesByPool.set(k, []); racesByPool.get(k).push(r); }
const overlapWin = new Map();
const anchor = new Date("2026-07-01T00:00:00Z");
for (const [, poolRaces] of racesByPool) {
  const { stageRows } = planRaceSchedules({ races: poolRaces.map((r) => ({ id: r.id, name: r.name, stages: r.stages })), from: anchor, tracks: 2 });
  const byRace = new Map();
  for (const s of stageRows) { if (!byRace.has(s.race_id)) byRace.set(s.race_id, []); byRace.get(s.race_id).push(s); }
  for (const [id, rows] of byRace) overlapWin.set(id, raceTimeWindow(rows));
}

const teamsByPool = new Map();
for (const t of teams) { const k = t.league_division_id ?? "null"; if (!teamsByPool.has(k)) teamsByPool.set(k, []); teamsByPool.get(k).push(t); }

// ── Synthetic hale-ryttere pr. (hold, vindue): generér MAX_N, derive pure, cache ──
// deriveAbilities uden physiology → lineær PCM-remap (samme som relaunch/akademi).
function makeTailRiders(teamId, window, n) {
  const seed = (hashStringToSeed(teamId) ^ hashStringToSeed(`${window.lo}-${window.hi}`)) >>> 0;
  const payload = buildWeakStarterPool({ count: n, seed, referenceYear: REFERENCE_YEAR, window });
  return payload.map((row, i) => ({
    rider_id: `synthetic:${teamId}:${window.lo}-${window.hi}:${i}`,
    abilities: deriveAbilities({}, row, { asOfYear: REFERENCE_YEAR }),
    fatigue: 0, // friskt tildelt
  }));
}
const tailCache = new Map(); // `${teamId}|${win.label}` → MAX_N synthetic riders
function tailFor(teamId, window, need) {
  if (need <= 0) return [];
  const key = `${teamId}|${window.label}`;
  if (!tailCache.has(key)) tailCache.set(key, makeTailRiders(teamId, window, MAX_N));
  return tailCache.get(key).slice(0, need);
}

const meanAbility = (ab) => { let s = 0; for (const k of ABILITY_KEYS) s += Number(ab[k]) || 0; return s / ABILITY_KEYS.length; };
function pct(sorted, p) { if (!sorted.length) return 0; const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length)); return sorted[i]; }

// rosterBuilder(team) → rytter-liste. countFilter(team) → tæl holdets slots med?
// Returnerer scorecard for ét grid-punkt.
function score(rosterBuilder, countFilter = () => true) {
  let slots = 0, any = 0, full = 0, noShow = 0;
  const fieldStrengths = [];
  for (const [poolKey, poolRaces] of racesByPool) {
    const usable = poolRaces.filter((r) => overlapWin.get(r.id));
    for (const team of teamsByPool.get(poolKey) || []) {
      if (!countFilter(team)) continue;
      const roster = rosterBuilder(team);
      const abByRid = new Map(roster.map((r) => [r.rider_id, r.abilities]));
      const teamRaces = usable.map((r) => ({ race_id: r.id, window: overlapWin.get(r.id), stages: stagesByRace.get(r.id) || [], sizeRule: selectionSizeForRace(r) }));
      const assignment = assignTeamAcrossRaces({ riders: roster, races: teamRaces });
      for (const r of usable) {
        const picks = assignment[r.id] || [];
        const min = selectionSizeForRace(r)?.min ?? 6;
        slots++;
        if (picks.length >= 1) any++; else noShow++;
        if (picks.length >= min) full++;
        if (picks.length) fieldStrengths.push(picks.reduce((s, p) => s + meanAbility(abByRid.get(p.rider_id) || {}), 0) / picks.length);
      }
    }
  }
  fieldStrengths.sort((a, b) => a - b);
  return {
    slots, any, full, noShow,
    fullPct: Math.round(100 * full / slots),
    noShowPct: Math.round(100 * noShow / slots),
    anyPct: Math.round(100 * any / slots),
    p10: pct(fieldStrengths, 0.10), p50: pct(fieldStrengths, 0.50), p90: pct(fieldStrengths, 0.90),
  };
}

// Top-up KUN ægte managere (= getBetaManagerTeams). AI/bank røres ikke.
const noTopUp = (team) => ridersByTeam.get(team.id) || [];
const topUpManagers = (win, N) => (team) => {
  const cur = ridersByTeam.get(team.id) || [];
  if (!managerIds.has(team.id)) return cur;
  return [...cur, ...tailFor(team.id, win, N - cur.length)];
};

// ── Baseline (intet top-up), målt over ægte managere ──────────────────────────
const baseline = score(noTopUp, isManager);
console.log("=== BASELINE (nuværende rosters, intet top-up, overlap tracks=2) — KUN ægte manageres felter ===");
console.log(`  FULDT hold: ${baseline.fullPct}%   forceret no-show: ${baseline.noShowPct}%   >=1: ${baseline.anyPct}%`);
console.log(`  felt-styrke p10/p50/p90: ${baseline.p10.toFixed(1)} / ${baseline.p50.toFixed(1)} / ${baseline.p90.toFixed(1)}\n`);

// ── FYLDNING pr. N (top-up managere; window-uafhængig) — målt over managere ────
const fillWin = TAIL_WINDOWS[0];
console.log("=== FYLDNING pr. trup-størrelse N (top-up ægte managere til N) — målt over manageres felter ===");
console.log("   N | FULDT% | forceret no-show% | >=1%");
for (const N of [8, ...TRUP_SIZES]) {
  const s = score(topUpManagers(fillWin, N), isManager);
  console.log(`  ${String(N).padStart(2)} |   ${String(s.fullPct).padStart(3)}  |        ${String(s.noShowPct).padStart(3)}        | ${s.anyPct}`);
}

// ── STYRKE-SPREDNING pr. (N × hale-vindue) — målt over manageres felter ────────
console.log("\n=== FELT-STYRKE p10/p50/p90 pr. (N × hale-vindue) — manageres felter ===");
console.log("   N | hale-vindue     | p10  / p50  / p90  | FULDT%");
for (const N of TRUP_SIZES) {
  for (const win of TAIL_WINDOWS) {
    const s = score(topUpManagers(win, N), isManager);
    console.log(`  ${String(N).padStart(2)} | ${win.label.padEnd(15)} | ${s.p10.toFixed(1).padStart(4)} / ${s.p50.toFixed(1).padStart(4)} / ${s.p90.toFixed(1).padStart(4)} |  ${s.fullPct}`);
  }
}

console.log("\n(Peak-concurrency=2 verificeret. Mål: løft baseline-FULDT mod acceptabelt + sænk forceret no-show, uden at p50-felt-styrke ryger for højt/lavt.)");
process.exit(0);
