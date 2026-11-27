// #7627 · The training report in XP (spec 2026-11-06 §5.1, Å2: today and the last
// 30 days). Pure view model: it never computes development, it only reads what
// the stored receipts carry and splits it by the kind of slot (training or race),
// the same split PR #8205 makes for percent.
//
// ═══ DATA CONTRACT ═══════════════════════════════════════════════════════════
// Two fields this model reads are NOT delivered by the backend today. They are
// the proposed shape for the XP switch (development_xp_model, off) and are only
// ever filled by the preview fixture until the backend writes them:
//   1. activity.xp            XP earned per ability on that slot. The engine has it
//                              (developmentXpTick's `xp`) but does not write it to
//                              training_rider_ticks.report.
//   2. receipt row.xp_bar     "x of y XP" per ability after the date: the bar in XP
//                              and the price of the next point. Only the server can
//                              send it (xpBarView needs the private params).
//   3. slot row.bar_paid      Whole points per ability PAID OUT FROM THE BAR: points
//                              the XP saved before the date already covered at the
//                              date's start (XP left on the bar by the per-date rule,
//                              or the stored progress on the switch-on night). PER
//                              SLOT: the server writes it only on the slot row where
//                              the payout lands (often the date's first), never a
//                              date total repeated on every slot; the report sums
//                              the slots. A value on the aggregated row is read only
//                              when no slot carries one. Points land this way on a
//                              rest day too, and after a change of focus, without any
//                              XP earned that day. The rest of the date's points were
//                              earned by the date's own XP. Only the server knows the
//                              bar at the date's start, so it writes this; the client
//                              never guesses it. Missing = 0 (nothing paid out).
// Without 1 `hasXpFields` is false and the page keeps today's report.
//
// "Earned today" is the date's own XP (1). "Paid out from the bar" is (3). The two
// are always shown apart, per rider and in total (Fable verdict on PR #8276, point 5).
import { raceDevelopmentBeforeTraining, type DailyRiderReceipt, type DailyTrainingReceipt, type TrainingActivity } from "./trainingDailyReceipt.ts";
import { orderAbilities } from "./trainingReceiptView.ts";
import { ratingChange, type RatingChange, type RosterAbilities } from "./xpRatingChange.ts";

type Numbers = Record<string, number>;
export interface XpBar { xp: number; price: number }
/** PROPOSED (not in the payload today): XP per ability on one slot. */
export type XpActivity = TrainingActivity & { xp?: Numbers | null; bar_paid?: Numbers | null };
/** PROPOSED (not in the payload today): the bar in XP after the date, per ability. */
export type XpRiderReceipt = DailyRiderReceipt & {
  xp_bar?: Record<string, XpBar> | null;
  /** PROPOSED (not in the payload today): whole points paid out from the bar on the date. */
  bar_paid?: Numbers | null;
  activities: XpActivity[];
};
export type XpReceipt = Omit<DailyTrainingReceipt, "report"> & { report: { riders: XpRiderReceipt[]; condition_settled: boolean } };

