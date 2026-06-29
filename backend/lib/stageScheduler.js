// Stage-scheduler (WS1 Fase 3): cron-sweep der afvikler forfaldne etaper én ad gangen.
//
// Ejer-direktiv (20/6): "1-5 etaper om dagen, alt efter hvilke øvrige løb der køres.
// Systemet skal kunne køre 5 etaper om dagen, men på 5 forskellige tidspunkter."
//
// Synlige faste tider (Beslutning A+B): etape-tider bor i race_stage_schedule. En etape
// er FORFALDEN når scheduled_at <= now() OG stage_number = races.stages_completed + 1
// (= løbets næste uafviklede etape). scheduled_at ER tidsporten — derfor INGEN
// 22:00-vindue-gate (det ville bryde synlige dag-slots som 12:30/15:00/18:00; plan-
// Task 3.5's >= 22-gate hørte til den forkastede deterministisk-offset-variant).
//
// Loop-prævention (3 lag, mod 2026-05-21-incidenten):
//   1. stage_scheduler_enabled-flag (fail-safe OFF).
//   2. race_engine_v2-flag (ekstra lag — afvikling sker via samme motor).
//   3. countStagesDoneToday >= MAX_STAGES_PER_DAY hard-cap (Beslutning D: runaway-backstop,
//      sat over reel fuld-pyramide-peak — se MAX_STAGES_PER_DAY nedenfor).
// + trackedTick (Sentry-capture) i cron-laget.

import { copenhagenMidnightUTC } from "./copenhagenTime.js";

// Daglig afviklings-cap (loop-prævention, Beslutning D). Cap'et er en runaway-BACKSTOP
// (mod cron-loop-incidenten 2026-05-21), IKKE throughput-styring — den PRIMÆRE styring er
// scheduled_at-tiderne (planRaceSchedules). Derfor skal cap'et sidde KOMFORTABELT over
// reel peak-efterspørgsel, aldrig under.
//
// Reel peak ved fuld 1/2/4/8-pyramide med prestige-kalenderens tæthed 5/4/3/2 (28/6-rebuild):
//   Div 1: 5 etaper/dag × 1 pulje  =  5
//   Div 2: 4 etaper/dag × 2 puljer =  8
//   Div 3: 3 etaper/dag × 4 puljer = 12
//   Div 4: 2 etaper/dag × 8 puljer = 16
//                                  ── = 41 etaper/dag ved fuld belægning
//
// Den gamle formel STAGES_PER_DAY(2) × 15 puljer = 30 antog FLADT 2/pulje/dag og lå derfor
// UNDER den reelle 5/4/3/2-peak: den ville begynde at throttle allerede ved ~3 aktive Div-4-
// puljer (25/dag i dag + 3×2 = 31 > 30) og bygge en voksende backlog. Vi sætter nu cap'et
// til peak + ~50% margin, så det forbliver en ægte runaway-guard uden at klippe legitim
// afvikling ved fuld liga.
const FULL_PYRAMID_PEAK_STAGES_PER_DAY = 5 * 1 + 4 * 2 + 3 * 4 + 2 * 8; // = 41
const MAX_STAGES_PER_DAY = Math.ceil(FULL_PYRAMID_PEAK_STAGES_PER_DAY * 1.5); // = 62

// Source-markør på race_simulation_runs: KUN scheduler-drevne runs tæller i daglig cap.
// Skrives af persistRuns via simulateStageByIndex's runSource (sat = 'scheduler' fra
// cron-laget). Admin-fuld-sim (simulateRace) og manuelle stage-runs skriver NULL → tælles ikke.
const SCHEDULER_RUN_SOURCE = "scheduler";

// Tæl KUN scheduler-drevne etape-runs siden dansk midnat (FIX 4). En admin-fuld-simulering
// skriver én race_simulation_runs-række PR. ETAPE (source=NULL); ville den blive talt med,
// kunne ét admin-fuld-sim af et 5-etapers løb opbruge hele dagens stage-budget. Dag-grænsen
// bruger den delte, DST-robuste copenhagenMidnightUTC (FIX 2).
async function countStagesDoneToday(supabase, now) {
  const since = copenhagenMidnightUTC(now).toISOString();
  const { data, error } = await supabase
    .from("race_simulation_runs")
    .select("id")
    .eq("source", SCHEDULER_RUN_SOURCE)
    .gte("created_at", since); // race_simulation_runs bruger created_at (verificeret schema)
  if (error) throw new Error(`race_simulation_runs: ${error.message}`);
  return (data || []).length;
}

/**
 * @param {{
 *   supabase, now?: Date,
 *   isStageSchedulerEnabled, isRaceEngineV2Enabled,
 *   runStageFn: ({ raceId, stageIndex }) => Promise,
 * }} args
 * @returns {{ ran, errors, skipped? }}
 */
export async function runStageScheduler({
  supabase,
  now = new Date(),
  isStageSchedulerEnabled,
  isRaceEngineV2Enabled,
  runStageFn,
}) {
  if (!(await isStageSchedulerEnabled(supabase))) return { ran: 0, errors: 0, skipped: "flag_off" };
  if (!(await isRaceEngineV2Enabled(supabase, { isBetaTester: true }))) {
    return { ran: 0, errors: 0, skipped: "engine_off" };
  }

  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) return { ran: 0, errors: 0, skipped: "no_active_season" };

  // Hard-cap: hvor mange etaper er allerede afviklet i dag? (loop-prævention)
  const doneToday = await countStagesDoneToday(supabase, now);
  let budget = MAX_STAGES_PER_DAY - doneToday;
  if (budget <= 0) return { ran: 0, errors: 0, skipped: "daily_cap_reached" };

  // Forfaldne etape-tider: scheduled_at <= now. Sorteret på tid → ældste først.
  const { data: dueSchedule, error: schErr } = await supabase
    .from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true });
  if (schErr) throw new Error(`race_stage_schedule: ${schErr.message}`);
  if (!dueSchedule?.length) return { ran: 0, errors: 0, skipped: "no_due_stages" };

  // Aktive (ikke-completede) løb i sæsonen, indekseret på id.
  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, season_id, name, stages, stages_completed, status")
    .eq("season_id", season.id)
    .neq("status", "completed");
  if (rErr) throw new Error(`races: ${rErr.message}`);
  const raceById = new Map((races || []).map((r) => [r.id, r]));

  // Vælg PRÆCIS de schedule-rækker hvis stage_number = løbets næste uafviklede etape.
  // Maks én etape pr. løb pr. tick (Beslutning D). Dedup på race_id.
  const seen = new Set();
  const dueRaces = [];
  for (const s of dueSchedule) {
    if (seen.has(s.race_id)) continue;
    const race = raceById.get(s.race_id);
    if (!race) continue;
    const nextStageNumber = (race.stages_completed || 0) + 1;
    if (s.stage_number !== nextStageNumber) continue; // ikke næste etape → ikke due endnu
    seen.add(s.race_id);
    dueRaces.push(race);
  }

  let ran = 0;
  let errors = 0;
  for (const race of dueRaces) {
    if (budget <= 0) break; // daglig cap-loft
    try {
      await runStageFn({ raceId: race.id, stageIndex: race.stages_completed || 0 });
      ran++;
      budget--;
    } catch (err) {
      errors++;
      console.error(`  ❌ stage-scheduler: race ${race.name ?? race.id} failed: ${err.message}`);
    }
  }
  return { ran, errors };
}

export { MAX_STAGES_PER_DAY };
