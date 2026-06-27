// Verificér read-model-kontrakten mod LIVE prod-data (read-only): kør buildCalendarModel med de
// faktiske race/schedule/profile-rækker og print et eksempel-løbs stageSchedule + en dags chips.
import { createClient } from "@supabase/supabase-js";
import { buildCalendarModel } from "../../lib/raceCalendar.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SEASON = "00000000-0000-0000-0000-000000000001";

const { data: races } = await supabase.from("races").select("id, name, race_type, race_class, stages, status, league_division_id, game_day_start").eq("season_id", SEASON);
const ids = races.map((r) => r.id);
const sched = [];
for (let i = 0; i < ids.length; i += 50) {
  const { data } = await supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at, game_day").in("race_id", ids.slice(i, i + 50));
  sched.push(...(data || []));
}
const profs = [];
for (let i = 0; i < ids.length; i += 50) {
  const { data } = await supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type").in("race_id", ids.slice(i, i + 50));
  profs.push(...(data || []));
}
const { data: divisions } = await supabase.from("league_divisions").select("id, tier, pool_index, label");

const model = buildCalendarModel({ races, scheduleRows: sched, profileRows: profs, divisions, teamDivisionId: 4 });

// Eksempel: et div-1 Grand Tour + et div-3 etapeløb + et monument.
const gt = model.entries.find((e) => e.stages === 21);
const d3stage = model.entries.find((e) => e.division === 3 && e.raceType === "stage_race");
const mon = model.entries.find((e) => e.raceClass === "Monuments");
console.log("Grand Tour:", gt.name, "→ stageSchedule[0..2]:", JSON.stringify(gt.stageSchedule.slice(0, 3)));
console.log("  spænder dage:", new Set(gt.stageSchedule.map((s) => s.date)).size, "· tider:", [...new Set(gt.stageSchedule.map((s) => s.time))].join(","));
console.log("Div3 etapeløb:", d3stage.name, "→", JSON.stringify(d3stage.stageSchedule));
console.log("Monument:", mon.name, "→", JSON.stringify(mon.stageSchedule), "· date:", mon.date);
console.log("Entries total:", model.entries.length, "· entries med stageSchedule:", model.entries.filter((e) => e.stageSchedule.length).length);
process.exit(0);
