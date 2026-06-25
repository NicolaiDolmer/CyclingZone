// DRY-RUN (read-only): vis effekten af at køre de korrupte løb om, FØR noget skrives.
// Skriver INTET til prod — kun queries + in-memory re-simulering med den FIXEDE motor.
//
// Dækker (race-audit 2026-06-25):
//   1. Boucles Mayennaises (Div 3-C, afviklet) — mid-race-vinder (#1844). Re-sim med det
//      frosne etape-1-felt (de overlevende ryttere) → korrekt GC + præmie/point-delta pr. hold.
//   2. Tour des Alpes Suisses (Div 1, in-flight) — 142 dobbeltbookede (#1845). Vis binding-
//      korrigeret felt (ekskl. den igangværende La Corsas ryttere).
//   3. Tour des Émirats (Div 1, in-flight) — tyndt felt; bekræft om det reelt var korrupt.
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/rerun-corrupt-races-dryrun.mjs
import { createClient } from "@supabase/supabase-js";
import { buildRaceResults } from "../../lib/raceRunner.js";
import { buildRacePointsLookup, PRIZE_PER_POINT } from "../../lib/raceResultsEngine.js";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { raceBindingWindow, windowsOverlap } from "../../lib/raceBinding.js";
import { excludeBoundRiders } from "../../lib/raceFieldIntegrity.js";
import { autopickTeamSelection, selectionSizeForRace } from "../../lib/raceAutopick.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const fmtCz = (n) => `${Math.round(n).toLocaleString("da-DK")} CZ$`;

