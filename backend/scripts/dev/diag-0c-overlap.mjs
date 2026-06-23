// Read-only diagnostik: dump løb-vinduer pr. pulje for at verificere overlap-grad.
// Kør: infisical run --env=prod -- node backend/scripts/dev/diag-0c-overlap.mjs
import { createClient } from "@supabase/supabase-js";
import { raceTimeWindow, windowsOverlap } from "../../lib/raceBinding.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const { data: season } = await sb.from("seasons").select("id, number").eq("status", "active").maybeSingle();

const { data: races } = await sb.from("races")
  .select("id, name, league_division_id, race_class, stages, status").eq("season_id", season.id);
const raceIds = races.map((r) => r.id);
const sched = [];
for (let i = 0; i < raceIds.length; i += 200) {
  const { data } = await sb.from("race_stage_schedule").select("race_id, scheduled_at, stage_number").in("race_id", raceIds.slice(i, i + 200));
  sched.push(...(data || []));
}
const byRace = new Map();
for (const s of sched) { if (!byRace.has(s.race_id)) byRace.set(s.race_id, []); byRace.get(s.race_id).push(s); }

const fmt = (ms) => ms == null ? "—" : new Date(ms).toISOString().replace("T", " ").slice(0, 16);
const dk = (ms) => ms == null ? "—" : new Date(ms).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

// Tæl stage races vs endagsløb totalt.
let stageRaces = 0, oneDay = 0, noWindow = 0;
for (const r of races) {
  const w = raceTimeWindow(byRace.get(r.id));
  if (!w) { noWindow++; continue; }
  if ((r.stages || 1) > 1) stageRaces++; else oneDay++;
}
console.log(`Sæson #${season.number}: ${races.length} løb — ${stageRaces} stage races, ${oneDay} endagsløb, ${noWindow} uden vindue\n`);

// For 2 puljer: dump løb sorteret på start + flag overlap-par.
for (const pool of [1, 2]) {
  const pr = races.filter((r) => r.league_division_id === pool)
    .map((r) => ({ r, w: raceTimeWindow(byRace.get(r.id)) }))
    .filter((x) => x.w).sort((a, b) => a.w.start - b.w.start);
  console.log(`=== Pulje ${pool}: ${pr.length} løb m. vindue (DK-tid) ===`);
  for (const { r, w } of pr) {
    const span = w.start === w.end ? "endags" : `${((w.end - w.start) / 86400000).toFixed(1)}d`;
    console.log(`  ${dk(w.start)}–${dk(w.end)} [${span}] s=${r.stages || 1} ${r.race_class || "?"} ${(r.name || "").slice(0, 30)}`);
  }
  // Overlap-par.
  let pairs = 0;
  for (let i = 0; i < pr.length; i++) for (let j = i + 1; j < pr.length; j++) if (windowsOverlap(pr[i].w, pr[j].w)) pairs++;
  console.log(`  → overlappende løb-par i puljen: ${pairs}\n`);
}
process.exit(0);
