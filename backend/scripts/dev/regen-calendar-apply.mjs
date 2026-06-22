// ENGANGS de-dup-regenerering (#1714): re-materialisér den AKTIVE sæsons kalender med
// den jævne, globalt de-duplikerede generator. FORUDSÆTTER at de gamle races + children
// (race_stage_schedule, race_stage_profiles, race_entries) ALLEREDE er slettet — ellers
// er materializeSeasonCalendar idempotent og indsætter 0. Backup tages separat
// (dedup_bk_*-tabeller) før sletning.
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/regen-calendar-apply.mjs
import { createClient } from "@supabase/supabase-js";
import { materializeSeasonCalendar } from "../../lib/seasonCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { data: season, error } = await supabase
  .from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
if (error || !season) { console.error("ingen aktiv sæson:", error?.message); process.exit(1); }

const { count: existing } = await supabase
  .from("races").select("id", { count: "exact", head: true }).eq("season_id", season.id);
if (existing > 0) {
  console.error(`AFBRYDER: ${existing} races findes stadig for sæson #${season.number} — slet dem (+ children) FØRST.`);
  process.exit(1);
}

console.log(`Regenererer kalender for sæson #${season.number} (start=${season.start_date})\n`);
const summary = await materializeSeasonCalendar({
  supabase,
  seasonId: season.id,
  seasonStartDate: season.start_date,
  dryRun: false,
  log: (m) => console.log(m),
});

console.log("\n=== APPLY SUMMARY ===");
console.log(`races indsat: ${summary.racesInserted}`);
console.log(`stage-profiler: ${summary.stageProfiles}`);
console.log(`stage-schedule: ${summary.stageSchedules}`);
console.log(`beskårne puljer: ${(summary.truncated || []).length}`);
process.exit(0);