async function pagedIn(table, columns, col, ids, extra) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    for (let from = 0; ; from += 1000) {
      let q = db.from(table).select(columns).in(col, chunk).range(from, from + 999);
      if (extra) q = extra(q);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

async function getRace(name) {
  const { data, error } = await db.from("races")
    .select("id, name, race_type, race_class, stages, stages_completed, status, league_division_id, season_id")
    .eq("name", name).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadStages(raceId) {
  const { data } = await db.from("race_stage_profiles")
    .select("stage_number, profile_type, finale_type, demand_vector").eq("race_id", raceId)
    .order("stage_number", { ascending: true });
  return data || [];
}

async function startFieldSnapshot(raceId) {
  const { data } = await db.from("race_simulation_runs")
    .select("stage_number, entrant_snapshot").eq("race_id", raceId)
    .order("stage_number", { ascending: true }).limit(1);
  const snap = data?.[0]?.entrant_snapshot;
  return Array.isArray(snap) ? snap.map((x) => (typeof x === "string" ? x : x?.rider_id)).filter(Boolean) : [];
}

// Byg entrants for et sæt rider_ids (kun dem der stadig findes + har abilities).
async function buildEntrants(riderIds, raceId) {
  if (!riderIds.length) return { entrants: [], missing: [] };
  const riders = await pagedIn("riders", "id, firstname, lastname, is_u25, team_id", "id", riderIds,
    (q) => q.or("is_retired.is.null,is_retired.eq.false"));
  const abil = await pagedIn("rider_derived_abilities", ["rider_id", ...ABILITY_KEYS].join(", "), "rider_id", riderIds);
  const cond = await pagedIn("rider_condition", "rider_id, form, fatigue", "rider_id", riderIds);
  const roleRows = await pagedIn("race_entries", "rider_id, team_id, race_role", "rider_id", riderIds, (q) => q.eq("race_id", raceId));
  const abById = new Map(abil.map((a) => [a.rider_id, a]));
  const condById = new Map(cond.map((c) => [c.rider_id, c]));
  const roleById = new Map(roleRows.map((r) => [r.rider_id, r.race_role]));
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const entrants = [];
  const missing = [];
  for (const rid of riderIds) {
    const r = riderById.get(rid);
    const ab = abById.get(rid);
    if (!r || !ab) { missing.push(rid); continue; }
    const c = condById.get(rid);
    const e = {
      rider_id: rid, team_id: r.team_id ?? null,
      rider_name: [r.firstname, r.lastname].filter(Boolean).join(" ") || null,
      is_u25: !!r.is_u25, abilities: ab,
    };
    const role = roleById.get(rid);
    if (role) e.race_role = role;
    if (c) { e.form = c.form; e.fatigue = c.fatigue; }
    entrants.push(e);
  }
  return { entrants, missing };
}

async function loadPointsLookup(race) {
  const { data } = await db.from("race_points").select("result_type, rank, points").eq("race_class", race.race_class);
  return buildRacePointsLookup({ racePoints: data || [], raceType: race.race_type });
}

function prizeByTeam(rows) {
  const m = new Map();
  for (const r of rows) if (r.team_id && r.prize_money) m.set(r.team_id, (m.get(r.team_id) || 0) + r.prize_money);
  return m;
}

async function teamMeta(teamIds) {
  if (!teamIds.length) return new Map();
  const { data } = await db.from("teams").select("id, name, is_ai").in("id", [...teamIds]);
  return new Map((data || []).map((t) => [t.id, t]));
}

// ── 1. Boucles: re-sim med frosset start-felt ─────────────────────────────────
async function reSimBoucles() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("1) BOUCLES MAYENNAISES — re-sim med frosset etape-1-felt (#1844)");
  console.log("══════════════════════════════════════════════════════════════");
  const race = await getRace("Boucles Mayennaises");
  const stages = await loadStages(race.id);
  const snap = await startFieldSnapshot(race.id);
  const { entrants, missing } = await buildEntrants(snap, race.id);
  const pointsLookup = await loadPointsLookup(race);

  // GAMMEL tilstand
  const { data: oldRows } = await db.from("race_results")
    .select("result_type, rank, rider_id, rider_name, team_id, prize_money, stage_number").eq("race_id", race.id);
  const oldGc = (oldRows || []).filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank);
  const { data: oldTx } = await db.from("finance_transactions")
    .select("team_id, amount").eq("race_id", race.id).eq("type", "prize");
  const oldPaid = new Map();
  for (const t of oldTx || []) oldPaid.set(t.team_id, (oldPaid.get(t.team_id) || 0) + t.amount);

  // NY tilstand (frosset felt, fixet motor)
  const { resultRows } = buildRaceResults({ race, stages, entrants, pointsLookup });
  const newGc = resultRows.filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank);
  const newPayable = prizeByTeam(resultRows);

  const allTeams = new Set([...oldPaid.keys(), ...newPayable.keys()]);
  const meta = await teamMeta([...allTeams]);

  console.log(`Start-felt (etape-1-snapshot): ${snap.length} ryttere · ${entrants.length} simuleret · ${missing.length} SLETTET (udeladt)`);
  console.log(`\nGAMMEL GC-top5 (forkert):`);
  for (const g of oldGc.slice(0, 5)) console.log(`  ${g.rank}. ${g.rider_name}`);
  console.log(`NY GC-top5 (frosset felt):`);
  for (const g of newGc.slice(0, 5)) console.log(`  ${g.rank}. ${g.rider_name}`);
  console.log(`\nVinder-skift: "${oldGc[0]?.rider_name}" → "${newGc[0]?.rider_name}"`);

  console.log(`\nPræmie-delta pr. hold (ny udbetalbar − gammel betalt):`);
  const teamRows = [...allTeams].map((id) => {
    const t = meta.get(id);
    return { id, name: t?.name ?? id.slice(0, 8), is_ai: t?.is_ai, old: oldPaid.get(id) || 0, neu: newPayable.get(id) || 0 };
  }).filter((r) => r.old !== r.neu).sort((a, b) => (b.neu - b.old) - (a.neu - a.old));
  for (const r of teamRows) {
    const d = r.neu - r.old;
    console.log(`  ${(r.is_ai ? "[AI] " : "[REEL] ").padEnd(7)}${(r.name || "").padEnd(24)} ${fmtCz(r.old).padStart(14)} → ${fmtCz(r.neu).padStart(14)}  (${d >= 0 ? "+" : ""}${fmtCz(d)})`);
  }
  const realChanged = teamRows.filter((r) => !r.is_ai);
  console.log(`\nReelle hold med præmie-ændring: ${realChanged.length}`);
  console.log(`Total gammel betalt: ${fmtCz([...oldPaid.values()].reduce((s, v) => s + v, 0))} · total ny udbetalbar: ${fmtCz([...newPayable.values()].reduce((s, v) => s + v, 0))}`);
}