export type SessionKind = "training" | "race" | "rest" | "injured" | "unknown";
export interface XpSession { kind: SessionKind; focus: string | null; score: number | null; gameDay: number | null }
export interface XpAbilityRow {
  key: string;
  xp: number; training: number; race: number;
  /** Whole points landed on the date (0 = none): earned + paid. */
  points: number;
  /** Of those, earned by the date's own XP. */
  earned: number;
  /** Of those, paid out from XP saved before the date. */
  paid: number;
  from: number | null; to: number | null;
  bar: XpBar | null;
  /** Shares of the next point's price, 0..1: XP from before today, today's training, today's races. */
  segments: { before: number; training: number; race: number } | null;
}
export interface XpTodayRider {
  id: string; name: string; nation: string | null; type: XpRiderType | null;
  raced: boolean;
  xp: number; training: number; race: number;
  points: number;
  /** Points earned by today's XP, and points paid out from the bar. */
  earned: number; paid: number;
  /** One ability when exactly one whole point was earned today, else null. */
  pointAbility: string | null;
  /** One ability when exactly one whole point was paid out from the bar, else null. */
  paidAbility: string | null;
  form: number | null; formBefore: number | null;
  fatigue: number | null; fatigueBefore: number | null;
  sessions: XpSession[];
  abilities: XpAbilityRow[];
  sessionScore: number | null;
  /** #7947: best-role rating before > after the date's points; null = unchanged or no data. */
  rating?: RatingChange | null;
}
export interface XpDay { date: string; training: number; race: number; points: number; earned: number; paid: number; status: DailyTrainingReceipt["receipt_status"] }
export type TodayFilter = "all" | "gained" | "raced" | "notRaced";
export interface XpTodayView {
  date: string; status: DailyTrainingReceipt["receipt_status"];
  previous: string | null; next: string | null;
  strip: XpDay[];
  /** Dates before the strip's first day, still inside the 30-day window: what "Show older days" would add. */
  olderDays: number;
  xp: number; xp30: number; training: number; race: number; points: number; pointRiders: number;
  earned: number; paid: number; earnedRiders: number; paidRiders: number;
  racePercent: number | null;
  raceBeforeTraining: boolean;
  counts: Record<TodayFilter, number>;
  riders: XpTodayRider[];
}
export interface XpMonthRider {
  id: string; name: string; nation: string | null; type: XpRiderType | null;
  spark: number[];
  xp: number; points: number; earned: number; paid: number;
  form: number | null; fatigue: number | null;
  next: { key: string; xp: number; price: number } | null;
}
export type MonthFilter = "all" | "closest" | "tired";
export interface XpMonthView {
  days: XpDay[];
  xp: number; points: number; earned: number; paid: number; racePercent: number | null;
  tired: number;
  riders: XpMonthRider[];
}
export interface XpRiderType { primary: string | null; secondary: string | null }
export interface XpViewOptions {
  /** rider id -> ISO 3166 alpha-2 code; the receipt does not carry nationality. */
  nations?: Record<string, string | null | undefined>;
  /** rider id -> natural type (riders.primary_type/secondary_type); its own column. */
  types?: Record<string, XpRiderType | null | undefined>;
  /** The session score already shown on the training page, per slot. */
  scoreOf?: (riderId: string, date: string, activity: TrainingActivity, seasonId: string | null) => number | null;
  /** #7947: rider id -> the roster row with abilities flattened, for the rating change. */
  abilities?: Record<string, RosterAbilities | null | undefined>;
}

/** The display boundary the fatigue colour already uses (ConditionChips.fatigueColor). */
export const TIRED_FATIGUE = 40;
export const MONTH_DAYS = 30;
export const STRIP_DAYS = 7;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): number => (finite(n) && n > 0 ? n : 0);
const isRace = (a: TrainingActivity) => a.race_day === true;

/** True when at least one stored slot carries XP; otherwise the old report stays. */
export function hasXpFields(runs: ReadonlyArray<{ report?: { riders?: ReadonlyArray<{ activities?: ReadonlyArray<XpActivity> }> } | null }> | null | undefined): boolean {
  return (runs ?? []).some(run => run.report?.riders?.some(row => row.activities?.some(a => a.xp != null && typeof a.xp === "object")) ?? false);
}

/** Per ability: XP from training slots and from race slots. */
export function xpBySource(activities: ReadonlyArray<XpActivity> | null | undefined): Record<string, { training: number; race: number }> {
  const out: Record<string, { training: number; race: number }> = {};
  for (const activity of activities ?? []) {
    for (const [key, value] of Object.entries(activity.xp ?? {})) {
      const xp = positive(value);
      if (!xp) continue;
      const row = out[key] ?? { training: 0, race: 0 };
      if (isRace(activity)) row.race += xp; else row.training += xp;
      out[key] = row;
    }
  }
  return out;
}

/**
 * Share from races in percent, or null when nothing was earned or nothing came from
 * a race. Neither source rounds away (the rule PR #8205 uses for its percent).
 */
