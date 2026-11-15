// #7982 (ejer 15/11): loebets session afregnes, naar etapen er afgjort.
// Design: docs/superpowers/specs/2026-11-15-7982-afregning-efter-etapen-design.md
//
// HVAD DEN GOER. Naar stage-scheduleren har afgjort etaper, koerer motoren KUN den session
// (loebsdag), loebet ligger i, for loebets ryttere. To etaper samme dato: efter hver etape.
// Sessionerne foer og efter loebet roeres ikke; de koeres kl. 20 eller ved Traen nu som i dag.
// Loebets form og traethed skrives som foreloebige tal straks (samme mekanisme som Traen nu's
// foreloebige kondition); datoen lukkes stadig paa rytterens sidste manglende session.
//
// HVOR. Kaldes fra startTrainingDayCloseAfterStages (trainingDayCloseTrigger.js), aldrig fra
// etapens egen afslutning (raceRunner.js): en fejl her maa aldrig kunne vaelte en etape. Alt er
// fire-and-forget med egen catch; en fejlet session ligger blot aaben til aftenkoerslen.
//
// KONTAKT. training_settle_race_session, binaer: kun den eksakte streng "on" taender. Alt andet
// (raekken mangler, "off", "beta", opslagsfejl) = slukket, og saa laeses intet ud over kontakten.
//
// AFGRAENSNING. Kun den aktive saeson, ikke saesonens sidste dato (egen sti i
// trainingDateClose.js), kun lukkede etaper (finalize_state null, startlisten gemt, belastning i
// bogen). Ryttere uden loeb: ingen aendring. En session med kvittering springes over.
import { readFlagStage } from "./featureStage.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { fetchAllRows } from "./supabasePagination.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { isTrainingConditionPerDateEnabled } from "./trainingDateConditionFlag.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { loadFinalTrainingDate } from "./seasonTransitionReadiness.js";
import {
  loadTrainingDateContext, resolveRaceSessionReadiness, resolveTrainingDateReadiness,
  trainingDateBounds, trainingDateDeadline,
} from "./trainingDateReadiness.js";

export const TRAINING_SETTLE_RACE_SESSION_FLAG_KEY = "training_settle_race_session";

/** Kun den eksakte streng "on" taender. */
export function evaluateTrainingSettleRaceSessionFlag(value) {
  return value === "on";
}

/** Fejl i opslaget = slukket (readFlagStage giver null ved fejl). */
export async function isTrainingSettleRaceSessionEnabled(supabase) {
  return evaluateTrainingSettleRaceSessionFlag(await readFlagStage(supabase, TRAINING_SETTLE_RACE_SESSION_FLAG_KEY));
}

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

/**
 * PUR: hvilke (hold, loebsdag, ryttere) skal afregnes nu.
 * @param {object} args
 * @param {Array<object>} args.teams  datoens hold (loadTrainingDateContext)
 * @param {Array<object>} args.riders  aktive ryttere med team_id/created_at/acquired_at
 * @param {Map<number,string[]>} args.readyByDay  resolveRaceSessionReadiness
 * @param {Map<string,object>} args.workByTeam  training_date_work pr. hold
 * @param {Set<string>} args.receiptKeys  `${rider_id}#${game_day}` med kvittering
 * @param {Map<string,number[]>} args.gameDaysByDivision
 * @param {Date} args.dateEnd
 * @returns {Array<{ teamId: string, gameDay: number, days: number[], riderIds: string[] }>}
 */
export function planRaceSessionSettlement({ teams, riders, readyByDay, workByTeam, receiptKeys, gameDaysByDivision, dateEnd }) {
  const plan = [];
  for (const team of teams) {
    const work = workByTeam.get(team.id) ?? null;
    if (work && ["complete", "needs_reconciliation"].includes(work.status)) continue;
    if (team.is_bank || team.is_frozen || team.is_test_account) continue;
    const days = work?.game_days ?? gameDaysByDivision.get(team.league_division_id);
    if (!team.league_division_id && !work) continue;
    if (!Array.isArray(days) || days.length !== 5) continue;
    // Et aabnet datoregnskab er sandheden (traeningen foelger rytteren, #6439); ellers holdets
    // ryttere paa datoen, som aftenkoerslen ville fryse dem.
    const roster = work
      ? work.expected_rider_ids.filter((id) => !(work.quarantined_rider_ids ?? []).includes(id))
      : riders.filter((rider) => rider.team_id === team.id
        && (!rider.created_at || new Date(rider.created_at) < dateEnd)
        && (!rider.acquired_at || new Date(rider.acquired_at) < dateEnd)).map((rider) => rider.id);
    const owned = new Set(roster);
    for (const gameDay of [...readyByDay.keys()].sort((a, b) => a - b)) {
      if (!days.includes(gameDay)) continue;
      const riderIds = readyByDay.get(gameDay).filter((id) => owned.has(id) && !receiptKeys.has(`${id}#${gameDay}`));
      if (riderIds.length) plan.push({ teamId: team.id, gameDay, days: [...days], riderIds });
    }
  }
  return plan;
}

/**
 * I/O: afregn de loebssessioner, der er klar nu. Kaster aldrig for et enkelt hold; fejl samles.
 * @returns {Promise<object>} resumé ({ ran, skipped?, planned, settled, alreadyRan, failed, failures })
 */
