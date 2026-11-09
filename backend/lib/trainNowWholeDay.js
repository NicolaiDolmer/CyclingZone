// #6461 "Train now" variant B, phase 1 (owner choice 23/10 + 24/10). The stage flag
// `training_train_now_whole_day` is removed (krav 5, 1/11): this is the only press path. Design:
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
// #7737 (owner 9/11, solution A) lifts this behind `training_train_now_instant`: training
// gives form, fatigue and development at the press, and a race gives its share when it
// runs. A stamped rider settles his free race days at the press, gets a provisional form
// and fatigue, and closes his date (with the one injury and illness roll) after his race.
//
// The shared lock (§7 of the design): a whole-date rider's lock row is marked
// (`whole_day_at`) BEFORE his date is settled, and the entries are read again after
// the mark. The database (migration 2026-10-25-6461) serialises the mark and every
// race_entries insert on the same advisory key per rider + date, and skips an insert
// for a marked rider into a race with a stage still to run on that date.
import { TRAIN_NOW_LOCK_TABLE } from "./trainNowLock.js";
import { isTrainingReservationHeldError } from "./dailyTrainingEngine.js";


const sortedDays = (gameDays) => [...new Set(gameDays ?? [])].filter(Number.isInteger).sort((a, b) => a - b);
const slotsOf = (map, id) => (map instanceof Map ? map.get(id) : map?.[id]) ?? [];

// #7737: a race day is free when no open slot sits on it. A slot without a known race
// day cannot be placed, so that rider keeps waiting for his race as before.
function freeDaysOf(days, slots) {
  if (slots.some((slot) => slot?.gameDay == null || !Number.isInteger(Number(slot.gameDay)))) return [];
  const taken = new Set(slots.map((slot) => Number(slot.gameDay)));
  return days.filter((day) => !taken.has(day));
}

/**
 * PURE: which race days does the press settle for which rider?
 * `instant` (#7737): a rider with an open race slot also settles his free race days now.
 * Without it the plan is exactly the #6461 plan: he waits for his whole date.
 * @returns {{ daysByRider: Record<string, number[]>, wholeDateRiderIds: string[],
 *   waitingRiderIds: string[], runs: Array<{ gameDay: number, riderIds: string[] }>,
 *   instantRiderIds?: string[] }}
 */
export function planWholeDayPress({ gameDays, riderIds, unresolvedSlotsByRider = {}, instant = false }) {
  const days = sortedDays(gameDays);
  const daysByRider = {};
  const wholeDateRiderIds = [];
  const waitingRiderIds = [];
  for (const id of riderIds ?? []) {
    const slots = slotsOf(unresolvedSlotsByRider, id);
    const open = slots.length > 0;
    daysByRider[id] = open ? (instant ? freeDaysOf(days, slots) : []) : [...days];
    (open ? waitingRiderIds : wholeDateRiderIds).push(id);
  }
  if (instant) {
    const instantRiderIds = waitingRiderIds.filter((id) => daysByRider[id].length > 0);
    const runs = days
      .map((gameDay) => ({ gameDay, riderIds: [...wholeDateRiderIds, ...instantRiderIds.filter((id) => daysByRider[id].includes(gameDay))] }))
      .filter((run) => run.riderIds.length > 0);
    return { daysByRider, wholeDateRiderIds, waitingRiderIds, runs, instantRiderIds };
  }
  const runs = wholeDateRiderIds.length ? days.map((gameDay) => ({ gameDay, riderIds: [...wholeDateRiderIds] })) : [];
  return { daysByRider, wholeDateRiderIds, waitingRiderIds, runs };
}

// #7737: stamped per rider, first press wins. It goes on before any of his race days
// settles, because the stamp is what lets the database take them out of order.
async function setInstantStamp({ supabase, tickDate, riderIds, at }) {
  if (!riderIds?.length) return;
  const { error } = await supabase.from(TRAIN_NOW_LOCK_TABLE).update({ instant_at: at })
    .eq("tick_date", tickDate).is("instant_at", null).in("rider_id", riderIds);
  if (error) throw new Error(`train-now instant stamp: ${error.message ?? error}`);
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
  supabase, team, season, now, tickDate, work, available, readiness, pressedAt, runDay, readReadiness, instant = false,
}) {
  let plan = planWholeDayPress({ gameDays: work.game_days, riderIds: available, unresolvedSlotsByRider: readiness.unresolvedSlotsByRider, instant });

  // Shared lock: mark first, then read the entries again. An entry committed before
  // the mark is visible now; any later insert is skipped by the database guard.
  await setWholeDayMark({ supabase, tickDate, riderIds: plan.wholeDateRiderIds, at: now.toISOString() });
  const after = await readReadiness();
  const slipped = plan.wholeDateRiderIds.filter((id) => slotsOf(after.unresolvedSlotsByRider, id).length);
  const unresolvedSlotsByRider = { ...readiness.unresolvedSlotsByRider };
  if (slipped.length) {
    // Entered in the window: he is a race rider now and waits for his race.
    for (const id of slipped) unresolvedSlotsByRider[id] = slotsOf(after.unresolvedSlotsByRider, id);
    plan = planWholeDayPress({ gameDays: work.game_days, riderIds: available, unresolvedSlotsByRider, instant });
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
  if (instant) await setInstantStamp({ supabase, tickDate, riderIds: plan.instantRiderIds, at: now.toISOString() });

  const settledDays = [];
  for (const { gameDay, riderIds } of plan.runs) {
    try {
      await runDay({
        supabase, teamId: team.id, seasonId: season.id, seasonNumber: season.number,
        now, tickDateOverride: tickDate, gameDay, dateGameDays: work.game_days, executedBy: "manager",
        eligibleRiderIds: riderIds, unresolvedSlotsByRider,
        deadlineAt: readiness.deadlineAt.toISOString(), deadlineReached: false,
        ...(instant ? { instantPress: true } : {}),
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
      ...(instant ? { instantRiderIds: plan.instantRiderIds } : {}),
    },
  };
}
