// #4847 "Train now": the lock table readers, kept free of engine imports so the
// race-selection path (raceSelection.js) can use them without pulling in the
// training engine. The press itself lives in trainNow.js.
//
// #6139 (owner decision 8/10, option A): the race-selection lock is PER RIDER.
// A press writes one lock row per rider it froze for the date (the riders that
// trained). Only those riders are decided for the date's races: a locked rider
// cannot be entered into a race with a stage on that date, and a locked rider
// already entered stays in it. Riders without a lock row for the date (bought or
// moved after the press) can still be entered. The rule "race OR train on a race
// day" (#5267) is unchanged.

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

// #7737: the migration adds instant_at after the backend deploys (auto-migrate, #2642).
// Until then nobody can have been stamped, so a missing column reads as "no stamp".
function isMissingInstantColumn(error) {
  return (error?.code === "42703" || error?.code === "PGRST204") && String(error?.message ?? "").includes("instant_at");
}

/**
 * #7737: the riders a press stamped to train their free race days straight away. The
 * stamp, not the switch, decides how a rider's date runs, so turning the switch off
 * mid-date is safe. A read error throws: a guess here would misplace a settlement.
 */
export async function loadTrainNowInstantRiderIds({ supabase, tickDate, riderIds }) {
  const ids = [...new Set((riderIds ?? []).filter(Boolean))];
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from(TRAIN_NOW_LOCK_TABLE)
    // pagination-safe: one team's frozen roster on one date, far below the 1000-row cap.
    // schema-columns-ok: instant_at tilfoejes af database/2026-11-09-7737-train-now-instant.sql, applied post-merge.
    .select("rider_id, instant_at").eq("tick_date", tickDate).in("rider_id", ids);
  if (error) {
    if (isMissingTable(error) || isMissingInstantColumn(error)) return new Set();
    throw new Error(`train-now instant stamps: ${error.message ?? error}`);
  }
  return new Set((data ?? []).filter((row) => row.instant_at != null).map((row) => row.rider_id));
}

/** PURE (#6006): Copenhagen dates of a race's stages from race_stage_schedule rows. */
export function raceStageDates(scheduleRows) {
  return [...new Set((scheduleRows ?? []).filter((row) => row?.scheduled_at)
    .map((row) => copenhagenDateString(new Date(row.scheduled_at))))];
}

// Lock rows on the given dates, optionally only for some riders. Rider-scoped, not
// team-scoped: a rider who trained today cannot race today, whichever team pressed.
async function loadLockRows({ supabase, dates, riderIds = null }) {
  const uniqueDates = [...new Set((dates ?? []).filter(Boolean))];
  const uniqueRiders = riderIds ? [...new Set(riderIds.filter(Boolean))] : null;
  if (!uniqueDates.length || (uniqueRiders && !uniqueRiders.length)) return [];
  try {
    // One row per rider + date: several pressing teams can exceed the 1000-row cap.
    return await fetchAllRows(() => {
      let query = supabase.from(TRAIN_NOW_LOCK_TABLE)
        .select("rider_id, tick_date, team_id, pressed_at").in("tick_date", uniqueDates);
      if (uniqueRiders) query = query.in("rider_id", uniqueRiders);
      return query.order("tick_date").order("rider_id");
    });
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`train-now locks: ${error.message ?? error}`, { cause: error });
  }
}

/**
 * #6139: the locked riders per Copenhagen date, for the automatic selection paths
 * (entry sweep, training readiness). Map<tickDate, Set<riderId>>. Empty when the
 * table is not migrated (nobody can have pressed then).
 */
export async function loadTrainNowLockedRidersByDate({ supabase, dates }) {
  const byDate = new Map();
  for (const row of await loadLockRows({ supabase, dates })) {
    if (!row?.rider_id || !row?.tick_date) continue;
    if (!byDate.has(row.tick_date)) byDate.set(row.tick_date, new Set());
    byDate.get(row.tick_date).add(row.rider_id);
  }
  return byDate;
}

/** PURE (#6139): the riders locked on any of the dates. */
export function lockedRidersOnDates(lockedRidersByDate, dates) {
  const out = new Set();
  for (const date of dates ?? []) for (const id of lockedRidersByDate?.get(date) ?? []) out.add(id);
  return out;
}

/**
 * #6139: the lock per race. Map<raceId, { riderIds: Set<riderId>, pressedAt: string|null }>.
 * `riderIds` narrows the read (a team's roster); without it every locked rider on the
 * races' dates is returned (race-start autofill). `pressedAt` is the team's own first
 * press on those dates, for the "locked since" line in the UI (null without `teamId`).
 * @param {{ supabase: any, raceIds: string[], riderIds?: string[] | null, teamId?: string | null }} args
 */
