import type { TrainingActivity } from "./trainingDailyReceipt.ts";

export type DayReason = "injured" | "raceBound" | "fatigueRule" | "restPlan" | "nearBest";

/**
 * #7757: why a settled date gave a rider next to nothing, in one word the report
 * can translate. Only stored evidence counts: a rest day says what kept the rider
 * off the bike, and "nearBest" needs every session of the date to carry the
 * engine's own `at_ceiling` mark, so older reports without it never claim it.
 * Reports from before `bound_race_day` existed cannot tell a planned rest from a
 * race binding, so they say nothing rather than guess.
 * A date with a whole point has no reason to explain.
 */
export function dayReason(activities: TrainingActivity[], wholePoints: number): DayReason | null {
  if (wholePoints > 0 || activities.length === 0) return null;
  const sessions = activities.filter(a => a.intensity !== "rest" && !a.injured);
  if (activities.some(a => a.injured) && sessions.length === 0) return "injured";
  if (sessions.length > 0) return sessions.every(a => a.at_ceiling === true) ? "nearBest" : null;
  if (activities.some(a => a.bound_race_day)) return "raceBound";
  if (activities.some(a => a.fatigue_rule)) return "fatigueRule";
  return activities.every(a => a.bound_race_day === false) ? "restPlan" : null;
}
