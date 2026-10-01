// "Train now" without bonus (#4847, owner design 29/9:
// docs/superpowers/specs/2026-09-29-traen-nu-og-prognose-design.md, decisions 1-4).
//
// The press settles the date NOW, in both directions:
//   - training: every training race day of the date that can be settled today is
//     committed through the SAME engine and the SAME atomic date commit as the
//     evening sweep (runTeamTrainingDay -> commit_training_date_tick). There is no
//     second formula here. The result is computed from the rider's condition at the
//     start of the date (training_date_work.opening_conditions), so a press at 06:00
//     and the automatic settlement give the same result (I1).
//   - entries: the date's race entries for the team are locked. A rider who was not
//     entered cannot be entered into a race on this date afterwards; an entered rider
//     stays in his race. The press itself never writes race_entries/race_entry_days (I3).
//
// What the press deliberately does NOT settle:
//   - the final race day of the date. That commit owns the one condition write per
//     date (fatigue/form), and decision 4 + I4 keep that write with the evening
//     settlement. The evening sweep finds the earlier receipts and settles the rest.
//   - riders with an unresolved race slot (entered, or an autopick candidate). Their
//     race result is not known yet; they settle after their stage, as before.
// Both still use today's locked plan, so the evening result is the one the player
// locked in the morning.
//
// Idempotency (I2): the lock is keyed per rider + date (training_train_now_locks),
// and every settled race day is keyed per rider + race day (training_rider_ticks).
// A double press, a retry and the evening sweep can never credit a race day twice.
//
// Gate: stage flag `training_train_now` (off | beta | on). The registry block is
// added after merge (flags fail CI until the key exists in prod).