export function raceShare(training: number, race: number): number | null {
  if (!(race > 0) || !(training + race > 0)) return null;
  let share = Math.round(race / (training + race) * 100);
  if (training > 0) share = Math.min(99, share);
  return Math.max(1, share);
}

/**
 * Where the bar stands, as shares of the next point's price. Saved XP is spent
 * first, so what is left on the bar is today's XP up to today's amount, and older
 * XP beyond that. On a rest day (no XP today) a point paid out from the bar
 * leaves only older XP, never a "today" part.
 */
export function barSegments(bar: XpBar | null | undefined, training: number, race: number) {
  if (!bar || !finite(bar.price) || bar.price <= 0) return null;
  const now = Math.min(positive(bar.xp), bar.price);
  const today = training + race;
  const fromToday = Math.min(now, today);
  const before = now - fromToday;
  const raceShown = today > 0 ? fromToday * (race / today) : 0;
  return { before: before / bar.price, training: (fromToday - raceShown) / bar.price, race: raceShown / bar.price };
}

function sessionOf(activity: TrainingActivity, score: number | null): XpSession {
  const kind: SessionKind = activity.status === "unknown_pending" ? "unknown"
    : activity.injured ? "injured"
    : isRace(activity) ? "race"
    : activity.intensity === "rest" ? "rest" : "training";
  return { kind, focus: kind === "training" ? (activity.focus ?? null) : null, score: kind === "training" || kind === "race" ? score : null,
    gameDay: finite(activity.game_day) ? activity.game_day : null };
}

/** One receipt per date (the newest season first, as aggregateTrainingRuns sorts). */
function byDate(runs: ReadonlyArray<XpReceipt>): Map<string, XpReceipt> {
  const out = new Map<string, XpReceipt>();
  for (const run of runs) if (!out.has(run.tick_date)) out.set(run.tick_date, run);
  return out;
}

/** Points paid out from the bar for one ability: never more than the points that landed. */
export function paidPoints(row: Pick<XpRiderReceipt, "gains" | "bar_paid"> & { activities?: ReadonlyArray<{ bar_paid?: Numbers | null }> }, key: string): number {
  // The server writes bar_paid on the slot where the payout happens (often the
  // date's first). aggregateTrainingRuns keeps every raw slot in `activities` but
  // copies only the last slot onto the row, so the slots are summed when they
  // carry the field; a row-level date total is the fallback.
  const slots = (row.activities ?? []).filter(a => a?.bar_paid && typeof a.bar_paid === "object");
  const paid = slots.length > 0
    ? slots.reduce((sum, a) => sum + positive(a.bar_paid?.[key]), 0)
    : positive(row.bar_paid?.[key]);
  return Math.min(Math.floor(paid), positive(row.gains?.[key]));
}

function riderTotals(row: XpRiderReceipt) {
  let training = 0, race = 0;
  for (const value of Object.values(xpBySource(row.activities))) { training += value.training; race += value.race; }
  let points = 0, paid = 0;
  for (const [key, n] of Object.entries(row.gains ?? {})) { points += positive(n); paid += paidPoints(row, key); }
  return { training, race, points, paid, earned: points - paid };
}