export async function loadTrainNowLocksForRaces({ supabase, raceIds, riderIds = null, teamId = null }) {
  const ids = [...new Set((raceIds ?? []).filter(Boolean))];
  const out = new Map(ids.map((id) => [id, { riderIds: new Set(), pressedAt: null }]));
  if (!ids.length || (riderIds && !riderIds.length)) return out;
  const schedule = [];
  // pagination-safe: chunks of 40 races; a grand tour is ~21 stages, so a chunk stays
  // below the 1000-row cap.
  for (let i = 0; i < ids.length; i += 40) {
    const { data, error } = await supabase.from("race_stage_schedule")
      .select("race_id, scheduled_at").in("race_id", ids.slice(i, i + 40));
    if (error) throw new Error(`race stage dates: ${error.message ?? error}`);
    schedule.push(...(data ?? []));
  }
  const datesByRace = new Map(ids.map((id) => [id, raceStageDates(schedule.filter((row) => row.race_id === id))]));
  const rows = await loadLockRows({ supabase, dates: [...datesByRace.values()].flat(), riderIds });
  for (const [raceId, dates] of datesByRace) {
    const entry = out.get(raceId);
    for (const row of rows) {
      if (!dates.includes(row.tick_date)) continue;
      entry.riderIds.add(row.rider_id);
      if (teamId && row.team_id === teamId && row.pressed_at
        && (!entry.pressedAt || row.pressed_at < entry.pressedAt)) entry.pressedAt = row.pressed_at;
    }
  }
  return out;
}

/** #6139: the lock for one race (see loadTrainNowLocksForRaces). */
export async function loadRaceTrainNowLock({ supabase, raceId, riderIds = null, teamId = null }) {
  const byRace = await loadTrainNowLocksForRaces({ supabase, raceIds: [raceId], riderIds, teamId });
  return byRace.get(raceId) ?? { riderIds: new Set(), pressedAt: null };
}

/**
 * PURE (#6139, I3): the locked riders a selection change would move. A locked rider
 * may neither be added nor removed; every other rider is free. Sorted for stable
 * error payloads.
 */
export function trainNowSelectionViolations({ lockedRiderIds, currentRiderIds = [], nextRiderIds = [] }) {
  const current = new Set(currentRiderIds);
  const next = new Set(nextRiderIds);
  return [...(lockedRiderIds ?? [])].filter((id) => current.has(id) !== next.has(id)).sort();
}

/** Continue only an already frozen date when the instant switch is off. */
export async function loadTrainNowFrozenDateEntries({ supabase, teamId, seasonId, tickDate, riderIds }) {
  if (!riderIds.length) return [];
  const { data, error } = await supabase.from(TRAIN_NOW_LOCK_TABLE)
    // pagination-safe: a single registered team roster is below the row cap.
    // schema-columns-ok: instant_entry_snapshot is added by the pending #7737 migration.
    .select("rider_id, instant_entry_snapshot").eq("team_id", teamId).eq("season_id", seasonId)
    .eq("tick_date", tickDate).in("rider_id", riderIds);
  if (error) {
    if (isMissingTable(error) || ((error.code === "42703" || error.code === "PGRST204")
      && String(error.message ?? "").includes("instant_entry_snapshot"))) return [];
    throw new Error(`train-now date eligibility: ${error.message ?? error}`);
  }
  return (data ?? []).filter(row => row.instant_entry_snapshot != null).map(row => {
    if (!Array.isArray(row.instant_entry_snapshot.slots)) throw new Error("train-now date eligibility: invalid frozen slots");
    return { rider_id: row.rider_id, slots: row.instant_entry_snapshot.slots };
  });
}

/** Frozen slot membership for the common date sweep, independent of the switch. */
export async function loadTrainNowFrozenDateSlots({ supabase, seasonId, tickDate }) {
  let rows;
  try {
    // schema-columns-ok: instant_entry_snapshot is added by the pending #7737 migration.
    rows = await fetchAllRows(() => supabase.from(TRAIN_NOW_LOCK_TABLE)
      .select("rider_id, instant_entry_snapshot").eq("season_id", seasonId).eq("tick_date", tickDate).order("rider_id"));
  } catch (error) {
    if (isMissingTable(error) || ((error.code === "42703" || error.code === "PGRST204")
      && String(error.message ?? "").includes("instant_entry_snapshot"))) return [];
    throw new Error(`train-now date eligibility: ${error.message ?? error}`, { cause: error });
  }
  return rows.filter(row => row.instant_entry_snapshot != null).map(row => {
    if (!Array.isArray(row.instant_entry_snapshot.slots)) throw new Error("train-now date eligibility: invalid frozen slots");
    return { rider_id: row.rider_id, slots: row.instant_entry_snapshot.slots };
  });
}
