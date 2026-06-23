// Race-hub 0c: ENGANGS additiv dybde-top-up. For hvert eligible hold uden
// starter_depth_topped_up_at-markør: tilføj svage hale-domestiques ([50,52]) op til
// STARTER_SQUAD.TOTAL_SIZE (12), derive dem (data-hale), sæt markør. Additiv — rører
// ALDRIG eksisterende ryttere; giver aldrig kerne-ryttere. Idempotent på markøren.
//
// Selector: alle konkurrerende hold (managere OG AI), ekskl. bank/frosset/test
// (NULL-tolerant) — så overlap-løb har fulde modstander-felter (ejer-valg 23/6).
//
// Dry-run (default): rapportér hold + ryttere der VILLE tilføjes. Ingen writes.
//   infisical run --env=prod -- node backend/scripts/dev/topup-starter-depth.mjs
// Live (ejer-go): faktisk insert + derive + markør.
//   infisical run --env=prod -- node backend/scripts/dev/topup-starter-depth.mjs --live
import { createClient } from "@supabase/supabase-js";
import { STARTER_SQUAD, STARTER_TAIL_STAT_WINDOW, buildWeakStarterPool, deriveTeamSeed } from "../../lib/starterSquadAllocator.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { foldNameNordic } from "../../lib/pcmRiderMatcher.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";

const LIVE = process.argv.includes("--live");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SIZE = STARTER_SQUAD.TOTAL_SIZE;
const INSERT_BATCH = 500;

// Eligible konkurrerende hold uden top-up-markør (managere OG AI; ekskl. bank/
// frosset/test). Ét .or() til test-flag + post-filter for bank/frosset — samme
// mønster som raceEntryGenerator.js / simulate-base-rider-depth.mjs (de validerede
// tal). Flere chained .or()-kald sender duplikate PostgREST or=-params hvis adfærd
// er uspecificeret → kan stille-ignorere filtre; undgås her.
const { data: teams, error: tErr } = await sb.from("teams")
  .select("id, is_bank, is_frozen, is_test_account, starter_depth_topped_up_at")
  .or("is_test_account.is.null,is_test_account.eq.false");
if (tErr) { console.error("teams:", tErr.message); process.exit(1); }
const eligible = (teams || []).filter((t) => !t.is_bank && !t.is_frozen);
const pending = eligible.filter((t) => !t.starter_depth_topped_up_at);
console.log(`${LIVE ? "LIVE" : "DRY-RUN"} — ${pending.length}/${eligible.length} eligible hold uden top-up-markør\n`);

// Nuværende rytter-antal pr. hold (ikke-pensioneret).
const ids = pending.map((t) => t.id);
const riderCounts = new Map(ids.map((id) => [id, 0]));
const riders = await fetchAllRows(() =>
  sb.from("riders").select("team_id").in("team_id", ids).or("is_retired.is.null,is_retired.eq.false"));
for (const r of riders) riderCounts.set(r.team_id, (riderCounts.get(r.team_id) || 0) + 1);

// Navne-unikhed mod ALLE eksisterende ryttere.
const existing = await fetchAllRows(() => sb.from("riders").select("firstname, lastname").order("id"));
const existingFoldedNames = new Set(existing.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));

let totalToAdd = 0;
const plan = [];
for (const t of pending) {
  const need = Math.max(0, SIZE - (riderCounts.get(t.id) || 0));
  if (need > 0) { totalToAdd += need; plan.push({ teamId: t.id, need }); }
}
console.log(`Hale-ryttere der tilføjes: ${totalToAdd} (på ${plan.length} hold; ${pending.length - plan.length} hold er allerede ≥${SIZE})`);

if (!LIVE) {
  console.log("\n(dry-run — intet skrevet. Kør med --live efter ejer-go.)");
  process.exit(0);
}

const nowIso = new Date().toISOString();
let added = 0;
for (const { teamId, need } of plan) {
  const tailSeed = deriveTeamSeed((LAUNCH_POPULATION.seed + 1487 + 7) >>> 0, teamId);
  const payload = buildWeakStarterPool({
    count: need, seed: tailSeed, referenceYear: LAUNCH_POPULATION.referenceYear,
    existingFoldedNames, window: STARTER_TAIL_STAT_WINDOW,
  }).map((r) => ({ ...r, team_id: teamId }));

  const insertedIds = [];
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    const batch = payload.slice(i, i + INSERT_BATCH);
    const { data, error } = await sb.from("riders").insert(batch).select("id");
    if (error) { console.error(`insert ${teamId}:`, error.message); process.exit(1); }
    insertedIds.push(...(data || []).map((r) => r.id));
  }
  await deriveForRiderIds(sb, insertedIds, { dryRun: false });
  added += insertedIds.length;
}
// Sæt markør på ALLE pending hold (også dem der allerede var ≥SIZE → markér no-op).
for (const t of pending) {
  const { error } = await sb.from("teams").update({ starter_depth_topped_up_at: nowIso }).eq("id", t.id);
  if (error) console.error(`markør ${t.id}:`, error.message);
}
console.log(`\nLIVE færdig: ${added} hale-ryttere tilføjet, ${pending.length} hold markeret.`);
process.exit(0);
