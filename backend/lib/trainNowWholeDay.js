// #6461 "Train now" variant B, phase 1 (owner choice 23/10 + 24/10), behind the
// stage flag `training_train_now_whole_day` (seeded off). Design:
// docs/superpowers/specs/2026-10-23-6461-train-now-design.md + PR body (#6461).
//
// The press settles every rider's date as far as it is KNOWN at the press:
//   - whole date: a rider without an open race slot (no race today, or his race has
//     already run) gets all five race days, including the date's one condition
//     settlement (fatigue/form/injury roll). Same engine, same atomic RPC, same inputs
//     as the evening run, so the result is the same whenever the press happens (I1).
//   - race riders: a rider with an open race slot gets the training slots BEFORE his
//     first open slot, as long as no race binds him on that slot (a binding can still
//     turn into rest or a free slot, so it waits). His race slot is added as its own
//     line once the race is run, and his date's one condition write still waits for
//     it: the race runs on the start-of-date condition (decision 3), and there is no
//     #3461 trick (train to recover, ride fresh).
// What phase 1 deliberately does NOT do: training slots AFTER a rider's open race slot.
// Today's RPC commits a rider's race days in order and the development progress is
// carried slot to slot, so moving them ahead of the race needs the RPC and the
// chronological day model from the combined #6984 design (owner 24/10).
//
// The shared lock (§7 of the design): a whole-date rider's lock row is marked
// (`whole_day_at`) BEFORE his date is settled, and the entries are read again after
// the mark. The database (migration 2026-10-25-6461) serialises the mark and every
// race_entries insert on the same advisory key per rider + date, and drops an insert
// for a marked rider into a race with a stage still to run on that date. So no path
// can read the locks before the press and insert after it: a rider is either settled
// for the whole date and never entered, or entered and waits for his race.
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";
import { loadBoundRiderIdsForRaceDay } from "./trainingRaceDayTick.js";
import { TRAIN_NOW_LOCK_TABLE } from "./trainNowLock.js";
import { isTrainingReservationHeldError } from "./dailyTrainingEngine.js";

export const TRAIN_NOW_WHOLE_DAY_FLAG_KEY = "training_train_now_whole_day";

export async function isTrainNowWholeDayEnabled(supabase, { isBetaTester = false } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAIN_NOW_WHOLE_DAY_FLAG_KEY), { isBetaTester });
}

export { riderWaitsForOpenSlot } from "./trainNowWholeDayRule.js";

const sortedDays = (gameDays) => [...new Set(gameDays ?? [])].filter(Number.isInteger).sort((a, b) => a - b);
const slotsOf = (map, id) => (map instanceof Map ? map.get(id) : map?.[id]) ?? [];

/**
 * PURE: which race days does the press settle for which rider?
 * @returns {{ daysByRider: Record<string, number[]>, wholeDateRiderIds: string[], partialRiderIds: string[],
 *   waitingRiderIds: string[], runs: Array<{ gameDay: number, riderIds: string[] }> }}
 */
export function planWholeDayPress({ gameDays, riderIds, unresolvedSlotsByRider = {}, boundGameDaysByRider = {} }) {
  const days = sortedDays(gameDays);
  const daysByRider = {};
  const wholeDateRiderIds = [];
  const partialRiderIds = [];
  const waitingRiderIds = [];
  for (const id of riderIds ?? []) {
    const slots = slotsOf(unresolvedSlotsByRider, id);
    if (!slots.length) {
      daysByRider[id] = [...days];
      wholeDateRiderIds.push(id);
      continue;
    }
    const openDays = slots.map((slot) => Number(slot?.gameDay));
    const firstOpen = openDays.every(Number.isInteger) ? Math.min(...openDays) : -Infinity;
    const bound = new Set(slotsOf(boundGameDaysByRider, id).map(Number));
    const prefix = [];
    for (const day of days) {
      if (day >= firstOpen || bound.has(day)) break;
      prefix.push(day);
    }
    daysByRider[id] = prefix;
    (prefix.length ? partialRiderIds : waitingRiderIds).push(id);
  }
  const runs = days
    .map((gameDay) => ({ gameDay, riderIds: (riderIds ?? []).filter((id) => daysByRider[id].includes(gameDay)) }))
    .filter((run) => run.riderIds.length);
  return { daysByRider, wholeDateRiderIds, partialRiderIds, waitingRiderIds, runs };
}

