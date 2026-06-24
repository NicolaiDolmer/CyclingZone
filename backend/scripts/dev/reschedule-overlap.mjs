// Re-schedule den aktive sæsons scheduled løb til overlap-format (planRaceSchedules
// tracks=2), pr. pulje. Dry-run default: rapporterer ny peak-concurrency + binding-
// konflikter i eksisterende manuelle udtagelser UDEN writes. --live (ejer-go) skriver
// scheduled_for + race_stage_schedule og rydder konflikt-entries.
//
// Kør (preview): infisical run --env=prod -- node backend/scripts/dev/reschedule-overlap.mjs
// Kør (LIVE):    infisical run --env=prod -- node backend/scripts/dev/reschedule-overlap.mjs --live
import { createClient } from "@supabase/supabase-js";
import { planRaceSchedules } from "../backfillRaceScheduledFor.js";
import { raceTimeWindow, findManualOverlapConflicts } from "../../lib/raceBinding.js";

const LIVE = process.argv.includes("--live");
// --allow-partial: reschedule KUN de rene (scheduled/0-afviklet) løb og spring
// afviklede/igangværende over (bevares urørt). Til mid-sæson-aktivering hvor clean-
// slate-antagelsen ikke holder. Uden flaget bevares den oprindelige alt-eller-intet-
// sikkerhed (STOP ved enhver ikke-ren række — sikkert default for friske sæsoner).
const ALLOW_PARTIAL = process.argv.includes("--allow-partial");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function readAllIn(table, cols, inCol, ids) {
  const out = []; const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const { data, error } = await sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number} — ${LIVE ? "LIVE (skriver)" : "DRY-RUN (ingen writes)"}\n`);

// SIKKERHED: kun scheduled løb uden afviklede etaper.
const { data: races } = await sb.from("races")
  .select("id, name, league_division_id, stages, status, stages_completed").eq("season_id", season.id);
const reschedulable = races.filter((r) => r.status === "scheduled" && (r.stages_completed || 0) === 0);
if (reschedulable.length !== races.length) {
  const skipped = races.length - reschedulable.length;
  if (!ALLOW_PARTIAL) {
    console.error(`STOP: ${skipped} løb er IKKE rene scheduled/0-afviklet. Afbryd og afklar (eller --allow-partial for kun at reschedule de rene).`);
    process.exit(1);
  }
  console.log(`--allow-partial: springer ${skipped} ikke-rene løb over (afviklet/igangværende) — kun ${reschedulable.length} rene løb re-schedules; øvrige bevares urørt.\n`);
}

// Planlæg overlap pr. pulje fra et fælles anker (i morgen).
const anchor = new Date();
const racesByPool = new Map();
for (const r of reschedulable) { const k = r.league_division_id ?? "null"; if (!racesByPool.has(k)) racesByPool.set(k, []); racesByPool.get(k).push(r); }
const allRaceUpdates = [];
const allStageRows = [];
const newWin = new Map();
for (const [, poolRaces] of racesByPool) {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: poolRaces.map((r) => ({ id: r.id, name: r.name, stages: r.stages })), from: anchor, tracks: 2 });
  allRaceUpdates.push(...raceUpdates);
  allStageRows.push(...stageRows);
  const byRace = new Map();
  for (const s of stageRows) { if (!byRace.has(s.race_id)) byRace.set(s.race_id, []); byRace.get(s.race_id).push(s); }
  for (const [id, rows] of byRace) newWin.set(id, raceTimeWindow(rows));
}

// Ny peak-concurrency pr. pulje (rapport).
for (const [poolKey, poolRaces] of racesByPool) {
  const ev = [];
  for (const r of poolRaces) { const w = newWin.get(r.id); if (w) ev.push([w.start, 1], [w.end, -1]); }
  ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let cur = 0, peak = 0; for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur); }
  console.log(`  pulje ${poolKey}: ${poolRaces.length} løb → ny peak-concurrency = ${peak}`);
}

// Binding-konflikter i eksisterende MANUELLE udtagelser (pr. hold).
const raceIds = reschedulable.map((r) => r.id);
const manualEntries = (await readAllIn("race_entries", "race_id, team_id, rider_id, is_auto_filled", "race_id", raceIds))
  .filter((e) => e.is_auto_filled === false);
const byTeam = new Map();
for (const e of manualEntries) { if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []); byTeam.get(e.team_id).push(e); }
const dropSet = new Map(); // dedup-nøgle "race|team|rider" → {race_id, team_id, rider_id}
for (const [team_id, entries] of byTeam) {
  const conflicts = findManualOverlapConflicts({ entries: entries.map((e) => ({ race_id: e.race_id, rider_id: e.rider_id })), windowByRace: newWin });
  for (const c of conflicts) dropSet.set(`${c.dropRaceId}|${team_id}|${c.rider_id}`, { race_id: c.dropRaceId, team_id, rider_id: c.rider_id });
}
const conflictDrops = [...dropSet.values()];
console.log(`\nManuelle entries: ${manualEntries.length} · binding-konflikter efter overlap (dedup'ede drops): ${conflictDrops.length}`);
for (const c of conflictDrops.slice(0, 20)) console.log(`  drop rytter ${c.rider_id} fra løb ${c.race_id} (hold ${c.team_id})`);

if (!LIVE) {
  console.log("\nDRY-RUN — ingen writes. Kør med --live efter ejer-go.");
  process.exit(0);
}

// LIVE: opdatér scheduled_for, erstat race_stage_schedule, ryd konflikt-entries.
// Rækkefølge: scheduled_for → delete stage_schedule → insert nye → drop konflikter. Fejler
// insert-trinnet, er re-kørsel sikker (quasi-idempotent): løbene er stadig status='scheduled'
// + stages_completed=0, så safety-gatten ovenfor tillader en ren re-kørsel der genskaber alt.
for (const ru of allRaceUpdates) {
  const { error } = await sb.from("races").update({ scheduled_for: ru.scheduled_for }).eq("id", ru.id);
  if (error) throw new Error(`races update ${ru.id}: ${error.message}`);
}
for (let i = 0; i < raceIds.length; i += 200) {
  const { error } = await sb.from("race_stage_schedule").delete().in("race_id", raceIds.slice(i, i + 200));
  if (error) throw new Error(`race_stage_schedule delete: ${error.message}`);
}
for (let i = 0; i < allStageRows.length; i += 500) {
  const { error } = await sb.from("race_stage_schedule").insert(allStageRows.slice(i, i + 500));
  if (error) throw new Error(`race_stage_schedule insert: ${error.message}`);
}
for (const c of conflictDrops) {
  const { error } = await sb.from("race_entries").delete().eq("race_id", c.race_id).eq("team_id", c.team_id).eq("rider_id", c.rider_id).eq("is_auto_filled", false);
  if (error) throw new Error(`konflikt-drop ${c.rider_id}/${c.race_id}: ${error.message}`);
}
console.log(`\nLIVE: ${allRaceUpdates.length} løb re-scheduled · ${allStageRows.length} etape-tider · ${conflictDrops.length} konflikt-entries ryddet.`);
process.exit(0);
