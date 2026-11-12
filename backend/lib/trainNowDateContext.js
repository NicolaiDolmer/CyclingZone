// #7982 part 2 (owner choice A 12/11): the "Train now" press's own date context reader.
//
// loadTrainingDateContext (trainingDateReadiness.js) is the evening sweep's loader. It
// reads the whole game (every team, every rider on a team, a calendar lookup per division
// and a result/abandon read per pending stage), and a press called it three times. This
// reader returns the SAME shape for ONE team, from one database round trip per read
// (database/2026-11-12-7982-train-now-date-context.sql):
//   - the calendar part keeps the whole season's race and schedule evidence, so the date's
//     race days, the previous highest race day and the last race date come from the same
//     ground as the sweep's loader;
//   - the binding part is narrowed to the team and its current riders, with every
//     entry, start snapshot, result, abandon, race load, frozen slot and press lock that
//     can bind them on the date (also under a previous team or in another pool).
// The rules stay here in the existing JS resolvers; the SQL only moves rows. The sweep
// loader is not changed and the evening sweep does not use this file.
//
// What the press reads from a context: the team's riders and team row, the race days of
// the team's division, and resolveTrainingDateReadiness for the team's riders. Rows of
// other teams' riders never reach those answers, so leaving them out changes nothing the
// press sees (proven by the old/new oracle in trainNowDateContext.test.js).
//
// Deploy window: before the migration is applied the function does not exist. Exactly
// that error falls back to the old loader; every other error fails the press closed.

import {
  loadTrainingDateContext, trainingDateBounds, isTrainingDateTeam, trainingAutopickCandidates,
  bridgeGameDays, loadSeasonBridgeBounds,
} from "./trainingDateReadiness.js";
import {
  NO_PRIOR_GAME_DAY, gameDaysByDivision, gameDaySpansByDivision, axisEndByDivisionFor,
} from "./trainingDayCloseTrigger.js";
import { resolveCalendarRaceDayTarget } from "./trainingRaceDayTick.js";
import { isEligibleRider, ANY_SQUAD } from "./riderEligibility.js";

export const TRAIN_NOW_DATE_CONTEXT_RPC = "train_now_date_context";

/** Exactly a missing function (deploy window), not any other error. */
export function isMissingTrainNowDateContextRpc(error) {
  if (error?.code !== "PGRST202" && error?.code !== "42883") return false;
  return String(error?.message ?? "").includes(TRAIN_NOW_DATE_CONTEXT_RPC);
}

const BUNDLE_LISTS = ["riders", "races", "stages", "runs", "entries", "results", "incidents", "loads", "frozen", "locked_rider_ids", "calendar"];

function assertBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) throw new Error("train-now date context: no bundle");
  for (const key of BUNDLE_LISTS) {
    if (!Array.isArray(bundle[key])) throw new Error(`train-now date context: ${key} missing`);
  }
}

// The sweep's three answers per division (trainingDayCloseTrigger.js): a number, "the
// lookup found nothing before today", or unknown. Unknown never becomes 0.
function priorMaxOf(row) {
  if (!row) return null;
  if (Number(row.prior_rows) === 0) return NO_PRIOR_GAME_DAY;
  if (row.prior_has_unknown !== false) return null;
  const raw = row.prior_max_game_day;
  const gd = raw === null || raw === undefined ? NaN : Number(raw);
  return Number.isFinite(gd) ? gd : null;
}

function isLastRaceDateOf(row) {
  if (row?.later_exists === false) return true;
  if (row?.later_exists === true) return false;
  return null;
}

// Same steps as loadDayCloseSpans, on the bundle's per-division answers instead of two
// sequential lookups per division.
async function daySpansFromBundle({ races, stages, calendar, raceDaysPerSeason }) {
  const divisionByRace = new Map(races.map((race) => [race.id, race.league_division_id ?? null]));
  const todaysDivisions = new Set(gameDaysByDivision(stages, divisionByRace).keys());
  const calendarByDivision = new Map(calendar.map((row) => [row.league_division_id, row]));
  const priorMaxByDivision = new Map();
  const lastRaceDateByDivision = new Map();
  for (const divisionId of todaysDivisions) {
    priorMaxByDivision.set(divisionId, priorMaxOf(calendarByDivision.get(divisionId)));
    lastRaceDateByDivision.set(divisionId, isLastRaceDateOf(calendarByDivision.get(divisionId)));
  }
  let axisEndByDivision = null;
  if ([...lastRaceDateByDivision.values()].some((isLast) => isLast === true)) {
    let target = null;
    try {
      target = await raceDaysPerSeason();
    } catch {
      // best-effort, same as loadDayCloseSpans: a target that cannot be read means "do
      // not extend"; the date's own race days still settle.
      target = null;
    }
    axisEndByDivision = axisEndByDivisionFor({ lastRaceDateByDivision, raceDaysPerSeason: target });
  }
  return gameDaySpansByDivision(stages, divisionByRace, priorMaxByDivision, { axisEndByDivision });
}

