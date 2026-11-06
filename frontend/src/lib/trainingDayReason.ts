import type { TrainingActivity } from "./trainingDailyReceipt.ts";

export type DayReason = "injured" | "raceBound" | "fatigueRule" | "restPlan" | "nearBest";

// Below this share of one point over the whole date, "almost nothing" is true.
const ALMOST_NOTHING_PERCENT = 25;

/**
 * #7757: why a settled date gave a rider next to nothing, in one word the report
 * can translate. Only stored evidence counts: a rest day says what kept the rider
 * off the bike. "nearBest" needs every session of the date to carry the engine's
 * own `at_ceiling` mark AND a date that really gave almost nothing: abilities the
 * session does not focus on can still move, and then the sentence would be false.
 * Reports without the evidence (before `at_ceiling` or `bound_race_day` existed, or
 * with an unknown end point) say nothing rather than guess.
 * A date with a whole point has no reason to explain.
 */
export function dayReason(
  activities: TrainingActivity[], wholePoints: number, gainPercent: Record<string, number | null>,
): DayReason | null {
  if (wholePoints > 0 || activities.length === 0) return null;
  // An injury from a session keeps that session: only "rest" means no training.
  const sessions = activities.filter(a => a.intensity !== "rest");
  if (activities.some(a => a.injured) && sessions.length === 0) return "injured";
  if (sessions.length > 0) {
    const percents = Object.values(gainPercent);
    const total = percents.reduce<number>((sum, n) => sum + (n ?? Infinity), 0);
    return sessions.every(a => a.at_ceiling === true) && total < ALMOST_NOTHING_PERCENT ? "nearBest" : null;
  }
  if (activities.some(a => a.bound_race_day)) return "raceBound";
  if (activities.some(a => a.fatigue_rule)) return "fatigueRule";
  return activities.every(a => a.bound_race_day === false) ? "restPlan" : null;
}