export async function runRaceSessionSettlement({
  supabase, now, loadDaySpans, logger = console,
  isEnabled = isTrainingSettleRaceSessionEnabled,
  isConditionPerDate = isTrainingConditionPerDateEnabled,
  isDailyTraining = isDailyTrainingEnabled,
  loadContext = loadTrainingDateContext,
  loadFinalDate = loadFinalTrainingDate,
  runDay = runTeamTrainingDay,
}) {
  const summary = { ran: false, planned: 0, settled: 0, alreadyRan: 0, failed: 0, failures: [] };
  if (!(await isEnabled(supabase))) return { ...summary, skipped: "flag_off" };
  // Hovedkontakten for daglig traening gaelder ogsaa her, som i aftenkoerslen (Codex P1 15/11).
  if (!(await isDailyTraining(supabase))) return { ...summary, skipped: "daily_training_off" };
  if (!(await isConditionPerDate(supabase))) return { ...summary, skipped: "condition_per_date_off" };
  const tickDate = copenhagenDateString(now);
  const season = await checked(supabase.from("seasons").select("id,number,start_date,end_date,status").eq("status", "active").maybeSingle(), "active season");
  if (!season) return { ...summary, skipped: "no_active_season", tickDate };
  if (season.end_date && tickDate > String(season.end_date).slice(0, 10)) return { ...summary, skipped: "after_season_end", tickDate };
  if ((await loadFinalDate({ supabase, seasonId: season.id })) === tickDate) return { ...summary, skipped: "final_season_date", tickDate };

  const context = await loadContext({ supabase, season, tickDate, loadDaySpans });
  const readyByDay = resolveRaceSessionReadiness({ ...context, riderIds: (context.riders ?? []).map((rider) => rider.id) });
  if (!readyByDay.size) return { ...summary, skipped: "no_closed_stage", tickDate };
  const gameDays = [...readyByDay.keys()];
  const [workRows, receipts] = await Promise.all([
    fetchAllRows(() => supabase.from("training_date_work").select("team_id,game_days,expected_rider_ids,quarantined_rider_ids,status")
      .eq("season_id", season.id).eq("tick_date", tickDate).order("team_id")),
    fetchAllRows(() => supabase.from("training_rider_ticks").select("rider_id,game_day")
      .eq("season_id", season.id).eq("tick_date", tickDate).in("game_day", gameDays).order("rider_id").order("game_day")),
  ]);
  const plan = planRaceSessionSettlement({
    teams: context.teams ?? [], riders: context.riders ?? [], readyByDay,
    workByTeam: new Map(workRows.map((row) => [row.team_id, row])),
    receiptKeys: new Set(receipts.map((row) => `${row.rider_id}#${row.game_day}`)),
    gameDaysByDivision: context.gameDaysByDivision ?? new Map(),
    dateEnd: trainingDateBounds(tickDate).end,
  });
  summary.ran = true; summary.tickDate = tickDate; summary.planned = plan.length;
  const deadlineAt = trainingDateDeadline(tickDate).toISOString();
  for (const item of plan) {
    try {
      // Rytterens andre aabne etaper (to etaper samme dato) bliver i den foreloebige opgoerelse aabne felter.
      const { unresolvedSlotsByRider } = resolveTrainingDateReadiness({ ...context, tickDate, now, riderIds: item.riderIds });
      const result = await runDay({
        supabase, teamId: item.teamId, seasonId: season.id, seasonNumber: season.number, now,
        tickDateOverride: tickDate, gameDay: item.gameDay, dateGameDays: item.days, executedBy: "assistant",
        eligibleRiderIds: item.riderIds, unresolvedSlotsByRider, deadlineAt, deadlineReached: false,
        raceSessionRiderIds: new Set(item.riderIds),
      });
      if (result?.alreadyRan) summary.alreadyRan += 1; else summary.settled += 1;
    } catch (error) {
      // best-effort pr. hold: sessionen ligger aaben, og aftenkoerslen afregner den som i dag.
      summary.failed += 1;
      summary.failures.push({ teamId: item.teamId, tickDate, gameDay: item.gameDay, message: error?.message ?? String(error) });
      logger.error?.("[training-race-session] session left open for the evening run", item.teamId, item.gameDay, error?.message ?? error);
    }
  }
  return summary;
}

// Overlap-vagt: et scheduler-tick starter aldrig en ny delkoersel oven i en der koerer.
let running = false;
export function __resetRaceSessionSettlementForTests() { running = false; }

/**
 * Fire-and-forget fra stage-scheduleren. Returnerer loeftet (til proever) eller null, naar intet
 * startes. Kaster aldrig, og et slukket flag giver ingen log.
 */
export function startRaceSessionSettlementAfterStages({
  supabase, stagesRan, clock = () => new Date(), loadDaySpans, logger = console,
  captureExceptionFn = null, run = runRaceSessionSettlement,
}) {
  if (!(stagesRan > 0) || !supabase?.from || running) return null;
  running = true;
  return Promise.resolve()
    .then(() => run({ supabase, now: clock(), loadDaySpans, logger }))
    .then((result) => {
      if (result?.ran && (result.settled || result.failed)) {
        logger.log?.(`  🚴 Loebssessioner afregnet efter etapen: ${result.settled} session(er), ${result.failed} fejl`);
      }
      return result;
    })
    .catch((error) => {
      // best-effort: delkoerslen er en genvej; aftenkoerslen afregner alt det, der mangler.
      logger.error?.("  ❌ Loebssessionens afregning fejlede - aftenkoerslen samler op:", error?.message ?? error);
      try { captureExceptionFn?.(error, { tags: { cron: "training-race-session", trigger: "stage-scheduler" } }); } catch {
        // best-effort: en fejlende Sentry maa aldrig naa scheduleren.
      }
      return null;
    })
    .finally(() => { running = false; });
}