/** XP and new points per date, oldest first. */
export function xpDays(runs: ReadonlyArray<XpReceipt>): XpDay[] {
  return [...byDate(runs).values()].map(run => {
    let training = 0, race = 0, points = 0, paid = 0;
    for (const row of run.report.riders) {
      const totals = riderTotals(row);
      training += totals.training; race += totals.race; points += totals.points; paid += totals.paid;
    }
    return { date: run.tick_date, training, race, points, earned: points - paid, paid, status: run.receipt_status };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** The seven-day strip: the latest seven dates, or the seven ending at an older pick. */
export function stripWindow<T>(days: T[], index: number, size = STRIP_DAYS): T[] {
  if (days.length <= size) return days;
  const end = index >= days.length - size ? days.length : index + 1;
  return days.slice(Math.max(0, end - size), end);
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The ability when exactly one whole point (of this kind) landed, else null. */
function single(entries: Array<[string, number]>): string | null {
  const hit = entries.filter(([, n]) => n > 0);
  return hit.length === 1 && hit[0][1] === 1 ? hit[0][0] : null;
}

export function buildTodayView(runs: ReadonlyArray<XpReceipt>, date: string | null, options: XpViewOptions = {}, showAllDays = false): XpTodayView | null {
  const days = xpDays(runs);
  if (days.length === 0) return null;
  // A picked date that is no longer in the receipts (e.g. after a refetch) falls back to the latest day.
  const found = date ? days.findIndex(d => d.date === date) : -1;
  const index = found >= 0 ? found : days.length - 1;
  const day = days[index] ?? days.at(-1)!;
  const run = byDate(runs).get(day.date)!;
  const month = days.slice(-MONTH_DAYS);
  // "Show older days" widens the strip to the whole window; otherwise the seven-day strip.
  const strip = showAllDays ? month : stripWindow(days, index);
  const olderDays = days.findIndex(d => d.date === strip[0]?.date);
  const riders: XpTodayRider[] = run.report.riders.map(row => {
    const sources = xpBySource(row.activities);
    const totals = riderTotals(row);
    const gained = Object.entries(row.gains ?? {}).filter(([, n]) => positive(n) > 0);
    const keys = orderAbilities([...Object.keys(sources), ...gained.map(([k]) => k)]);
    const abilities = keys.map((key): XpAbilityRow => {
      const source = sources[key] ?? { training: 0, race: 0 };
      const points = positive(row.gains?.[key]);
      const paid = paidPoints(row, key);
      const jump = row.gains_detail?.[key];
      const bar = row.xp_bar?.[key] ?? null;
      return { key, xp: source.training + source.race, training: source.training, race: source.race, points,
        earned: points - paid, paid,
        from: jump && finite(jump.from) ? jump.from : null, to: jump && finite(jump.to) ? jump.to : null,
        bar, segments: barSegments(bar, source.training, source.race) };
    }).sort((a, b) => Number(b.points > 0) - Number(a.points > 0));
    const scores = row.activities.map(a => options.scoreOf?.(row.rider_id, day.date, a, run.season_id ?? null) ?? null);
    const sessionScores = scores.filter((s): s is number => s != null);
    return {
      id: row.rider_id, name: row.name || row.rider_id, nation: options.nations?.[row.rider_id] ?? null,
      type: options.types?.[row.rider_id] ?? null,
      raced: row.activities.some(isRace),
      xp: totals.training + totals.race, training: totals.training, race: totals.race, points: totals.points,
      earned: totals.earned, paid: totals.paid,
      pointAbility: single(abilities.map(a => [a.key, a.earned])),
      paidAbility: single(abilities.map(a => [a.key, a.paid])),
      form: finite(row.form) ? row.form : null, formBefore: row.form_before,
      fatigue: finite(row.fatigue) ? row.fatigue : null, fatigueBefore: row.fatigue_before,
      sessions: row.activities.map((a, i) => sessionOf(a, scores[i])),
      abilities,
      sessionScore: sessionScores.length ? Math.round(sessionScores.reduce((s, n) => s + n, 0) / sessionScores.length) : null,
      // #7947: the roster is the rider now, so only the newest date has a rating change.
      rating: index === days.length - 1 ? ratingChange(options.abilities?.[row.rider_id], row.gains_detail) : null,
    };
  }).sort((a, b) => b.points - a.points || b.xp - a.xp || byName(a, b));
  return {
    date: day.date, status: day.status,
    previous: days[index - 1]?.date ?? null, next: days[index + 1]?.date ?? null,
    strip, olderDays: Math.max(0, olderDays),
    xp: day.training + day.race,
    training: day.training, race: day.race,
    xp30: month.reduce((sum, d) => sum + d.training + d.race, 0),
    points: day.points, pointRiders: riders.filter(r => r.points > 0).length,
    earned: day.earned, paid: day.paid, earnedRiders: riders.filter(r => r.earned > 0).length, paidRiders: riders.filter(r => r.paid > 0).length,
    racePercent: raceShare(day.training, day.race),
    raceBeforeTraining: raceDevelopmentBeforeTraining(run),
    counts: {
      all: riders.length,
      gained: riders.filter(r => r.points > 0).length,
      raced: riders.filter(r => r.raced).length,
      notRaced: riders.filter(r => !r.raced).length,
    },
    riders,
  };
}

export function filterTodayRiders(riders: XpTodayRider[], filter: TodayFilter): XpTodayRider[] {
  if (filter === "gained") return riders.filter(r => r.points > 0);
  if (filter === "raced") return riders.filter(r => r.raced);
  if (filter === "notRaced") return riders.filter(r => !r.raced);
  return riders;
}

export function buildMonthView(runs: ReadonlyArray<XpReceipt>, options: XpViewOptions = {}): XpMonthView | null {
  const days = xpDays(runs).slice(-MONTH_DAYS);
  if (days.length === 0) return null;
  const receipts = byDate(runs);
  const riders = new Map<string, XpMonthRider>();
  days.forEach((day, index) => {
    for (const row of receipts.get(day.date)!.report.riders) {
      const rider = riders.get(row.rider_id) ?? {
        id: row.rider_id, name: row.name || row.rider_id, nation: options.nations?.[row.rider_id] ?? null,
        type: options.types?.[row.rider_id] ?? null,
        spark: days.map(() => 0), xp: 0, points: 0, earned: 0, paid: 0, form: null, fatigue: null, next: null,
      };
      const totals = riderTotals(row);
      rider.spark[index] = totals.training + totals.race;
      rider.xp += totals.training + totals.race;
      rider.points += totals.points;
      rider.earned += totals.earned;
      rider.paid += totals.paid;
      // Days are oldest first, so the last receipt a rider appears on is "now".
      rider.form = finite(row.form) ? row.form : rider.form;
      rider.fatigue = finite(row.fatigue) ? row.fatigue : rider.fatigue;
      const bars = Object.entries(row.xp_bar ?? {}).filter(([, b]) => finite(b?.price) && b.price > 0);
      if (bars.length) {
        // The ability closest to its next point. No days-to-go estimate: that would
        // read the rider's talent off the bar (spec §5.2, gate H6b).
        const [key, bar] = bars.reduce((best, cur) => positive(cur[1].xp) / cur[1].price > positive(best[1].xp) / best[1].price ? cur : best);
        rider.next = { key, xp: positive(bar.xp), price: bar.price };
      }
      riders.set(row.rider_id, rider);
    }
  });
  const list = [...riders.values()].sort((a, b) => b.xp - a.xp || byName(a, b));
  const training = days.reduce((s, d) => s + d.training, 0);
  const race = days.reduce((s, d) => s + d.race, 0);
  return {
    days, xp: training + race, points: days.reduce((s, d) => s + d.points, 0),
    earned: days.reduce((s, d) => s + d.earned, 0), paid: days.reduce((s, d) => s + d.paid, 0),
    racePercent: raceShare(training, race),
    tired: list.filter(r => finite(r.fatigue) && r.fatigue >= TIRED_FATIGUE).length,
    riders: list,
  };
}

const closeness = (r: XpMonthRider) => (r.next ? r.next.xp / r.next.price : -1);
export function filterMonthRiders(riders: XpMonthRider[], filter: MonthFilter): XpMonthRider[] {
  if (filter === "closest") return [...riders].sort((a, b) => closeness(b) - closeness(a) || byName(a, b));
  if (filter === "tired") return riders.filter(r => finite(r.fatigue) && r.fatigue >= TIRED_FATIGUE);
  return riders;
}

/** "x of y XP": x never rounds up to a point that has not landed. */
export function xpOfPrice(bar: { xp: number; price: number }): { xp: number; price: number } {
  const price = Math.round(bar.price);
  return { xp: Math.min(Math.floor(positive(bar.xp)), Math.max(0, price - 1)), price };
}
