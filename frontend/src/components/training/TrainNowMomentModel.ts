// #8363 (owner choice A, 19/11) · "Today's training": the Train now moment as its
// own view. Pure model: which riders, in which order, what each row shows, and how
// far each row has come at a point in the playback. The component only draws it.
//
// Data: the stored receipt for the press's date (the page refreshes it right after
// the press) plus the press's own answer (riders still waiting for their race). It
// never computes development; every number is the receipt's, the same numbers the
// Report tab shows (issue point 6).
//
// Shown only behind the XP switch (development_xp_model) AND when the date's
// receipt carries XP, exactly like the XP report (XpReportSwitch.xpReportMode).
// Switch off, or no XP in the payload: the page behaves as before the moment.
import { buildTodayView, hasXpFields, type XpReceipt, type XpRiderType, type XpTodayRider, type XpViewOptions } from "../../lib/trainingReportXp.ts";

/** The whole playback, whatever the team size: under the owner's six seconds. */
export const MOMENT_TOTAL_MS = 5200;
/** Share of the playback one row's bar takes to fill; the rows start staggered and overlap. */
export const MOMENT_ROW_SPAN = 0.34;

export const MOMENT_PREVIEW_PARAMS = ["xp", "xpreport"] as const;

/** Preview build only: `?xp=1` (or the XP report's own `?xpreport=on`) plays the moment on the invented fixture. */
export function previewMoment(isPreview: boolean, search: string): boolean {
  if (!isPreview) return false;
  const params = new URLSearchParams(search);
  return params.get("xp") === "1" || params.get("xp") === "on" || params.get("xpreport") === "on";
}

export type MomentMode = "off" | "live" | "fixture";

/** Live needs the switch on AND XP stored on the press's own date; a receipt from another date never plays. */
export function momentMode({ preview, flagOn, runs, date }: {
  preview: boolean; flagOn: boolean; runs: ReadonlyArray<XpReceipt> | null | undefined; date: string | null | undefined;
}): MomentMode {
  if (preview) return "fixture";
  if (!flagOn || !date) return "off";
  const run = (runs ?? []).find(r => r?.tick_date === date);
  return run && hasXpFields([run]) ? "live" : "off";
}

export type MomentTier = "low" | "mid" | "best";

export interface MomentGain { key: string; from: number | null; to: number | null; points: number }

export interface MomentRow {
  id: string;
  name: string;
  type: XpRiderType | null;
  age: number | null;
  /** The date's first training focus (a rider:training.focus_* key), or null. */
  focus: string | null;
  raced: boolean;
  /** Racing today and not trained yet: "settles after the stage", never "+0". */
  waiting: boolean;
  xp: number;
  points: number;
  gains: MomentGain[];
  tier: MomentTier;
  /** 0..1 of the day's best, the bar's full length. */
  share: number;
}

export interface MomentView {
  date: string;
  rows: MomentRow[];
  /** Riders who trained (waiting riders not counted). */
  riders: number;
  xp: number;
  points: number;
  bestId: string | null;
}

/**
 * Bar colour by the day's yield: the day's best is gold, at least half the best is
 * green, the rest dark. Relative to the day, so it reads the same for any team.
 */
export function xpTier(xp: number, best: number): MomentTier {
  if (!(best > 0) || !(xp > 0)) return "low";
  if (xp >= best) return "best";
  return xp * 2 >= best ? "mid" : "low";
}

const lastName = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;

/**
 * The team's fixed order (the training page's roster order, the same every day),
 * then riders the roster does not know by last name.
 */
export function orderRiders<T extends { id: string; name: string }>(rows: T[], order: ReadonlyArray<string>): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name);
  });
}

function focusOf(rider: XpTodayRider): string | null {
  return rider.sessions.find(s => s.kind === "training" && s.focus)?.focus ?? null;
}

export interface MomentRosterRider {
  id: string;
  name: string;
  age: number | null;
  type?: XpRiderType | null;
}

