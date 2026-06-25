// Engangs prod-fix (#1823): regenerér holdenes AUTO-filled race_entries med det dag-
// granulære binding-vindue, så de 798 samme-CET-dag-dobbeltbookinger forsvinder.
// runRaceEntryGenerator bevarer manuelle entries og SPRINGER igangværende løb over
// (#1825-frys, lås deres ryttere) — så et igangværende etapeløb (La Corsa) ikke røres.
//
// SIKKER PRE-FLIGHT som standard: en capture-klient gør ENHVER write til en no-op og
// fanger kun de rows generatoren VILLE skrive. Krydstjek med raceBindingWindow (CET-dag)
// bekræfter 0 samme-dag-dobbeltbookinger FØR vi rører prod. --live skriver faktisk.
//
// Kør pre-flight:  infisical run --env=prod -- node backend/scripts/dev/regenerate-entries-binding-fix.mjs
// Kør live:        infisical run --env=prod -- node backend/scripts/dev/regenerate-entries-binding-fix.mjs --live
import { createClient } from "@supabase/supabase-js";
import { runRaceEntryGenerator } from "../../lib/raceEntryGenerator.js";
import { raceBindingWindow, windowsOverlap } from "../../lib/raceBinding.js";

const LIVE = process.argv.includes("--live");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const real = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Capture-klient: fanger insert-rows; writes er no-op i pre-flight, ægte i --live.
const captured = { inserts: [] };
function noopChain() {
  const chain = { eq: () => chain, in: () => chain, neq: () => chain, then: (r) => r({ data: null, error: null }) };
  return chain;
}
const client = {
  from(table) {
    const rb = real.from(table);
    return new Proxy(rb, {
      get(t, prop) {
        if (prop === "insert") return (rows) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          captured.inserts.push(...arr);
          return LIVE ? real.from(table).insert(rows) : Promise.resolve({ data: null, error: null });
        };
        if (prop === "delete") return () => (LIVE ? real.from(table).delete() : noopChain());
        const v = t[prop];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  },
};

const { data: season } = await real.from("seasons").select("id, number").eq("status", "active").maybeSingle();
if (!season) { console.error("ingen aktiv sæson"); process.exit(1); }
console.log(`Aktiv sæson: #${season.number} (${season.id}) · MODE=${LIVE ? "LIVE (skriver)" : "PRE-FLIGHT (no-op)"}\n`);

// Igangværende løb (skal springes over + ikke modtage staged rows).
const { data: allRaces } = await real
  .from("races").select("id, name, stages_completed, league_division_id").eq("season_id", season.id);
const startedRaces = (allRaces || []).filter((r) => (r.stages_completed ?? 0) > 0);
console.log(`Igangværende løb (frosne, springes over): ${startedRaces.map((r) => `${r.name} [${r.stages_completed} etaper]`).join(", ") || "ingen"}\n`);
const startedIds = new Set(startedRaces.map((r) => r.id));

const res = await runRaceEntryGenerator({ supabase: client, seasonId: season.id, dryRun: false });
console.log("=== GENERATOR-RESULTAT ===");
console.log(JSON.stringify({ races: res.races, teams: res.teams, generated: res.generated, skipped: res.skipped }, null, 2));

// Krydstjek de staged rows med CET-dag-binding: ingen rytter i to samme-dag-løb (samme hold).
const schedRows = [];
const raceIds = (allRaces || []).map((r) => r.id);
for (let i = 0; i < raceIds.length; i += 200) {
  const { data } = await real.from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", raceIds.slice(i, i + 200)).range(0, 9999);
  schedRows.push(...(data || []));
}
const schedByRace = new Map();
for (const s of schedRows) { if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []); schedByRace.get(s.race_id).push(s); }
const bindingWindow = new Map(raceIds.map((id) => [id, raceBindingWindow(schedByRace.get(id))]));

// Manuelle (race,team)-par (is_auto_filled=false) må ALDRIG dukke op i staged output.
const manualPairs = new Set();
for (let i = 0; i < raceIds.length; i += 200) {
  const { data } = await real.from("race_entries").select("race_id, team_id")
    .eq("is_auto_filled", false).in("race_id", raceIds.slice(i, i + 200)).range(0, 99999);
  for (const e of data || []) manualPairs.add(`${e.race_id}|${e.team_id}`);
}

let dayDoubleBookings = 0, startedTouched = 0, manualTouched = 0;
const byTeamRider = new Map(); // "team|rider" → [window]
for (const row of captured.inserts) {
  if (startedIds.has(row.race_id)) startedTouched++;
  if (manualPairs.has(`${row.race_id}|${row.team_id}`)) manualTouched++;
  const w = bindingWindow.get(row.race_id);
  const k = `${row.team_id}|${row.rider_id}`;
  if (!byTeamRider.has(k)) byTeamRider.set(k, []);
  byTeamRider.get(k).push(w);
}
for (const [, windows] of byTeamRider) {
  for (let i = 0; i < windows.length; i++)
    for (let j = i + 1; j < windows.length; j++)
      if (windowsOverlap(windows[i], windows[j])) dayDoubleBookings++;
}

console.log("\n=== KRYDSTJEK (CET-dag-binding på staged rows) ===");
console.log(`Samme-dag-dobbeltbookinger i staged output: ${dayDoubleBookings} (forventet 0)`);
console.log(`Staged rows i igangværende løb:             ${startedTouched} (forventet 0 — frys)`);
console.log(`Staged rows på manuelle (race,team):        ${manualTouched} (forventet 0 — manuelle bevares)`);

const ok = dayDoubleBookings === 0 && startedTouched === 0 && manualTouched === 0;
console.log(`\n${ok ? "✅ SIKKER" : "❌ STOP"} — ${LIVE ? "skrevet til prod" : "intet skrevet (pre-flight)"}.`);
if (!ok) process.exit(1);
if (!LIVE) console.log("\nKør med --live for at anvende.");
process.exit(0);