import { copenhagenDateString, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";
import { isTrainingConditionPerDateEnabled } from "./trainingDateConditionFlag.js";
import {
  loadTrainingDateContext, resolveTrainingDateReadiness, trainingDateBounds,
} from "./trainingDateReadiness.js";
import { registerTrainingDateWork } from "./trainingDateClose.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { stripProgramFromWeekDays } from "./trainingPrograms.js";
import {
  TRAIN_NOW_LOCK_TABLE, isMissingTable, loadTeamTrainNowLocks, isRaceDateTrainNowLocked,
} from "./trainNowLock.js";

export const TRAIN_NOW_FLAG_KEY = "training_train_now";
export { TRAIN_NOW_LOCK_TABLE, isMissingTable, loadTeamTrainNowLocks, isRaceDateTrainNowLocked };
const SETTLED_STATUSES = new Set(["complete", "needs_reconciliation"]);
const OPEN_STATUSES = ["pending", "partial"];

export async function isTrainNowEnabled(supabase, { isBetaTester = false } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAIN_NOW_FLAG_KEY), { isBetaTester });
}

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message ?? error}`);
  return data;
}

/** PURE: which race days may a press settle? All but the date's final race day (I4). */
export function trainNowGameDays(gameDays) {
  const days = [...new Set(gameDays ?? [])].filter(Number.isInteger).sort((a, b) => a - b);
  return days.slice(0, -1);
}

/** PURE: riders that settle now vs. riders that wait for their race slot. */
export function splitTrainNowRiders({ riderIds, unresolvedSlotsByRider = {} }) {
  const settleNow = [];
  const afterRace = [];
  for (const id of riderIds) {
    if (unresolvedSlotsByRider[id]?.length) afterRace.push(id);
    else settleNow.push(id);
  }
  return { settleNow, afterRace };
}


async function loadTeamDateWork({ supabase, teamId, seasonId, tickDate }) {
  const rows = await checked(supabase.from("training_date_work")
    .select("team_id, season_id, tick_date, status, game_days, expected_rider_ids, quarantined_rider_ids, opening_conditions")
    .eq("team_id", teamId).eq("season_id", seasonId).eq("tick_date", tickDate).limit(2), "training date work");
  if ((rows ?? []).length > 1) throw new Error("training date work: duplicate primary key rows");
  return rows?.[0] ?? null;
}

// The opening condition is snapshotted when the date is registered. Registering
// today before the previous date has written its one condition update would freeze
// a stale opening, so the press waits for the previous date to be settled.
async function hasOpenEarlierDate({ supabase, teamId, tickDate }) {
  const rows = await checked(supabase.from("training_date_work")
    .select("tick_date").eq("team_id", teamId).lt("tick_date", tickDate).in("status", OPEN_STATUSES).limit(1),
  "earlier training date work");
  return (rows ?? []).length > 0;
}

/**
 * Read-only state for the panel. Cheap: no calendar or roster scan.
 * @returns {Promise<{enabled:boolean, available:boolean, reason:string|null, tickDate:string, locked:boolean, lockedAt:string|null, settled:boolean}>}
 */
export async function loadTrainNowStatus({ supabase, team, seasonId, isBetaTester = false, now = new Date() }) {
  const tickDate = copenhagenDateString(now);
  const base = { enabled: false, available: false, reason: "flag_off", tickDate, locked: false, lockedAt: null, settled: false };
  if (!await isTrainNowEnabled(supabase, { isBetaTester })) return base;
  if (!await isTrainingConditionPerDateEnabled(supabase)) return base;
  const enabled = { ...base, enabled: true, reason: null };
  if (!seasonId) return { ...enabled, reason: "no_active_season" };
  if (!team?.league_division_id) return { ...enabled, reason: "no_race_day_today" };
  const [locks, work, earlierOpen] = await Promise.all([
    loadTeamTrainNowLocks({ supabase, teamId: team.id, tickDate }),
    loadTeamDateWork({ supabase, teamId: team.id, seasonId, tickDate }),
    hasOpenEarlierDate({ supabase, teamId: team.id, tickDate }),
  ]);
  const locked = locks.length > 0;
  const lockedAt = locked ? locks.map((row) => row.pressed_at).filter(Boolean).sort()[0] ?? null : null;
  const settled = SETTLED_STATUSES.has(work?.status);
  const reason = settled ? "date_settled" : locked ? "locked" : earlierOpen ? "previous_date_open" : null;
  return { ...enabled, available: reason === null, reason, locked, lockedAt, settled };
}

/**
 * The press. Returns { status, body } so the route stays a thin adapter.
 * DI hooks keep it testable without Postgres; defaults are the sweep's own functions.
 */
export async function runTrainNow({
  supabase, team, season, now = new Date(), isBetaTester = false,
  runDay = runTeamTrainingDay,
  loadContext = loadTrainingDateContext,
  registerWork = registerTrainingDateWork,
  loadDaySpans,
}) {
  if (!team?.id) return { status: 400, body: { error: "no_team" } };
  if (!await isTrainNowEnabled(supabase, { isBetaTester })) return { status: 404, body: { error: "not_found" } };
  if (!await isTrainingConditionPerDateEnabled(supabase)) return { status: 409, body: { error: "train_now_requires_date_settlement" } };
  if (!season?.id) return { status: 409, body: { error: "no_active_season" } };
  if (!team.league_division_id) return { status: 409, body: { error: "no_race_day_today" } };
  if (typeof loadDaySpans !== "function") throw new Error("loadDaySpans required");

  const tickDate = copenhagenDateString(now);
  const existingWork = await loadTeamDateWork({ supabase, teamId: team.id, seasonId: season.id, tickDate });
  if (SETTLED_STATUSES.has(existingWork?.status)) {
    return { status: 409, body: { error: "date_settled", tickDate } };
  }
  if (await hasOpenEarlierDate({ supabase, teamId: team.id, tickDate })) {
    return { status: 409, body: { error: "previous_date_open", tickDate } };
  }

  const context = await loadContext({ supabase, season, tickDate, loadDaySpans, registeredTeamIds: [team.id] });
  const days = existingWork?.game_days ?? context.gameDaysByDivision.get(team.league_division_id);
  if (!days?.length) return { status: 409, body: { error: "no_race_day_today", tickDate } };

  // Same roster rule as the evening sweep (trainingDateClose.js): riders owned
  // before the date ends. Registration freezes it; the press never widens it.
  const dateEnd = trainingDateBounds(tickDate).end;
  const currentIds = context.riders.filter((rider) => rider.team_id === team.id
    && (!rider.created_at || new Date(rider.created_at) < dateEnd)
    && (!rider.acquired_at || new Date(rider.acquired_at) < dateEnd)).map((rider) => rider.id);
  const expectedIds = existingWork?.expected_rider_ids ?? currentIds;
  if (!expectedIds.length) return { status: 409, body: { error: "no_riders", tickDate } };

  // 1) Lock FIRST: from here the date's entries are frozen for this team, so the
  //    readiness below cannot be invalidated by a selection saved mid-press.
  //    Idempotent per rider + date (I2); a repeated press keeps the first time.
  const pressedAt = now.toISOString();
  const { error: lockError } = await supabase.from(TRAIN_NOW_LOCK_TABLE).upsert(
    expectedIds.map((riderId) => ({
      rider_id: riderId, tick_date: tickDate, season_id: season.id, team_id: team.id, pressed_at: pressedAt,
    })),
    { onConflict: "rider_id,tick_date", ignoreDuplicates: true },
  );
  if (lockError) throw new Error(`train-now lock: ${lockError.message ?? lockError}`);

  // 2) Register the date exactly as the sweep does (frozen roster + opening condition).
  const work = existingWork ?? await registerWork({
    supabase, teamId: team.id, seasonId: season.id, tickDate, gameDays: days, riderIds: currentIds, now,
  });
  const quarantined = new Set(work.quarantined_rider_ids ?? []);
  const available = work.expected_rider_ids.filter((id) => !quarantined.has(id)
    && currentIds.includes(id) && (work.opening_conditions === undefined || work.opening_conditions?.[id]));

  // 3) Who can settle now? The sweep's own readiness rule, before the deadline.
  const readiness = resolveTrainingDateReadiness({ ...context, tickDate, now, riderIds: available });
  const { settleNow, afterRace } = splitTrainNowRiders({
    riderIds: available, unresolvedSlotsByRider: readiness.unresolvedSlotsByRider,
  });

  // 4) Settle the date's race days, final day excluded (I4), in order.
  const settledDays = [];
  if (settleNow.length) {
    for (const gameDay of trainNowGameDays(work.game_days)) {
      await runDay({
        supabase, teamId: team.id, seasonId: season.id, seasonNumber: season.number,
        now, tickDateOverride: tickDate, gameDay, dateGameDays: work.game_days, executedBy: "manager",
        eligibleRiderIds: settleNow, unresolvedSlotsByRider: readiness.unresolvedSlotsByRider,
        deadlineAt: readiness.deadlineAt.toISOString(), deadlineReached: false,
      });
      settledDays.push(gameDay);
    }
  }

  return {
    status: 200,
    body: {
      ok: true, tickDate, lockedAt: pressedAt,
      settledRiderIds: settleNow, afterRaceRiderIds: afterRace,
      settledGameDays: settledDays, gameDays: work.game_days,
    },
  };
}

// Stable comparison of one weekday cell (key order independent).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}
export function sameWeekdayCell(a, b) {
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}

/**
 * Is today's plan locked for the team? Only while the press exists and the date is
 * not yet settled by the evening. Fails open when the table is not migrated.
 */
export async function isTodayPlanLocked({ supabase, teamId, now = new Date() }) {
  const tickDate = copenhagenDateString(now);
  const locks = await loadTeamTrainNowLocks({ supabase, teamId, tickDate });
  if (!locks.length) return false;
  const rows = await checked(supabase.from("training_date_work").select("status")
    .eq("team_id", teamId).eq("tick_date", tickDate), "training date work");
  return !(rows ?? []).some((row) => SETTLED_STATUSES.has(row.status));
}

/**
 * Express middleware factory: today's training fields are locked after a press;
 * tomorrow's plan stays editable. `kind` names the edit:
 *   "plan"          focus/intensity (training_plans) - always touches today
 *   "weekPlan"      PUT a week plan - allowed when today's weekday cell is unchanged
 *   "weekPlanClear" DELETE a week plan - touches today
 *   "programCell"   one program cell - allowed for any other weekday
 *   "programApply"  apply a program - touches today
 */
export function createTrainNowPlanLock({ supabase, now = () => new Date() }) {
  return (kind) => async (req, res, next) => {
    try {
      if (!req.team?.id) return next();
      const at = now();
      if (!await isTodayPlanLocked({ supabase, teamId: req.team.id, now: at })) return next();
      const todayKey = copenhagenWeekdayKey(copenhagenDateString(at));
      if (kind === "programCell" && req.body?.weekday !== todayKey) return next();
      if (kind === "weekPlan") {
        // Compare what WILL be stored (the routes strip program fields) with what
        // is stored now. A rider without his own row follows the team's row today.
        const riderId = req.params?.riderId ?? null;
        const rows = await checked(supabase.from("training_week_plans").select("rider_id, days")
          .eq("team_id", req.team.id), "week plan");
        const own = (rows ?? []).find((row) => (riderId ? row.rider_id === riderId : row.rider_id == null));
        const teamRow = (rows ?? []).find((row) => row.rider_id == null);
        const current = (own ?? (riderId ? teamRow : null))?.days?.[todayKey];
        const incoming = stripProgramFromWeekDays(req.body?.days)?.[todayKey];
        if (sameWeekdayCell(current, incoming)) return next();
      }
      return res.status(409).json({ error: "train_now_locked" });
    } catch (err) {
      return next(err);
    }
  };
}
