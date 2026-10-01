// #4847 "Train now": the lock table readers, kept free of engine imports so the
// race-selection path (raceSelection.js) can use them without pulling in the
// training engine. The press itself lives in trainNow.js.

import { copenhagenDateString } from "./copenhagenTime.js";

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
