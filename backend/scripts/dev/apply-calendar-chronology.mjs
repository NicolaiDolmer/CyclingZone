// APPLY kronologi-rebuilden i prod (spec 2026-06-28). DESTRUKTIV: sletter sæson-1-løb + re-materialiserer.
// Ejer-go påkrævet. Backup tages SEPARAT (MCP) FØR denne kører. Kræver --confirm for at mutere.
// Kør: infisical run --env=prod -- node scripts/dev/apply-calendar-chronology.mjs --confirm
import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";

const CONFIRM = process.argv.includes("--confirm");
const SEASON = "00000000-0000-0000-0000-000000000001";
const FROM = new Date("2026-06-28T00:00:00Z"); // real_day 0 = man 29/6
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE_URL/SERVICE_KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const ids = (await supabase.from("races").select("id").eq("season_id", SEASON)).data?.map((r) => r.id) || [];
async function countIn(table) {
  let total = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { count } = await supabase.from(table).select("*", { count: "exact", head: true }).in("race_id", ids.slice(i, i + 200));
    total += count || 0;
  }
  return total;
}
// SAFETY: intet må være afviklet/finans-bundet.
const results = await countIn("race_results");
const pending = await countIn("pending_race_results");
const finance = await countIn("finance_transactions");
console.log(`Pre-flight: ${ids.length} løb · results ${results} · pending ${pending} · finance-refs ${finance}`);
if (results || pending || finance) { console.error("ABORT: afviklede/finans-bundne løb findes — rebuild ikke sikker."); process.exit(1); }

const { data: season } = await supabase.from("seasons").select("start_date").eq("id", SEASON).maybeSingle();

if (!CONFIRM) { console.log("DRY-RUN (ingen --confirm): ville slette + re-materialisere. Stop."); process.exit(0); }

console.log("Sletter sæson-1-løb (cascade rydder schedule/profiler/entries/withdrawals)...");
const { error: delErr } = await supabase.from("races").delete().eq("season_id", SEASON);
if (delErr) { console.error("DELETE-fejl:", delErr.message); process.exit(1); }
const left = (await supabase.from("races").select("id", { count: "exact", head: true }).eq("season_id", SEASON)).count;
console.log(`  tilbage efter slet: ${left}`);

console.log("Re-materialiserer med ny pakker...");
const summary = await materializeTierCalendars({ supabase, seasonId: SEASON, seasonStartDate: season?.start_date ?? null, from: FROM, dryRun: false, log: console.log });
console.log("FÆRDIG:", JSON.stringify({ racesInserted: summary.racesInserted, stageSchedules: summary.stageSchedules, stageProfiles: summary.stageProfiles, editionYear: summary.editionYear }));
