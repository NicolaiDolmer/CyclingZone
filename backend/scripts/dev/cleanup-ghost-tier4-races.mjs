// Engangs-oprydning: slet TOMME "spøgelses"-løb i puljer der efter den nuværende
// politik slet ikke skulle have en kalender. Symptom (3/7): 192 scheduled-løb i
// Division 4 (tier 4, puljer A-H = league_division_id 8-15) hænger med entries=0.
// De divisioner har 0 ægte managere, så entry-generatoren fylder dem aldrig →
// permanente spøgelser der forfalder én for én i scheduler-køen.
//
// ROD-ÅRSAG: kalender-politikken er allerede kodet i poolHasCalendar() — tier 1/2 får
// ALTID kalender, tier 3/4 kun med >=1 ægte manager i puljen. Disse løb modsiger den
// (stale artefakter fra chronrebuild 30/6, der omgik gaten). Scriptet sletter derfor
// PRÆCIS de løb der ligger i puljer hvor poolHasCalendar(tier, realManagerCount)===false
// — 1:1 med koden, ikke hardcodede division-numre. Får en pulje senere en manager,
// materialiserer sæson-flowet en frisk kalender (uændret).
//
// Tre-lags sikkerhed (springer ALT over der ikke er 100% tomt):
//   1) kun puljer hvor poolHasCalendar===false (managerløse tier 3/4)
//   2) kun status='scheduled' OG stages_completed=0 (aldrig et igangværende/afviklet løb)
//   3) 0 race_entries OG 0 race_results OG 0 finance_transactions (verificeret pr. løb)
// CASCADE rydder race_stage_schedule + race_stage_profiles; finance_transactions er
// NO ACTION → et løb med en finanstransaktion springes over (ellers fejler DELETE).
//
// Dry-run: infisical run --env=prod -- node backend/scripts/dev/cleanup-ghost-tier4-races.mjs
// Apply:   infisical run --env=prod -- node backend/scripts/dev/cleanup-ghost-tier4-races.mjs --apply
import { createClient } from "@supabase/supabase-js";
import { poolHasCalendar } from "../../lib/divisionCalendarGenerator.js";

const APPLY = process.argv.includes("--apply");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Samme "ægte manager"-diskriminator som seasonCalendarMaterializer + aiTeamGenerator.
function isRealManager(t) {
  return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
}

const IN_CHUNK = 200;
async function idSetFor(table, column, ids) {
  const set = new Set();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await db.from(table).select(column).in(column, chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data || []) set.add(row[column]);
  }
  return set;
}

async function main() {
  // 1. Aktiv sæson.
  const { data: season, error: sErr } = await db
    .from("seasons").select("id, number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) { console.log("Ingen aktiv sæson — intet at gøre."); return; }

  // 2. Puljer + ægte-manager-tælling pr. pulje.
  const { data: pools, error: pErr } = await db
    .from("league_divisions").select("id, tier, label");
  if (pErr) throw new Error(`league_divisions: ${pErr.message}`);
  const { data: teams, error: tErr } = await db
    .from("teams").select("is_ai, is_bank, is_frozen, is_test_account, league_division_id");
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const realCount = new Map();
  for (const t of teams || []) {
    if (isRealManager(t) && t.league_division_id != null) {
      realCount.set(t.league_division_id, (realCount.get(t.league_division_id) || 0) + 1);
    }
  }

  // 3. "Døde" puljer = dem koden selv siger ikke skal have kalender.
  const deadPools = (pools || []).filter((p) => !poolHasCalendar(p.tier, realCount.get(p.id) || 0));
  const deadPoolIds = deadPools.map((p) => p.id);
  console.log(`Aktiv sæson: #${season.number}`);
  console.log(`Managerløse puljer (poolHasCalendar=false): ${deadPoolIds.length}` +
    (deadPools.length ? ` → ${deadPools.map((p) => `${p.label}(tier ${p.tier})`).join(", ")}` : ""));
  if (!deadPoolIds.length) { console.log("Ingen døde puljer — intet at rydde."); return; }

  // 4. Scheduled, ikke-startede løb i de døde puljer.
  const { data: races, error: rErr } = await db
    .from("races")
    .select("id, name, league_division_id, stages_completed")
    .eq("season_id", season.id)
    .eq("status", "scheduled")
    .in("league_division_id", deadPoolIds);
  if (rErr) throw new Error(`races: ${rErr.message}`);
  const notStarted = (races || []).filter((r) => (r.stages_completed ?? 0) === 0);
  const raceIds = notStarted.map((r) => r.id);
  console.log(`Scheduled løb i døde puljer: ${races?.length || 0} (ikke-startede: ${raceIds.length})`);
  if (!raceIds.length) { console.log("Ingen kandidater."); return; }

  // 5. Guard: verificér hvert løb er 100% tomt (0 entries, 0 results, 0 finance_tx).
  const withEntries = await idSetFor("race_entries", "race_id", raceIds);
  const withResults = await idSetFor("race_results", "race_id", raceIds);
  const withFinance = await idSetFor("finance_transactions", "race_id", raceIds);

  const ghosts = [];
  const kept = [];
  for (const r of notStarted) {
    if (withEntries.has(r.id)) { kept.push([r, "har entries"]); continue; }
    if (withResults.has(r.id)) { kept.push([r, "har results"]); continue; }
    if (withFinance.has(r.id)) { kept.push([r, "har finance_tx"]); continue; }
    ghosts.push(r);
  }
  console.log(`\nSpøgelsesløb (100% tomme): ${ghosts.length}`);
  if (kept.length) {
    console.log(`SPRINGER OVER (ikke tomme): ${kept.length}`);
    for (const [r, why] of kept.slice(0, 20)) console.log(`  - ${r.name} (pulje ${r.league_division_id}): ${why}`);
  }
  const byPool = new Map();
  for (const g of ghosts) byPool.set(g.league_division_id, (byPool.get(g.league_division_id) || 0) + 1);
  console.log("Pr. pulje:", Object.fromEntries([...byPool].sort((a, b) => a[0] - b[0])));

  if (!APPLY) {
    console.log("\nDRY-RUN — intet slettet. Kør med --apply for at slette (CASCADE rydder schedule+profiler).");
    return;
  }

  // 6. Slet (CASCADE rydder race_stage_schedule + race_stage_profiles). Én ad gangen for
  // klar fejl-lokalisering; lavt volumen.
  let deleted = 0;
  for (const g of ghosts) {
    const { error } = await db.from("races").delete().eq("id", g.id)
      .eq("status", "scheduled").eq("stages_completed", 0);
    if (error) throw new Error(`delete race ${g.id} (${g.name}): ${error.message}`);
    deleted++;
  }
  console.log(`\nAPPLY — slettede ${deleted} spøgelsesløb (+ cascade schedule/profiler).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
