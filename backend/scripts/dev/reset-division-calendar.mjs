// Division-specifik kalender-reset (Task 4): regenerér ÉN divisions løbskalender fra
// bunden i prod. KUN tænkt til AI-divisioner uden ægte spillere — guarden afbryder
// hvis divisionen har mindst ét rigtigt manager-hold (medmindre --force).
//
// Dry-run er DEFAULT (ingen writes). --live udfører sletning + re-materialisering.
//
// Kør (dry-run):
//   infisical run --env=prod -- node backend/scripts/dev/reset-division-calendar.mjs \
//     --seasonId <uuid> --divisionId <int>
// Kør (live):
//   infisical run --env=prod -- node backend/scripts/dev/reset-division-calendar.mjs \
//     --seasonId <uuid> --divisionId <int> --live
//
// Slette-rækkefølge (kun --live), FK-sikker (finance_transactions.race_id = NO ACTION):
//   a) UPDATE finance_transactions SET race_id=NULL WHERE race_id IN (divisionens race-ids)
//   b) DELETE races WHERE season_id AND league_division_id   (CASCADE rydder
//      race_results, race_entries, race_stage_profiles, race_stage_schedule,
//      race_simulation_runs, pending_race_results)
//   c) DELETE season_standings WHERE season_id AND league_division_id
//   d) materializeSeasonCalendar({ ..., dryRun:false, onlyDivisionId, raceDaysTarget, tracks })

import { createClient } from "@supabase/supabase-js";
import { materializeSeasonCalendar } from "../../lib/seasonCalendarMaterializer.js";
import { planDivisionReset } from "../../lib/divisionReset.js";