// ── 2+3. Div-1 in-flight løb: binding-korrigeret felt-preview ──────────────────
async function previewInflight(name, inflightRivalName) {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`2/3) ${name.toUpperCase()} — binding-korrigeret felt-preview (#1845)`);
  console.log("══════════════════════════════════════════════════════════════");
  const race = await getRace(name);
  const rival = await getRace(inflightRivalName); // La Corsa (igangværende)
  const stages = await loadStages(race.id);

  // Dette løbs vindue + rivalens (binding-)vindue + rivalens ryttere pr. hold.
  const { data: mySched } = await db.from("race_stage_schedule").select("scheduled_at").eq("race_id", race.id);
  const thisWindow = raceBindingWindow(mySched);
  const { data: rivalSched } = await db.from("race_stage_schedule").select("scheduled_at").eq("race_id", rival.id);
  const rivalWindow = raceBindingWindow(rivalSched);
  const overlaps = windowsOverlap(thisWindow, rivalWindow);

  // Rivalens entries (de bundne ryttere) pr. hold.
  const { data: rivalEntries } = await db.from("race_entries").select("team_id, rider_id").eq("race_id", rival.id);
  const rivalRidersByTeam = new Map();
  for (const e of rivalEntries || []) {
    if (!rivalRidersByTeam.has(e.team_id)) rivalRidersByTeam.set(e.team_id, []);
    rivalRidersByTeam.get(e.team_id).push(e.rider_id);
  }

  // Div-1 eligible hold + deres ryttere.
  const { data: teams } = await db.from("teams")
    .select("id, name, is_ai, is_frozen, is_test_account, league_division_id")
    .eq("league_division_id", race.league_division_id);
  const eligible = (teams || []).filter((t) => !t.is_frozen && !t.is_test_account);
  const teamIds = eligible.map((t) => t.id);
  const riders = await pagedIn("riders", "id, team_id", "team_id", teamIds, (q) => q.or("is_retired.is.null,is_retired.eq.false"));
  const ridersByTeam = new Map();
  for (const r of riders) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push({ rider_id: r.id });
  }
  const sizeRule = selectionSizeForRace(race);

  // Aktuelt (forkert) felt: hvad ligger der nu i dette løbs entries?
  const { data: curEntries } = await db.from("race_entries").select("rider_id, team_id").eq("race_id", race.id);
  const curIds = new Set((curEntries || []).map((e) => e.rider_id));
  // Hvor mange af det nuværende felt er bundet i rivalen (overlap)?
  let curDouble = 0;
  for (const e of curEntries || []) {
    if ((rivalRidersByTeam.get(e.team_id) || []).includes(e.rider_id)) curDouble++;
  }

  // Binding-korrigeret felt: pr. hold, ekskludér rivalens ryttere (hvis overlap), autopick.
  let correctedSize = 0;
  for (const t of eligible) {
    const teamRiders = ridersByTeam.get(t.id) || [];
    const otherRaces = overlaps ? [{ window: rivalWindow, riderIds: rivalRidersByTeam.get(t.id) || [] }] : [];
    const available = excludeBoundRiders({ riders: teamRiders, thisWindow, otherRaces });
    correctedSize += autopickTeamSelection({ riders: available, stages, sizeRule }).length;
  }

  console.log(`Status: ${race.status}, stages_completed=${race.stages_completed} (in-flight) · vindue-overlap m. ${rival.name}: ${overlaps}`);
  console.log(`Nuværende (forkerte) felt: ${curIds.size} ryttere, heraf ${curDouble} dobbeltbooket med ${rival.name}.`);
  console.log(`Binding-korrigeret felt (fixet motor): ~${correctedSize} ryttere (rivalens bundne ryttere ekskluderet).`);
  console.log(`Prize: løbet er '${race.status}' → IKKE udbetalt endnu → ingen penge at reversere. Reset+genkør via fixet motor.`);
}

console.log("DRY-RUN — INGEN prod-mutation. Re-sim/preview med den fixede motor.");
await reSimBoucles();
await previewInflight("Tour des Alpes Suisses", "La Corsa dei Due Mari");
await previewInflight("Tour des Émirats", "La Corsa dei Due Mari");
console.log("\n✅ Dry-run færdig — intet skrevet til prod.");