/** The race days on which each race rider is bound (race_entry_days), for the prefix rule. */
export async function loadBoundGameDaysByRider({ supabase, seasonId, riderIds, gameDays, loadBound = loadBoundRiderIdsForRaceDay }) {
  const out = {};
  if (!riderIds?.length) return out;
  for (const gameDay of sortedDays(gameDays)) {
    const { data, error } = await loadBound({ supabase, riderIds, seasonId, gameDay, releaseDns: true });
    // Rule gate, same contract as the engine: an unknown binding fails the press.
    if (error || !data) throw new Error(`train-now whole-day binding (game day ${gameDay}): ${error?.message ?? error ?? "no data"}`);
    for (const id of data) (out[id] ??= []).push(gameDay);
  }
  return out;
}

async function setWholeDayMark({ supabase, tickDate, riderIds, at }) {
  if (!riderIds.length) return;
  const { error } = await supabase.from(TRAIN_NOW_LOCK_TABLE).update({ whole_day_at: at })
    .eq("tick_date", tickDate).in("rider_id", riderIds);
  if (error) throw new Error(`train-now whole-day mark: ${error.message ?? error}`);
}

/**
 * The B press after the locks are written. `readReadiness()` re-reads the entries
 * (loadTrainingDateContext + resolveTrainingDateReadiness for `available`).
 * Returns { status, body } like runTrainNow.
 */
export async function settleWholeDayPress({
  supabase, team, season, now, tickDate, work, available, readiness, pressedAt, runDay, readReadiness,
  loadBoundDays = loadBoundGameDaysByRider,
}) {
  const raceRiderIds = available.filter((id) => slotsOf(readiness.unresolvedSlotsByRider, id).length);
  const bound = await loadBoundDays({ supabase, seasonId: season.id, riderIds: raceRiderIds, gameDays: work.game_days });
  let plan = planWholeDayPress({ gameDays: work.game_days, riderIds: available, unresolvedSlotsByRider: readiness.unresolvedSlotsByRider, boundGameDaysByRider: bound });

  // Shared lock: mark first, then read the entries again. An entry committed before
  // the mark is visible now; any later insert is dropped by the database guard.
  await setWholeDayMark({ supabase, tickDate, riderIds: plan.wholeDateRiderIds, at: now.toISOString() });
  const after = await readReadiness();
  const slipped = plan.wholeDateRiderIds.filter((id) => slotsOf(after.unresolvedSlotsByRider, id).length);
  if (slipped.length) {
    // Entered in the window: he is a race rider now. Unmark him so a later save of
    // his race can never drop him, and plan him like the other race riders.
    const { error } = await supabase.from(TRAIN_NOW_LOCK_TABLE).update({ whole_day_at: null })
      .eq("tick_date", tickDate).in("rider_id", slipped);
    if (error) throw new Error(`train-now whole-day unmark: ${error.message ?? error}`);
    const slippedBound = await loadBoundDays({ supabase, seasonId: season.id, riderIds: slipped, gameDays: work.game_days });
    plan = planWholeDayPress({
      gameDays: work.game_days, riderIds: available,
      unresolvedSlotsByRider: { ...readiness.unresolvedSlotsByRider, ...Object.fromEntries(slipped.map((id) => [id, slotsOf(after.unresolvedSlotsByRider, id)])) },
      boundGameDaysByRider: { ...bound, ...slippedBound },
    });
  }

  const unresolvedSlotsByRider = { ...readiness.unresolvedSlotsByRider };
  for (const id of slipped) unresolvedSlotsByRider[id] = slotsOf(after.unresolvedSlotsByRider, id);
  const settledDays = [];
  for (const { gameDay, riderIds } of plan.runs) {
    try {
      await runDay({
        supabase, teamId: team.id, seasonId: season.id, seasonNumber: season.number,
        now, tickDateOverride: tickDate, gameDay, dateGameDays: work.game_days, executedBy: "manager",
        eligibleRiderIds: riderIds, unresolvedSlotsByRider,
        deadlineAt: readiness.deadlineAt.toISOString(), deadlineReached: false,
        settleBeforeUnresolved: true,
      });
    } catch (err) {
      // #6839: the evening run holds this race day; it settles the rest.
      if (isTrainingReservationHeldError(err)) {
        return { status: 409, body: { error: "training_in_progress", tickDate, settledGameDays: settledDays, locked: true } };
      }
      throw err;
    }
    settledDays.push(gameDay);
  }
  return {
    status: 200,
    body: {
      ok: true, tickDate, lockedAt: pressedAt, wholeDay: true,
      settledRiderIds: plan.wholeDateRiderIds, wholeDayRiderIds: plan.wholeDateRiderIds,
      afterRaceRiderIds: [...plan.partialRiderIds, ...plan.waitingRiderIds],
      settledGameDaysByRider: plan.daysByRider,
      settledGameDays: settledDays, gameDays: work.game_days,
    },
  };
}