// --- CLI-args -------------------------------------------------------------
function parseArgs(argv) {
  const out = { live: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--live") out.live = true;
    else if (a === "--force") out.force = true;
    else if (a === "--seasonId") out.seasonId = next();
    else if (a === "--divisionId") out.divisionId = next();
    else if (a === "--tracks") out.tracks = Number.parseInt(next(), 10);
    else if (a === "--race-days") out.raceDays = Number.parseInt(next(), 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.seasonId || args.divisionId == null || Number.isNaN(Number(args.divisionId))) {
  console.error(
    "Brug: node reset-division-calendar.mjs --seasonId <uuid> --divisionId <int> " +
    "[--live] [--tracks 5] [--race-days 140] [--force]",
  );
  process.exit(1);
}
const seasonId = args.seasonId;
const divisionId = Number.parseInt(String(args.divisionId), 10);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function ensureOk({ data, error }, label) {
  if (error) {
    console.error(`FEJL (${label}): ${error.message}`);
    process.exit(1);
  }
  return data;
}

// --- 1. Hent divisionens hold + races ------------------------------------
const teams = ensureOk(
  await supabase
    .from("teams")
    .select("id, is_ai, is_bank, is_frozen, is_test_account, league_division_id")
    .eq("league_division_id", divisionId),
  "teams",
);

const races = ensureOk(
  await supabase
    .from("races")
    .select("id")
    .eq("season_id", seasonId)
    .eq("league_division_id", divisionId),
  "races",
);

// --- 2. Ren beslutning (guarden) -----------------------------------------
const plan = planDivisionReset({ races, teams });
const raceIds = plan.raceIds;

console.log(`\n=== RESET DIVISION ${divisionId} · sæson ${seasonId} ===`);
console.log(`hold i divisionen: ${teams.length} (ægte spillere: ${plan.hasRealTeams ? "JA" : "nej"})`);
console.log(`eksisterende races i divisionen: ${raceIds.length}`);

if (!plan.allowed) {
  if (args.force) {
    console.warn(`\n⚠ GUARD OVERSTYRET med --force: ${plan.reason}`);
  } else {
    console.error(`\nAFBRYDER: ${plan.reason}`);
    console.error("Brug --force for at overstyre (kun hvis du er HELT sikker på at ingen rigtige spillere rammes).");
    process.exit(1);
  }
}

// --- 3. Tæl hvad der ville blive slettet (entries + standings) -----------
let entriesCount = 0;
if (raceIds.length > 0) {
  const { count, error } = await supabase
    .from("race_entries")
    .select("id", { count: "exact", head: true })
    .in("race_id", raceIds);
  if (error) console.warn(`(kunne ikke tælle race_entries: ${error.message})`);
  else entriesCount = count || 0;
}

const { count: standingsCount, error: stErr } = await supabase
  .from("season_standings")
  .select("id", { count: "exact", head: true })
  .eq("season_id", seasonId)
  .eq("league_division_id", divisionId);
if (stErr) console.warn(`(kunne ikke tælle season_standings: ${stErr.message})`);

console.log("\nVILLE BLIVE SLETTET:");
console.log(`  races:            ${raceIds.length}`);
console.log(`  race_entries:     ${entriesCount} (via CASCADE)`);
console.log(`  season_standings: ${standingsCount || 0}`);

// Hent sæsonens start-dato (edition_year til den nye kalender).
const { data: season } = await supabase
  .from("seasons").select("id, number, start_date").eq("id", seasonId).maybeSingle();
if (!season) {
  console.error(`\nAFBRYDER: sæson ${seasonId} findes ikke.`);
  process.exit(1);
}

if (!args.live) {
  // DRY-RUN: vis den planlagte nye kalender uden writes.
  console.log("\n--- PLANLAGT NY KALENDER (dry-run, ingen writes) ---");
  const preview = await materializeSeasonCalendar({
    supabase,
    seasonId,
    seasonStartDate: season.start_date,
    dryRun: true,
    onlyDivisionId: divisionId,
    ...(args.raceDays != null ? { raceDaysTarget: args.raceDays } : {}),
    ...(args.tracks != null ? { tracks: args.tracks } : {}),
    log: (m) => console.log(m),
  });
  const line = (preview.pools || []).find((p) => p.pool_id === divisionId);
  if (line) console.log(`  division ${divisionId}: ${line.selected} løb ville blive materialiseret (fresh: ${line.fresh})`);
  else console.log(`  (division ${divisionId} er ikke en live pulje i kalender-genereringen — 0 løb)`);
  console.log("\nDRY-RUN — intet ændret. Kør med --live for at udføre reset.");
  process.exit(0);
}

// --- 4. LIVE: slette-rækkefølge + re-materialisering ---------------------
console.log("\n--- LIVE: udfører reset ---");

// a) NULL finance_transactions.race_id (NO ACTION FK → skal ryddes FØR races-delete).
if (raceIds.length > 0) {
  ensureOk(
    await supabase.from("finance_transactions").update({ race_id: null }).in("race_id", raceIds),
    "finance_transactions race_id=NULL",
  );
  console.log(`  a) finance_transactions.race_id nulstillet for ${raceIds.length} løb`);
}

// b) DELETE races (CASCADE rydder children).
const deletedRaces = ensureOk(
  await supabase
    .from("races")
    .delete()
    .eq("season_id", seasonId)
    .eq("league_division_id", divisionId)
    .select("id"),
  "races delete",
);
console.log(`  b) ${deletedRaces?.length || 0} races slettet (children via CASCADE)`);

// c) DELETE season_standings for divisionen.
const deletedStandings = ensureOk(
  await supabase
    .from("season_standings")
    .delete()
    .eq("season_id", seasonId)
    .eq("league_division_id", divisionId)
    .select("id"),
  "season_standings delete",
);
console.log(`  c) ${deletedStandings?.length || 0} season_standings slettet`);

// d) Re-materialisér KUN denne division.
console.log("  d) re-materialiserer kalender...");
const summary = await materializeSeasonCalendar({
  supabase,
  seasonId,
  seasonStartDate: season.start_date,
  dryRun: false,
  onlyDivisionId: divisionId,
  ...(args.raceDays != null ? { raceDaysTarget: args.raceDays } : {}),
  ...(args.tracks != null ? { tracks: args.tracks } : {}),
  log: (m) => console.log(m),
});

console.log("\n=== LIVE SUMMARY ===");
console.log(`races indsat:    ${summary.racesInserted}`);
console.log(`stage-profiler:  ${summary.stageProfiles}`);
console.log(`stage-schedule:  ${summary.stageSchedules}`);
console.log(`beskårne puljer: ${(summary.truncated || []).length}`);
process.exit(0);
