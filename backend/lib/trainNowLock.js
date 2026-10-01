// #4847 "Train now": the lock table readers, kept free of engine imports so the
// race-selection path (raceSelection.js) can use them without pulling in the
// training engine. The press itself lives in trainNow.js.

import { copenhagenDateString } from "./copenhagenTime.js";
import { fetchAllRows } from "./supabasePagination.js";

export const TRAIN_NOW_LOCK_TABLE = "training_train_now_locks";

// 42P01 (Postgres) / PGRST205 (PostgREST schema cache): the lock table is not
// migrated yet. The feature cannot have been used then, so readers treat it as
// "no lock" instead of failing every plan edit and race selection.
export function isMissingTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** Lock rows for the team on one date (empty when the table is not migrated). */
export async function loadTeamTrainNowLocks({ supabase, teamId, tickDate }) {
  const { data, error } = await supabase.from(TRAIN_NOW_LOCK_TABLE)
    // pagination-safe: one team's roster on one date, far below the 1000-row cap.
    .select("rider_id, pressed_at").eq("team_id", teamId).eq("tick_date", tickDate);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`train-now locks: ${error.message ?? error}`);
  }
  return data ?? [];
}

/**
 * I3 guard for race selection: is this race's date locked for the team?
 * A race with a stage on a locked date cannot have its selection changed by the
 * team (no new rider, no removal): "the day is decided in both directions".
 * The press itself never writes race_entries / race_entry_days.
 */
export async function isRaceDateTrainNowLocked({ supabase, teamId, raceId }) {
  if (!teamId || !raceId) return false;
  const { data: stages, error: stageError } = await supabase.from("race_stage_schedule")
    // pagination-safe: one race's stages (a grand tour is ~21 rows).
    .select("scheduled_at").eq("race_id", raceId);
  if (stageError) throw new Error(`race stage dates: ${stageError.message ?? stageError}`);
  const dates = [...new Set((stages ?? []).filter((row) => row.scheduled_at)
    .map((row) => copenhagenDateString(new Date(row.scheduled_at))))];
  if (!dates.length) return false;
  const { data, error } = await supabase.from(TRAIN_NOW_LOCK_TABLE)
    .select("rider_id").eq("team_id", teamId).in("tick_date", dates).limit(1);
  if (error) {
    if (isMissingTable(error)) return false;
    throw new Error(`train-now locks: ${error.message ?? error}`);
  }
  return (data ?? []).length > 0;
}

/**
 * #6006: the locked dates per team for a set of Copenhagen dates, for the automatic
 * selection paths (entry sweep, race-start autofill). Map<teamId, Set<tickDate>>.
 * Empty when the table is not migrated (nobody can have pressed then).
 */
export async function loadTrainNowLockedDatesByTeam({ supabase, dates }) {
  const unique = [...new Set((dates ?? []).filter(Boolean))];
  const byTeam = new Map();
  if (!unique.length) return byTeam;
  let rows;
  try {
    // One row per rider + date: several pressing teams can exceed the 1000-row cap.
    rows = await fetchAllRows(() => supabase.from(TRAIN_NOW_LOCK_TABLE)
      .select("team_id, tick_date, rider_id").in("tick_date", unique)
      .order("team_id").order("tick_date").order("rider_id"));
  } catch (error) {
    if (isMissingTable(error)) return byTeam;
    throw new Error(`train-now locks: ${error.message ?? error}`, { cause: error });
  }
  for (const row of rows ?? []) {
    if (!row?.team_id || !row?.tick_date) continue;
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, new Set());
    byTeam.get(row.team_id).add(row.tick_date);
  }
  return byTeam;
}

/** PURE (#6006): does the team have a press on any of the race's stage dates? */
export function isRaceLockedForTeam({ lockedDatesByTeam, teamId, raceDates }) {
  const locked = lockedDatesByTeam?.get(teamId);
  if (!locked?.size) return false;
  return (raceDates ?? []).some((date) => locked.has(date));
}

/** PURE (#6006): Copenhagen dates of a race's stages from race_stage_schedule rows. */
export function raceStageDates(scheduleRows) {
  return [...new Set((scheduleRows ?? []).filter((row) => row?.scheduled_at)
    .map((row) => copenhagenDateString(new Date(row.scheduled_at))))];
}

/**
 * #6006: teams that pressed "Train now" on a date of this race. The race-start
 * autofill must not add any of their riders: the day is decided (I3, #5267).
 */
export async function loadTrainNowLockedTeamIdsForRace({ supabase, raceId }) {
  if (!raceId) return new Set();
  const { data: stages, error } = await supabase.from("race_stage_schedule")
    // pagination-safe: one race's stages (a grand tour is ~21 rows).
    .select("scheduled_at").eq("race_id", raceId);
  if (error) throw new Error(`race stage dates: ${error.message ?? error}`);
  const dates = raceStageDates(stages);
  const byTeam = await loadTrainNowLockedDatesByTeam({ supabase, dates });
  return new Set(byTeam.keys());
}
