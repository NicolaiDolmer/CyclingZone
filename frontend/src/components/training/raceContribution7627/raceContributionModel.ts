// #7627: where a rider's progress on a date came from, training or races.
//
// Pure view helpers for the daily training report. They never compute
// development: they split what the receipt already stores per activity (each
// slot's whole points plus progress_after minus progress_before, the same sum
// the receipt itself uses) by the kind of slot. Nothing here is a bonus or a
// penalty; a race slot only ever shows what it moved.
import { progressPct } from "../../../lib/trainingReport.js";
import { orderAbilities } from "../../../lib/trainingReceiptView.ts";
import type { TrainingActivity } from "../../../lib/trainingDailyReceipt.ts";

type Numbers = Record<string, number>;

export interface SourceRow {
  key: string;
  /** Percent of the way to the next point, per source. training + race === total. */
  training: number;
  race: number;
  total: number;
  /** Whole points landed on the date (0 when none). */
  whole: number;
}

export interface RaceSourceBreakdown {
  rows: SourceRow[];
  /** Columns to show: a rider with no race on the date only shows training, and the reverse. */
  showTraining: boolean;
  showRace: boolean;
  /** Unrounded sums over every ability, for the date's squad share. */
  trainingRaw: number;
  raceRaw: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isMap = (value: unknown): value is Numbers => value != null && typeof value === "object";
// Stored progress maps are sparse: an absent ability inside a stored snapshot is zero.
const progressValue = (snapshot: Numbers | null | undefined, ability: string) =>
  snapshot && !Object.hasOwn(snapshot, ability) ? 0 : snapshot?.[ability];

export const isRaceActivity = (activity: TrainingActivity) => activity.race_day === true;
const isSession = (activity: TrainingActivity) => !isRaceActivity(activity) && !activity.injured
  && activity.intensity !== "rest" && activity.status !== "unknown_pending";

function contribution(activity: TrainingActivity, ability: string): number | null {
  const before = progressValue(activity.progress_before, ability);
  const after = progressValue(activity.progress_after, ability);
  if (!finite(before) || !finite(after)) return null;
  const whole = activity.gains?.[ability];
  return (finite(whole) && whole > 0 ? whole : 0) + after - before;
}

/**
 * Per ability: progress from training slots, from race slots and in total.
 * Returns null when any slot lacks its own start or end point (older reports):
 * the split is then unknown and the report keeps its previous lists.
 */
export function raceSourceBreakdown(activities: TrainingActivity[] | null | undefined,
  dev: { gains?: Numbers | null }): RaceSourceBreakdown | null {
  const slots = activities ?? [];
  if (slots.length === 0 || slots.some(a => !isMap(a.progress_before) || !isMap(a.progress_after))) return null;
  const keys = orderAbilities(slots.flatMap(a => [
    ...Object.keys(a.progress_before ?? {}), ...Object.keys(a.progress_after ?? {}), ...Object.keys(a.gains ?? {}),
  ]));
  const rows: SourceRow[] = [];
  let trainingRaw = 0, raceRaw = 0;
  for (const key of keys) {
    let training = 0, race = 0;
    for (const activity of slots) {
      const moved = contribution(activity, key);
      if (moved == null) return null;
      if (isRaceActivity(activity)) race += moved; else training += moved;
    }
    // A source never shows less than nothing: the report has no penalty to tell.
    training = Math.max(0, training);
    race = Math.max(0, race);
    trainingRaw += training;
    raceRaw += race;
    const landed = dev.gains?.[key];
    const whole = finite(landed) && landed > 0 ? landed : 0;
    // The report's one rule: a point that has not landed never reads as 100 %.
    const total = whole > 0 ? Math.round((training + race) * 100) : progressPct(training + race);
    if (total <= 0 && whole <= 0) continue;
    const raceShown = Math.min(total, Math.round(race * 100));
    rows.push({ key, training: total - raceShown, race: raceShown, total, whole });
  }
  const showRace = slots.some(isRaceActivity);
  const showTraining = trainingRaw > 0 || slots.some(isSession) || !showRace;
  return { rows, showTraining, showRace, trainingRaw, raceRaw };
}

/**
 * The squad's share of the date's progress that came from races, in percent.
 * null when no shown rider raced on the date, when there was no progress, or
 * when any rider's split is unknown (a partial share would be wrong).
 */
export function dayRaceShare(breakdowns: Array<RaceSourceBreakdown | null>): number | null {
  if (breakdowns.length === 0 || breakdowns.some(b => b == null)) return null;
  const known = breakdowns as RaceSourceBreakdown[];
  if (!known.some(b => b.showRace)) return null;
  const race = known.reduce((sum, b) => sum + b.raceRaw, 0);
  const training = known.reduce((sum, b) => sum + b.trainingRaw, 0);
  if (race + training <= 0) return null;
  let share = Math.round(race / (race + training) * 100);
  // Neither source rounds away: some training never reads as "all from races".
  if (training > 0) share = Math.min(99, share);
  if (race > 0) share = Math.max(1, share);
  return share;
}
