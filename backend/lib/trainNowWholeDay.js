// #6461 "Train now" variant B, phase 1 (owner choice 23/10 + 24/10), behind the
// stage flag `training_train_now_whole_day` (seeded off). Design:
// docs/superpowers/specs/2026-10-23-6461-train-now-design.md + PR body (#6461).
//
// The press settles every rider whose date is KNOWN at the press for the whole date:
// a rider without an open race slot (no race today, or his race has already run) gets
// all five race days, including the date's one condition settlement (fatigue/form/
// injury roll). Same engine, same atomic RPC, same inputs as the evening run, so the
// result is the same whenever the press happens (I1).
//
// A rider with an open race slot still waits for his race, as before: settling any of
// his training slots before the race would commit ability growth the race then reads
// (a press-time advantage, I1), and his date's one condition write must follow the
// race (decision 3, no #3461 trick). Training slots around the race are phase 2,
// together with the chronological day model of the combined #6984 design (owner 24/10).
//
// The shared lock (§7 of the design): a whole-date rider's lock row is marked
// (`whole_day_at`) BEFORE his date is settled, and the entries are read again after
// the mark. The database (migration 2026-10-25-6461) serialises the mark and every
// race_entries insert on the same advisory key per rider + date, and skips an insert
// for a marked rider into a race with a stage still to run on that date.
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";
import { TRAIN_NOW_LOCK_TABLE } from "./trainNowLock.js";
import { isTrainingReservationHeldError } from "./dailyTrainingEngine.js";

export const TRAIN_NOW_WHOLE_DAY_FLAG_KEY = "training_train_now_whole_day";

export async function isTrainNowWholeDayEnabled(supabase, { isBetaTester = false } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAIN_NOW_WHOLE_DAY_FLAG_KEY), { isBetaTester });
}

const sortedDays = (gameDays) => [...new Set(gameDays ?? [])].filter(Number.isInteger).sort((a, b) => a - b);
const slotsOf = (map, id) => (map instanceof Map ? map.get(id) : map?.[id]) ?? [];

/**
 * PURE: which race days does the press settle for which rider?
 * @returns {{ daysByRider: Record<string, number[]>, wholeDateRiderIds: string[],
 *   waitingRiderIds: string[], runs: Array<{ gameDay: number, riderIds: string[] }> }}
 */
export function planWholeDayPress({ gameDays, riderIds, unresolvedSlotsByRider = {} }) {
  const days = sortedDays(gameDays);
  const daysByRider = {};
  const wholeDateRiderIds = [];
  const waitingRiderIds = [];
  for (const id of riderIds ?? []) {
    const open = slotsOf(unresolvedSlotsByRider, id).length > 0;
    daysByRider[id] = open ? [] : [...days];
    (open ? waitingRiderIds : wholeDateRiderIds).push(id);
  }
  const runs = wholeDateRiderIds.length ? days.map((gameDay) => ({ gameDay, riderIds: [...wholeDateRiderIds] })) : [];
  return { daysByRider, wholeDateRiderIds, waitingRiderIds, runs };
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
}) {
  let plan = planWholeDayPress({ gameDays: work.game_days, riderIds: available, unresolvedSlotsByRider: readiness.unresolvedSlotsByRider });

  // Shared lock: mark first, then read the entries again. An entry committed before
  // the mark is visible now; any later insert is skipped by the database guard.
  await setWholeDayMark({ supabase, tickDate, riderIds: plan.wholeDateRiderIds, at: now.toISOString() });
  const after = await readReadiness();
  const slipped = plan.wholeDateRiderIds.filter((id) => slotsOf(after.unresolvedSlotsByRider, id).length);
  const unresolvedSlotsByRider = { ...readiness.unresolvedSlotsByRider };
  if (slipped.length) {
    // Entered in the window: he is a race rider now and waits for his race.
    for (const id of slipped) unresolvedSlotsByRider[id] = slotsOf(after.unresolvedSlotsByRider, id);
    plan = planWholeDayPress({ gameDays: work.game_days, riderIds: available, unresolvedSlotsByRider });
  }
  // Every waiting rider is unmarked, not only the ones caught in this reread: a press
  // that marked a rider and then failed (reread or unmark) leaves a stale mark, and the
  // retry already sees him as a race rider. A marked race rider would be skipped by the
  // database on his next race save (Codex P1 on PR #7191). Only a waiting rider is
  // unmarked: no press settles a day for him before his race, so the mark protects nothing.
  if (plan.waitingRiderIds.length) {
    const { error } = await supabase.from(TRAIN_NOW_LOCK_TABLE).update({ whole_day_at: null })
      .eq("tick_date", tickDate).in("rider_id", plan.waitingRiderIds);
    if (error) throw new Error(`train-now whole-day unmark: ${error.message ?? error}`);
  }

  const settledDays = [];
  for (const { gameDay, riderIds } of plan.runs) {
    try {
      await runDay({
        supabase, teamId: team.id, seasonId: season.id, seasonNumber: season.number,
        now, tickDateOverride: tickDate, gameDay, dateGameDays: work.game_days, executedBy: "manager",
        eligibleRiderIds: riderIds, unresolvedSlotsByRider,
        deadlineAt: readiness.deadlineAt.toISOString(), deadlineReached: false,
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
      afterRaceRiderIds: plan.waitingRiderIds,
      settledGameDays: settledDays, gameDays: work.game_days,
    },
  };
}
