// Read-only verifikation (#1709 wiring): kør materializeSeasonCalendar i dryRun mod den
// AKTIVE sæson, så vi bekræfter materializeren læser ægte race_pool/league_divisions/teams
// + genererer per-division-kalendre UDEN fejl og UDEN writes (dryRun=true springer alle
// inserts over). Verificerer skema-kompatibiliteten før den ægte relaunch-apply.
import { createClient } from "@supabase/supabase-js";
import { materializeSeasonCalendar } from "../../lib/seasonCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { data: season, error: sErr } = await supabase
  .from("seasons").select("id, number, start_date, status").eq("status", "active").maybeSingle();
if (sErr) { console.error("seasons:", sErr.message); process.exit(1); }
if (!season) { console.error("ingen aktiv sæson"); process.exit(1); }
console.log(`Aktiv sæson: #${season.number} (${season.id}) start=${season.start_date}\n`);

const summary = await materializeSeasonCalendar({
  supabase,
  seasonId: season.id,
  seasonStartDate: season.start_date,
  dryRun: true,
  log: (m) => console.log(m),
});

console.log("\n=== DRY-RUN SUMMARY ===");
console.log(`editionYear: ${summary.editionYear}`);
console.log(`live puljer m. kalender: ${summary.pools.length}`);
console.log("pr. pulje (pool_id · tier · valgte løb · fresh):");
for (const p of summary.pools.sort((a, b) => a.tier - b.tier || a.pool_id - b.pool_id)) {
  console.log(`  pulje ${p.pool_id} · tier ${p.tier} · selected=${p.selected} · fresh=${p.fresh}`);
}
const totalSelected = summary.pools.reduce((s, p) => s + p.selected, 0);
console.log(`\nTOTAL valgte løb på tværs af live puljer: ${totalSelected}`);
console.log("(dryRun=true → INGEN writes; dette beviser kun læse-/genererings-stien)");
process.exit(0);
