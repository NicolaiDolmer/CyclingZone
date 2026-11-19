// #7982 (Fable krav 7): the date receipt takes its opening progress from the session that was
// SAVED first and its closing progress from the one saved last. A race session settled at its
// stage (or a Train now press) can be saved before the date's earlier race days, so race-day
// order is not always save order. The report rows do not carry the save time; it lives on the
// receipt row (training_rider_ticks.settled_at, TRAINING_RULES 13.5), which the client cannot
// read. This adds it to each rider row of today's runs, read-only.
//
// Best-effort: on any error, or for a session without a receipt row, the runs are returned as
// they are, and the frontend keeps race-day order (the view from before this change).
import { fetchAllRows } from "./supabasePagination.js";

const keyOf = (seasonId, tickDate, riderId, gameDay) => `${seasonId}:${tickDate}:${riderId}:${gameDay}`;

/**
 * Pure: a copy of `runs` with `settled_at` on every rider row that has a stored receipt.
 * Rows without one are left exactly as they are; the input is never mutated.
 * @param {Array<Record<string, any>>} runs training_day_runs rows (report.riders = rider rows)
 * @param {Array<{rider_id:string, season_id:string, tick_date:string, game_day:number, settled_at:string|null}>} ticks
 */
export function withReceiptSaveOrder(runs, ticks) {
  const at = new Map();
  for (const tick of ticks ?? []) {
    if (typeof tick?.settled_at === "string" && tick.settled_at) {
      at.set(keyOf(tick.season_id, String(tick.tick_date).slice(0, 10), tick.rider_id, tick.game_day), tick.settled_at);
    }
  }
  if (!at.size || !Array.isArray(runs)) return runs;
  return runs.map((run) => {
    const riders = run?.report?.riders;
    if (!Array.isArray(riders) || !run.season_id) return run;
    let changed = false;
    const next = riders.map((row) => {
      const day = row?.game_day ?? run.game_day;
      const settledAt = row?.rider_id && Number.isInteger(day)
        ? at.get(keyOf(run.season_id, String(run.tick_date).slice(0, 10), row.rider_id, day)) : undefined;
      if (!settledAt) return row;
      changed = true;
      return { ...row, settled_at: settledAt };
    });
    return changed ? { ...run, report: { ...run.report, riders: next } } : run;
  });
}

/**
 * I/O: reads the team's receipts for the runs' dates and adds their save time. Only a date with
 * two or more stored race days can be out of order, so one run (or none) needs no read.
 */
export async function attachReceiptSaveOrder7982({ supabase, teamId, runs, logger = console }) {
  if (!Array.isArray(runs) || runs.length < 2 || !teamId || !supabase?.from) return runs;
  const tickDates = [...new Set(runs.map((run) => run?.tick_date).filter(Boolean).map((d) => String(d).slice(0, 10)))];
  if (!tickDates.length) return runs;
  try {
    const ticks = await fetchAllRows(() => supabase.from("training_rider_ticks")
      .select("rider_id,season_id,tick_date,game_day,settled_at")
      .eq("team_id", teamId)
      .in("tick_date", tickDates)
      .order("rider_id")
      .order("game_day"));
    return withReceiptSaveOrder(runs, ticks);
  } catch (error) {
    // best-effort: without the save time the receipt keeps race-day order, as before #7982.
    logger.warn?.("[training-receipt-save-order] save order unavailable, race-day order kept:", error?.message ?? error);
    return runs;
  }
}