export function buildMomentView(runs: ReadonlyArray<XpReceipt>, date: string, {
  roster = [], waitingIds = [], options = {},
}: {
  roster?: ReadonlyArray<MomentRosterRider>;
  /** From the press's answer: riders whose training waits for today's race. */
  waitingIds?: ReadonlyArray<string>;
  options?: XpViewOptions;
} = {}): MomentView | null {
  const view = buildTodayView(runs, date, options);
  // buildTodayView falls back to the latest date; the moment only ever shows the press's own date.
  if (!view || view.date !== date) return null;
  const byId = new Map(roster.map(r => [r.id, r]));
  const waiting = new Set(waitingIds);
  const trainedRows = view.riders.map(r => ({ rider: r, waiting: waiting.has(r.id) && r.xp <= 0 }));
  const best = Math.max(0, ...trainedRows.filter(r => !r.waiting).map(r => r.rider.xp));
  const bestId = best > 0 ? trainedRows.find(r => !r.waiting && r.rider.xp === best)?.rider.id ?? null : null;
  const rows: MomentRow[] = trainedRows.map(({ rider, waiting: isWaiting }) => {
    const known = byId.get(rider.id);
    // One gold row per day: a tie with the best reads green.
    const tier: MomentTier = rider.id === bestId ? "best" : isWaiting ? "low"
      : xpTier(rider.xp, best) === "best" ? "mid" : xpTier(rider.xp, best);
    return {
      id: rider.id, name: rider.name, type: rider.type ?? known?.type ?? null, age: known?.age ?? null,
      focus: focusOf(rider), raced: rider.raced, waiting: isWaiting,
      xp: isWaiting ? 0 : rider.xp, points: isWaiting ? 0 : rider.points,
      gains: isWaiting ? [] : rider.abilities.filter(a => a.points > 0).map(a => ({ key: a.key, from: a.from, to: a.to, points: a.points })),
      tier,
      share: !isWaiting && best > 0 ? Math.min(1, rider.xp / best) : 0,
    };
  });
  // Racing riders the receipt does not carry yet still get their row, by name from the roster.
  const inReceipt = new Set(rows.map(r => r.id));
  for (const id of waiting) {
    const known = byId.get(id);
    if (inReceipt.has(id) || !known) continue;
    rows.push({ id, name: known.name, type: known.type ?? null, age: known.age, focus: null, raced: true, waiting: true,
      xp: 0, points: 0, gains: [], tier: "low", share: 0 });
  }
  const ordered = orderRiders(rows, roster.map(r => r.id));
  const trained = ordered.filter(r => !r.waiting);
  return {
    date: view.date,
    rows: ordered,
    riders: trained.length,
    xp: trained.reduce((sum, r) => sum + r.xp, 0),
    points: trained.reduce((sum, r) => sum + r.points, 0),
    bestId,
  };
}

/** From the press's answer: racing riders who did not train now (with instant on, racing riders train their free fields now). */
export function momentWaitingIds(result: { afterRaceRiderIds?: ReadonlyArray<string>; instantRiderIds?: ReadonlyArray<string> } | null | undefined): string[] {
  if (!result) return [];
  const trainedNow = new Set(result.instantRiderIds ?? []);
  return (result.afterRaceRiderIds ?? []).filter(id => !trainedNow.has(id));
}

/**
 * How far one row has come at playback time t (0..1). Rows start one after the
 * other in the fixed order but overlap, so any team size ends at t = 1.
 */
export function rowProgress(t: number, index: number, count: number, span = MOMENT_ROW_SPAN): number {
  if (!(count > 0)) return 1;
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped >= 1) return 1;
  const s = count === 1 ? 1 : Math.min(1, span);
  const step = count === 1 ? 0 : (1 - s) / (count - 1);
  const p = (clamped - index * step) / s;
  return Math.max(0, Math.min(1, p));
}

/** A soft finish for bar and count, so the numbers settle instead of stopping hard. */
export function easeOut(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return 1 - (1 - x) ** 3;
}

/** The count shown at progress p: whole XP, exact at the end. */
export function xpAt(xp: number, p: number): number {
  return p >= 1 ? Math.round(xp) : Math.round(xp * easeOut(p));
}