/**
 * PURE + the bridge lookup: the press context from one bundle. Mirrors the assembly in
 * loadTrainingDateContext step for step.
 */
export async function buildTrainNowDateContext({ supabase, season, tickDate, teamId, bundle }) {
  assertBundle(bundle);
  const { end } = trainingDateBounds(tickDate);
  const { races, riders, stages, runs, loads } = bundle;
  const frozenEntries = bundle.frozen.filter((row) => row?.instant_entry_snapshot != null).map((row) => {
    if (!Array.isArray(row.instant_entry_snapshot.slots)) throw new Error("train-now date eligibility: invalid frozen slots");
    return { rider_id: row.rider_id, slots: row.instant_entry_snapshot.slots };
  });
  const registered = new Set([teamId]);
  const teams = (bundle.team ? [bundle.team] : []).filter((team) => isTrainingDateTeam(team, registered, end));
  const raceIds = [...new Set(stages.map((row) => row.race_id))];
  const pending = stages.filter((stage) => {
    const race = races.find((row) => row.id === stage.race_id);
    return !race || Number(race.stages_completed) < stage.stage_number || race.finalize_state != null;
  });
  const onPendingStage = (row) => pending.some((stage) => stage.race_id === row.race_id && Number(stage.stage_number) === Number(row.stage_number));
  const results = bundle.results.filter(onPendingStage);
  const incidents = bundle.incidents.filter(onPendingStage);
  const spans = await daySpansFromBundle({
    races, stages, calendar: bundle.calendar,
    raceDaysPerSeason: () => resolveCalendarRaceDayTarget({ seasonNumber: season.number }),
  });
  const trainNowLockedRiderIds = raceIds.length ? new Set(bundle.locked_rider_ids) : new Set();
  const candidateRiderIdsByRace = new Map();
  for (const race of races.filter((row) => raceIds.includes(row.id))) {
    candidateRiderIdsByRace.set(race.id, trainingAutopickCandidates(race, teams, riders, trainNowLockedRiderIds));
  }
  const riderById = new Map(riders.map((rider) => [rider.id, rider]));
  const validEntries = bundle.entries.filter((entry) => isEligibleRider(riderById.get(entry.rider_id), { teamId: entry.team_id, squad: ANY_SQUAD }));
  const gameDaysByDivisionMap = new Map([...spans].map(([id, span]) => [id, span.gameDays]));
  // #7282: a bridge date has no stages, so no spans; every division gets the bridge days.
  if (!stages.length) {
    const bridgeDays = bridgeGameDays({ tickDate, ...await loadSeasonBridgeBounds(supabase, season) });
    if (bridgeDays.length) {
      for (const team of teams) if (team.league_division_id) gameDaysByDivisionMap.set(team.league_division_id, bridgeDays);
    }
  }
  return { tickDate, races, teams, riders, stages, runs: runs ?? [], entries: validEntries, results, incidents, loads, candidateRiderIdsByRace, frozenEntries,
    gameDaysByDivision: gameDaysByDivisionMap };
}

/**
 * Drop-in for runTrainNow's `loadContext`: same arguments and the same shape as
 * loadTrainingDateContext, for `teamId` (default: the one registered team).
 * `onReader` is told which reader answered ("rpc" or "legacy"), for the press timing.
 */
export async function loadTrainNowDateContext({
  supabase, season, tickDate, loadDaySpans, registeredTeamIds = [], teamId = registeredTeamIds[0],
  fallback = loadTrainingDateContext, onReader = () => {},
}) {
  if (!teamId) throw new Error("train-now date context: team required");
  const { start, end } = trainingDateBounds(tickDate);
  const { data, error } = await supabase.rpc(TRAIN_NOW_DATE_CONTEXT_RPC, {
    p_team_id: teamId, p_season_id: season.id, p_tick_date: tickDate,
    p_day_start: start.toISOString(), p_day_end: end.toISOString(),
  });
  if (error) {
    if (!isMissingTrainNowDateContextRpc(error)) throw new Error(`train-now date context: ${error.message ?? error}`);
    onReader("legacy");
    return fallback({ supabase, season, tickDate, loadDaySpans, registeredTeamIds: [teamId] });
  }
  onReader("rpc");
  return buildTrainNowDateContext({ supabase, season, tickDate, teamId, bundle: data });
}
