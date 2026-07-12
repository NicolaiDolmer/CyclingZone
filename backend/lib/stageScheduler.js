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
import { captureException } from "./sentry.js";
import { detectInFlightRacesWithoutEntries } from "./raceActiveGuard.js";

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

// #2389: et løb der STADIG fejler så længe efter første capture har ikke løst sig
// selv (transient hikke gør) — send én NY capture med escalated=true så det ikke
// forsvinder i dagens dedupe. 3 timer = 36 fejlende 5-min-ticks.
const ESCALATION_AFTER_MS = 3 * 60 * 60 * 1000;

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
  // #2251: per-løb-per-dag-dedup for BÅDE log-støj og Sentry-captures (mirror
  // stallWatchdog's seenKeys-mønster). Caller (cron.js) holder en persistent Map
  // på tværs af ticks, så et løb der er fastlåst (fx "No start list" — tyndt/tomt
  // felt i lav-division, #2251) kun logges/captures ÉN gang pr. dag, ikke hvert
  // 5-min-tick. #2389: Map (var Set) — værdien {firstFailedAt, escalated} driver
  // eskaleringen nedenfor, så en VEDVARENDE fejl ikke forstummer efter første capture.
  seenKeys = new Map(),
  captureExceptionFn = captureException,
}) {
  if (!(await isStageSchedulerEnabled(supabase))) return { ran: 0, errors: 0, skipped: "flag_off" };
  if (!(await isRaceEngineV2Enabled(supabase, { isBetaTester: true }))) {
    return { ran: 0, errors: 0, skipped: "engine_off" };
  }

  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) return { ran: 0, errors: 0, skipped: "no_active_season" };

  // #2074 forward-guard (DETEKTION): alarmér hvis et igangværende løb har mistet sit
  // startfelt (0 race_entries). Read-only + best-effort — en fejl her må ALDRIG stoppe
  // etape-afviklingen. Genopretning er ejer-only (dette er kun en alarm, ingen mutation).
  try {
    await detectInFlightRacesWithoutEntries({ supabase, seasonId: season.id, now });
  } catch (err) {
    console.error(`  ⚠️ stage-scheduler: startfelt-detektion fejlede (ikke-fatal): ${err.message}`);
  }

  // Hard-cap: hvor mange etaper er allerede afviklet i dag? (loop-prævention)
  const doneToday = await countStagesDoneToday(supabase, now);
  let budget = MAX_STAGES_PER_DAY - doneToday;
  if (budget <= 0) return { ran: 0, errors: 0, skipped: "daily_cap_reached" };

  // Forfaldne etape-tider: scheduled_at <= now. Sorteret på tid → ældste først.
  // P0 2/7: races!inner-join filtrerer completede løbs rækker fra SERVER-SIDE.
  // Uden filteret bliver færdige løbs rækker liggende i svaret for evigt, og
  // PostgRESTs 1000-rækkers cap ville sidst på sæsonen (sæson-slots 1.148 > 1.000)
  // skygge for de reelt actionable etaper → afvikling går i stå ~dag 25-26.
  const { data: dueSchedule, error: schErr } = await supabase
    .from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at, races!inner(status)")
    .lte("scheduled_at", now.toISOString())
    .neq("races.status", "completed")
    .order("scheduled_at", { ascending: true });
  if (schErr) throw new Error(`race_stage_schedule: ${schErr.message}`);

  // Aktive (ikke-completede) løb i sæsonen, indekseret på id.
  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, season_id, name, stages, stages_completed, status, league_division_id")
    .eq("season_id", season.id)
    .neq("status", "completed");
  if (rErr) throw new Error(`races: ${rErr.message}`);
  const raceById = new Map((races || []).map((r) => [r.id, r]));

  // P0 2/7: puljer uden hold (fx division 4-puljerne 8-15 mellem kalender-
  // materialisering og første manager/AI-fyld) må ikke give "No start list"-fejl
  // hvert tick (~4.600 tavse fejlforsøg/døgn). Fail-open: returnerer teams-tabellen
  // 0 rækker TOTALT (tom test-DB/mock) springes filteret over.
  const { data: teamPools, error: tpErr } = await supabase
    .from("teams")
    .select("league_division_id");
  if (tpErr) throw new Error(`teams: ${tpErr.message}`);
  const teamsPerPool = new Map();
  for (const t of teamPools || []) {
    if (t.league_division_id == null) continue;
    teamsPerPool.set(t.league_division_id, (teamsPerPool.get(t.league_division_id) || 0) + 1);
  }
  const poolFilterActive = (teamPools || []).length > 0;
  const inEmptyPool = (race) => (
    poolFilterActive
    && race.league_division_id != null
    && !(teamsPerPool.get(race.league_division_id) > 0)
  );

  // P0 2/7: finalization-pending recovery. Løb hvor ALLE etaper er kørt men status
  // aldrig blev flippet til 'completed' (crash mellem trin — incidenten 30/6-2/7
  // efterlod 13 løb sådan) har intet "næste etape"-slot og blev derfor aldrig
  // genoptaget. runAdminSimulateStage falder nu igennem til den idempotente
  // finalization-sti, så scheduleren skal blot udvælge dem. Tælles IKKE i den
  // daglige stage-cap (ingen ny etape simuleres — kun finalization).
  const RECOVERY_MAX_PER_TICK = 20;
  const recoveryRaces = (races || [])
    .filter((r) => (r.stages_completed || 0) >= (r.stages || 1) && !inEmptyPool(r))
    .slice(0, RECOVERY_MAX_PER_TICK);

  if (!dueSchedule?.length && !recoveryRaces.length) {
    return { ran: 0, errors: 0, recovered: 0, skipped: "no_due_stages" };
  }

  // Vælg PRÆCIS de schedule-rækker hvis stage_number = løbets næste uafviklede etape.
  // Maks én etape pr. løb pr. tick (Beslutning D). Dedup på race_id.
  const seen = new Set();
  const dueRaces = [];
  let skippedEmptyPool = 0;
  for (const s of dueSchedule || []) {
    if (seen.has(s.race_id)) continue;
    const race = raceById.get(s.race_id);
    if (!race) continue;
    const nextStageNumber = (race.stages_completed || 0) + 1;
    if (s.stage_number !== nextStageNumber) continue; // ikke næste etape → ikke due endnu
    if (inEmptyPool(race)) { seen.add(s.race_id); skippedEmptyPool++; continue; }
    seen.add(s.race_id);
    dueRaces.push(race);
  }
  if (skippedEmptyPool > 0) {
    // Én linje pr. tick (ikke pr. løb) — bevidst downgrade fra fejl til info.
    console.log(`  ⏭️ stage-scheduler: ${skippedEmptyPool} due løb sprunget over (pulje uden hold)`);
  }

  let ran = 0;
  let errors = 0;
  let recovered = 0;
  const failRace = (race, err) => {
    errors++;
    // #2251: løbet skippes (loopet fortsætter til øvrige due/recovery-løb nedenfor) —
    // men log + Sentry-capture dedupes ÉN gang pr. (løb, dag), så et fastlåst løb
    // (fx "No start list" — tyndt/tomt felt i lav-division) ikke spammer Railway-logs
    // og Sentry hvert 5-min-tick (P0 2/7 deduperede kun Sentry; #2251 dedup'er nu OGSÅ
    // selve loggen og gør den struktureret).
    const dedupeKey = `${race.id}:${now.toISOString().slice(0, 10)}`;
    const seen = seenKeys.get(dedupeKey);
    if (seen) {
      // #2389: eskalering. Dedupen gjorde vedvarende fejl USYNLIGE efter første
      // capture (Tour of the Isles fejlede tavst hvert tick i timevis). Fejler
      // samme løb stadig ESCALATION_AFTER_MS efter første capture, sendes ÉN ny
      // capture med escalated=true — derefter tavshed igen resten af dagen.
      if (!seen.escalated && now.getTime() - seen.firstFailedAt >= ESCALATION_AFTER_MS) {
        seen.escalated = true;
        console.error(JSON.stringify({
          event: "stage_scheduler_race_failed_escalated",
          raceId: race.id,
          raceName: race.name ?? null,
          leagueDivisionId: race.league_division_id ?? null,
          error: err.message,
          firstFailedAt: new Date(seen.firstFailedAt).toISOString(),
          tick: now.toISOString(),
        }));
        captureExceptionFn(err, {
          tags: { cron: "stage-scheduler", escalated: "true" },
          raceId: race.id,
          raceName: race.name,
        });
      }
      return;
    }
    if (seenKeys.size > 500) seenKeys.clear();
    seenKeys.set(dedupeKey, { firstFailedAt: now.getTime(), escalated: false });
    console.error(JSON.stringify({
      event: "stage_scheduler_race_failed",
      raceId: race.id,
      raceName: race.name ?? null,
      leagueDivisionId: race.league_division_id ?? null,
      error: err.message,
      tick: now.toISOString(),
    }));
    captureExceptionFn(err, { tags: { cron: "stage-scheduler" }, raceId: race.id, raceName: race.name });
  };

  for (const race of recoveryRaces) {
    try {
      await runStageFn({ raceId: race.id, stageIndex: Math.max((race.stages || 1) - 1, 0), recovery: true });
      recovered++;
    } catch (err) {
      failRace(race, err);
    }
  }

  for (const race of dueRaces) {
    if (budget <= 0) break; // daglig cap-loft
    try {
      await runStageFn({ raceId: race.id, stageIndex: race.stages_completed || 0 });
      ran++;
      budget--;
    } catch (err) {
      failRace(race, err);
    }
  }
  return { ran, errors, recovered };
}

export { MAX_STAGES_PER_DAY };
