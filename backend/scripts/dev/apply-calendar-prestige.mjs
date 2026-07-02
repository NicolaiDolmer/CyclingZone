// DESTRUKTIV apply af prestige/spredning-kalender-rebuilden (spec 2026-06-27). Sletter sæson-løb
// (cascade) og regenererer alle divisioner med den nye model. Backup SKAL tages FØR (se
// backup_calrebuild_20260627_*). Kør: infisical run --env=prod -- node scripts/dev/apply-calendar-prestige.mjs
import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE_URL/SERVICE_KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// real_day 0 = mandag 29/6. buildScheduleRows: dato = from + (real_day+1).
const FROM = new Date("2026-06-28T00:00:00Z");

const { data: season, error: sErr } = await supabase.from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
if (sErr || !season) { console.error("aktiv sæson:", sErr?.message); process.exit(1); }
console.log(`Aktiv sæson #${season.number} (${season.id})`);

const { count: before } = await supabase.from("races").select("id", { count: "exact", head: true }).eq("season_id", season.id);
console.log(`Sletter ${before} eksisterende sæson-løb (cascade: schedule/profiles/entries)...`);
const { error: delErr } = await supabase.from("races").delete().eq("season_id", season.id);
if (delErr) { console.error("DELETE fejlede:", delErr.message); process.exit(1); }

console.log("Regenererer (apply)...");
const summary = await materializeTierCalendars({
  supabase, seasonId: season.id, seasonStartDate: season.start_date,
  from: FROM, dryRun: false, log: (m) => console.log(m),
});

console.log("\n=== APPLY SUMMARY ===");
console.log(`races inserted: ${summary.racesInserted} · profiles: ${summary.stageProfiles} · stage-schedules: ${summary.stageSchedules}`);
for (const t of summary.tiers) {
  console.log(`tier ${t.tier}: kvote ${t.quota} · total ${t.totalGameDays} · quotaHit ${t.quotaHit} · tomme ${t.emptyDays} · overlap-dage ${t.overlapDays} · unplaced ${t.unplacedStages}/${t.unplacedSingles} · puljer ${t.pools.map((p) => `${p.pool_id}:+${p.inserted}`).join(" ")}`);
}
process.exit(0);
