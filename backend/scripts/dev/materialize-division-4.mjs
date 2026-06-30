// Engangs-materialisering af division 4's kalender (16-game-day-hul lukket i
// Task 1; forceTiers landet i Task 2). IKKE destruktiv: rører kun tier 4,
// sletter intet. Kør: infisical run --env=prod -- node backend/scripts/dev/materialize-division-4.mjs [--apply]
import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE_URL/SERVICE_KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const APPLY = process.argv.includes("--apply");
const FROM = new Date("2026-06-28T00:00:00Z"); // samme ankerdato som apply-calendar-prestige.mjs

const { data: season, error: sErr } = await supabase.from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
if (sErr || !season) { console.error("aktiv sæson:", sErr?.message); process.exit(1); }
console.log(`Aktiv sæson #${season.number} (${season.id})`);

const summary = await materializeTierCalendars({
  supabase, seasonId: season.id, seasonStartDate: season.start_date,
  from: FROM, dryRun: !APPLY, tiers: [4], forceTiers: [4],
  log: (m) => console.log(m),
});

console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} SUMMARY ===`);
console.log(`races inserted: ${summary.racesInserted} · profiles: ${summary.stageProfiles} · stage-schedules: ${summary.stageSchedules}`);
for (const t of summary.tiers) {
  console.log(`tier ${t.tier}: kvote ${t.quota} · total ${t.totalGameDays} · quotaHit ${t.quotaHit} · tomme ${t.emptyDays} · overlap-dage ${t.overlapDays} · unplaced ${t.unplacedStages}/${t.unplacedSingles} · puljer ${t.pools.map((p) => `${p.pool_id}:+${p.inserted}`).join(" ")}`);
}
process.exit(0);
