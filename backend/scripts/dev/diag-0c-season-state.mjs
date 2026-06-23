// Read-only: tilstand af aktiv sæson — hvor langt er afviklingen, så vi ved om
// overlap-rescheduling kan røre den kørende sæson eller kun fremtidige etaper.
// Kør: infisical run --env=prod -- node backend/scripts/dev/diag-0c-season-state.mjs
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: season } = await sb.from("seasons").select("id, number, status, start_date").eq("status", "active").maybeSingle();
console.log(`Aktiv sæson #${season.number} start=${season.start_date}\n`);

const { data: races } = await sb.from("races")
  .select("id, status, stages, stages_completed, scheduled_for").eq("season_id", season.id);
const byStatus = {};
let anyStarted = 0, totalStagesDone = 0;
for (const r of races) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  if ((r.stages_completed || 0) > 0) anyStarted++;
  totalStagesDone += r.stages_completed || 0;
}
console.log("Løb pr. status:", JSON.stringify(byStatus));
console.log(`Løb med ≥1 afviklet etape: ${anyStarted}/${races.length}`);
console.log(`Total afviklede etaper i sæsonen: ${totalStagesDone}`);

// Hvor mange etape-tider ligger i fortiden vs fremtiden?
const ids = races.map((r) => r.id);
const sched = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from("race_stage_schedule").select("scheduled_at").in("race_id", ids.slice(i, i + 200));
  sched.push(...(data || []));
}
const now = Date.now();
const past = sched.filter((s) => Date.parse(s.scheduled_at) <= now).length;
const future = sched.length - past;
const firstFuture = sched.map((s) => Date.parse(s.scheduled_at)).filter((t) => t > now).sort((a, b) => a - b)[0];
console.log(`\nEtape-tider: ${sched.length} total · ${past} i fortiden · ${future} i fremtiden`);
console.log(`Næste etape-tid: ${firstFuture ? new Date(firstFuture).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }) : "—"}`);

// Igangværende manager-udtagelser (manuelle entries) der ville påvirkes af reschedule?
const { data: manualEntries } = await sb.from("race_entries").select("race_id", { count: "exact", head: false }).eq("is_auto_filled", false).limit(1);
const { count: manualCount } = await sb.from("race_entries").select("*", { count: "exact", head: true }).eq("is_auto_filled", false);
console.log(`\nManuelle (manager-udtagne) entries i alt: ${manualCount ?? "?"}`);
process.exit(0);
