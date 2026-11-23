// #7947 · The Development tab in XP (direction 5, sketch R5Development in PR #8248).
// Pure view model: it never computes development. It reads what the stored
// receipts carry (the same XP fields the XP report reads, lib/trainingReportXp.ts)
// plus the squad and the shared potential estimate, and lays it out as one line
// per rider. No React, so `node --test` runs it.
import { buildMonthView, buildTodayView, paidPoints, xpBySource, type XpReceipt, type XpRiderReceipt, type XpRiderType } from "../../lib/trainingReportXp.ts";
import { potentialViewOf, potentialViewValue, type PotentialView } from "../../lib/potentialEstimateDisplay.ts";
import { buildXpReportFixture, XP_FIXTURE_LAST_DATE } from "./reportXp/xpReportFixture.ts";
import { ABILITY_KEYS as ABILITY_KEYS_BASE } from "../../lib/generated/abilityRegistry.js";
import { riderBestRole as riderBestRoleBase } from "../../lib/riderRating.js";
import { seasonAbilityGains as seasonAbilityGainsBase } from "../../lib/trainingReport.js";

const ABILITY_KEYS = ABILITY_KEYS_BASE as unknown as readonly string[];
const riderBestRole = riderBestRoleBase as unknown as (rider: Record<string, unknown>) => { rating: number | null; role: string | null };
const seasonAbilityGains = seasonAbilityGainsBase as unknown as (runs: readonly XpReceipt[], riderId: string, since: string) => Record<string, number> | null;

/** "Close to the next point": three quarters of the bar or more (a display line, not a game rule). */
export const CLOSE_PCT = 75;
/** The opened row lists at most this many abilities, so it stays one glance. */
export const MAX_ABILITIES = 6;

/**
 * Expected top. `view` = the shared potential estimate (number + word, #7686).
 * `band` = today's field while that switch is off: lo and hi, shown as one number
 * when they are equal, never as an interval without width ("66-66").
 */
export type TopValue =
  | { kind: "view"; view: PotentialView; value: number | null }
  | { kind: "band"; lo: number; hi: number }
  // Akademiets intake-ryttere: estimates-endpointet sender kun academyPrognosis (api.js academyEstimate).
  | { kind: "academy"; prognosis: unknown }
  | { kind: "none" };

export type DevRiderInput = {
  id: string;
  name: string;
  /** First and last name when known, so the phone can show the short form ("A. Brandvig"). */
  firstname?: string | null; lastname?: string | null;
  nation: string | null;
  /** Natural role (riders.primary_type/secondary_type): born with it, locked for the career. */
  natural: XpRiderType | null;
  /** The role he rates highest in now, the same role as the rating beside it. */
  bestRole: string | null;
  rating: number | null;
  /** Age this season (ejer 19/11: aldrig mindre end den gamle Udvikling-fane). */
  age?: number | null;
  /** Ability values now, keyed like the receipts (climbing, flat, ...). */
  abilities: Record<string, number | null | undefined>;
  top: TopValue;
  racingToday: boolean;
};

/**
 * Ejer 20/11: the opened row reads like the rider's Training tab (#8488): "x / y XP"
 * toward the next point (`line`, null = no bar for that ability) and the day's XP on
 * the ability (`dayXp`, null = none that day). `pct` stays for the order only.
 */
export type DevAbility = { key: string; now: number | null; season: number | null; pct: number | null; line: XpLineView | null; dayXp: number | null };
/** "x / y XP" in whole numbers; `pct` (0..100) only fills the bar. */
export type XpLineView = { xp: number; price: number; pct: number };
/** Which day the per-ability XP is from: today, yesterday or an older date (the newest receipt, as on the Training tab). */
export type DayXpWhen = { kind: "today" } | { kind: "yesterday" } | { kind: "dated"; date: string };
/** Ejer 20/11: before the date is settled, a racing rider still shows the XP he has so far today (soFar). "locked" only when nothing is known yet. */
export type XpTodayCell = { state: "locked" } | { state: "none" } | { state: "xp"; xp: number; point: string | null; soFar?: true };

export type DevRow = {
  id: string; name: string; firstname: string | null; lastname: string | null; nation: string | null;
  natural: XpRiderType | null; bestRole: string | null;
  rating: number | null; age: number | null; top: TopValue;
  /** Ability points this season (the summary line and the opened row count these). */
  season: number | null;
  /** Ejer 19/11: the rating's change this season (now minus at season start); null = unknown. */
  ratingSeason: number | null;
  /** Ejer 20/11: the rating's change over the last 30 days (now minus 30 days ago); null = unknown, never a false zero. */
  rating30: number | null;
  today: XpTodayCell;
  spark: number[]; xp30: number;
  /** Fable 20/11: dates in the window where this rider's receipt carries XP; the divisor for XP per day. */
  xpDays: number;
  /** XP per day over the dates with XP; null = no date with XP yet (shown as a dash, never a diluted number). */
  xpPerDay: number | null;
  /** Ejer 19/11: the next point in XP ("x / y XP"); `pct` only sorts and counts "close". */
  next: { key: string; pct: number; xp: number; price: number } | null;
  abilities: DevAbility[];
  /** The day the abilities' "+N XP" is from; null = no receipt for this rider. */
  dayXpWhen: DayXpWhen | null;
};

/** `riderDays` = the rider-dates with XP in the window, the same divisor as each row's XP per day. `xpToday` null = no rider has today's row yet. */
export type DevSummary = { riders: number; days: number; riderDays: number; xpToday: number | null; unsettled: number; xp30: number; seasonPoints: number | null; close: number };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Share of the way to the next point in whole percent. Never 100: a full bar has paid out. */
export function barPct(bar: { xp?: number | null; price?: number | null } | null | undefined): number | null {
  if (!bar || !finite(bar.price) || bar.price <= 0) return null;
  const xp = finite(bar.xp) && bar.xp > 0 ? bar.xp : 0;
  return Math.max(0, Math.min(99, Math.floor((xp / bar.price) * 100)));
}

/** Expected top from one estimate (useScouting's payload). */
export function topOf(estimate: unknown): TopValue {
  const view = potentialViewOf(estimate as never);
  if (view) return { kind: "view", view, value: potentialViewValue(view) };
  const prog = (estimate as { prog?: { lo?: unknown; hi?: unknown } } | null | undefined)?.prog;
  if (prog && finite(prog.lo) && finite(prog.hi)) return { kind: "band", lo: Math.min(prog.lo, prog.hi), hi: Math.max(prog.lo, prog.hi) };
  const academy = (estimate as { academyPrognosis?: unknown } | null | undefined)?.academyPrognosis;
  if (academy) return { kind: "academy", prognosis: academy };
  return { kind: "none" };
}

/** The band as text: one number when lo equals hi (never "66-66"). */
export function bandText(top: { lo: number; hi: number }): string {
  return top.lo === top.hi ? String(top.hi) : `${top.lo}-${top.hi}`;
}

/** A number to sort expected top on: the estimate, or the band's top. */
export function topSortValue(top: TopValue): number | null {
  if (top.kind === "view") return top.value;
  if (top.kind === "band") return top.hi;
  return null;
}

/** Only the ability values, so the rating never falls back to a cached number. */
function abilitiesOnly(abilities: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(ABILITY_KEYS.map(key => [key, abilities[key]]));
}

/**
 * The rating's change this season, without new server data: the rating from the
 * abilities now minus the rating from the same abilities with this season's points
 * taken off (the same rating as everywhere else, best role now). Null when the
 * season has nothing to count yet or the rating cannot be read.
 */
export function seasonRatingChange(
  abilities: Record<string, unknown>,
  gains: Record<string, number> | null | undefined,
): number | null {
  if (!gains) return null;
  const now = abilitiesOnly(abilities);
  const start: Record<string, unknown> = { ...now };
  for (const [key, n] of Object.entries(gains)) {
    if (finite(n) && n > 0 && finite(start[key])) start[key] = (start[key] as number) - n;
  }
  const ratingNow = riderBestRole(now).rating;
  const ratingStart = riderBestRole(start).rating;
  return finite(ratingNow) && finite(ratingStart) ? ratingNow - ratingStart : null;
}

// --- XP lines (ejer 20/11, the same as the rider's Training tab in #8488) ----------
//
// #8488 adds the shared helpers (lib/xpAbilityLine.ts: xpLine, withXpLines,
// dayXpByAbility). They are not on main yet, so the same arithmetic lives here;
// fold these two into the shared helpers once both PRs are merged.

/** One bar as "x / y XP" in whole numbers, or null when it is not a usable { xp, price }. */
export function xpLineOf(bar: unknown): XpLineView | null {
  if (!bar || typeof bar !== "object") return null;
  const { xp, price } = bar as { xp?: unknown; price?: unknown };
  const x = Number(xp), p = Number(price);
  if (!Number.isFinite(x) || !Number.isFinite(p) || p <= 0 || x < 0) return null;
  const wholeXp = Math.round(x), wholePrice = Math.round(p);
  if (wholePrice <= 0) return null;
  // XP left over by the per-date rule stays on the bar, so xp can pass the price: the text says so, the fill stops at full.
  return { xp: wholeXp, price: wholePrice, pct: Math.min(100, Math.max(0, Math.floor((wholeXp / wholePrice) * 100))) };
}

/** The day's XP per ability from one receipt row's activities (training and races). */
export function dayXpByAbility(activities: ReadonlyArray<{ xp?: Record<string, unknown> | null }> | null | undefined): Record<string, number> | null {
  if (!Array.isArray(activities)) return null;
  const out: Record<string, number> = {};
  for (const a of activities) for (const [k, v] of Object.entries(a?.xp ?? {})) { const n = Number(v); if (Number.isFinite(n) && n > 0) out[k] = (out[k] ?? 0) + n; }
  return out;
}

// --- Rating, 30 days (ejer 20/11) ---------------------------------------------------

/** The date key `days` days before `key` (both YYYY-MM-DD, calendar days). */
export function dayKeyMinus(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * The points a rider gained over the last 30 days (today and the 29 days before), read
 * from the same receipts as the rest of the tab. Null = unknown: no receipt in the window,
 * or the rider has no row on the window's first receipt (he joined inside the window, so
 * what he gained before is not in these receipts). Never a false zero.
 * The sum itself is the season column's (seasonAbilityGains): Train now's confirmed points count
 * before the evening settlement, and a date still being reconciled (or pending without them) is unknown.
 */
export function gainsLast30(runs: readonly XpReceipt[], riderId: string, todayKey: string): Record<string, number> | null {
  const from = dayKeyMinus(todayKey, 29);
  const inWindow = runs.filter(run => run.tick_date >= from && run.tick_date <= todayKey);
  if (inWindow.length === 0) return null;
  const first = inWindow.reduce((a, b) => (b.tick_date < a ? b.tick_date : a), inWindow[0].tick_date);
  const firstRuns = inWindow.filter(run => run.tick_date === first);
  if (!firstRuns.some(run => run.report?.riders?.some(r => r.rider_id === riderId))) return null;
  return seasonAbilityGains(inWindow, riderId, from);
}

/** The rating change as text: '+3', '0', '-1', and a dash when unknown. */
export function signedText(value: number | null): string {
  if (value == null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

/** The newest stored bar per rider and ability (receipts may come newest first). */
function latestBars(runs: readonly XpReceipt[]): Map<string, Record<string, { xp: number; price: number }>> {
  const out = new Map<string, Record<string, { xp: number; price: number }>>();
  const oldestFirst = [...runs].sort((a, b) => a.tick_date.localeCompare(b.tick_date));
  for (const run of oldestFirst) {
    for (const row of run.report?.riders ?? []) {
      if (row.xp_bar && typeof row.xp_bar === "object" && Object.keys(row.xp_bar).length > 0) out.set(row.rider_id, row.xp_bar);
    }
  }
  return out;
}

/**
 * Train now before the evening settlement: the point that already landed sits on
 * `trained_now.gains`, while the row's `gains` stay empty until the date settles
 * (aggregateTrainingRuns). Same rule as the settled view: exactly one newly earned
 * point, a payout from saved XP is not one.
 */
function trainedNowPoint(raw: XpRiderReceipt | undefined): string | null {
  const gains = raw?.trained_now?.gains;
  if (!gains) return null;
  const earned = Object.keys(gains)
    .map((key): [string, number] => [key, (finite(gains[key]) && gains[key] > 0 ? gains[key] : 0) - paidPoints({ gains, bar_paid: raw.bar_paid, activities: raw.activities }, key)])
    .filter(([, n]) => n > 0);
  return earned.length === 1 && earned[0][1] === 1 ? earned[0][0] : null;
}

export type BuildInput = {
  runs: readonly XpReceipt[];
  riders: readonly DevRiderInput[];
  /** Today's date key (Copenhagen). */
  todayKey: string;
  /** Season points per rider and ability; null = the season has nothing to count yet. */
  seasonGains: Record<string, Record<string, number> | null | undefined>;
  /** Preview only: treat today's races as not yet settled. */
  forceUnsettled?: boolean;
};

export function buildDevelopmentRows({ runs, riders, todayKey, seasonGains, forceUnsettled = false }: BuildInput): DevRow[] {
  const todayRun = runs.find(run => run.tick_date === todayKey) ?? null;
  const settled = !forceUnsettled && todayRun?.receipt_status === "complete";
  const todayView = todayRun ? buildTodayView(runs, todayKey) : null;
  const todayById = new Map((todayView?.date === todayKey ? todayView.riders : []).map(r => [r.id, r]));
  const todayRowById = new Map((todayRun?.report?.riders ?? []).map(r => [r.rider_id, r]));
  const month = buildMonthView(runs);
  const monthById = new Map((month?.riders ?? []).map(r => [r.id, r]));
  const days = month?.days.length ?? 0;
  const bars = latestBars(runs);
  // Fable 20/11: XP per day divides by the dates that carry XP for the rider, not by every receipt date.
  // On XP's first evening the 29 older receipts have no XP fields; dividing by them shows ~1/30 of the truth.
  const windowDates = new Set((month?.days ?? []).map(d => d.date));
  const xpDatesById = new Map<string, Set<string>>();
  for (const run of runs) {
    if (!windowDates.has(run.tick_date)) continue;
    for (const row of run.report?.riders ?? []) {
      if (!row.activities?.some(a => a.xp != null && typeof a.xp === "object")) continue;
      const set = xpDatesById.get(row.rider_id) ?? new Set<string>();
      set.add(run.tick_date);
      xpDatesById.set(row.rider_id, set);
    }
  }
  // The abilities' "+N XP" comes from the newest receipt, as on the Training tab (#5539, #8488):
  // today once today has a receipt, otherwise the latest day, labelled with its date.
  const newestRun = runs.reduce<XpReceipt | null>((a, b) => (!a || b.tick_date > a.tick_date ? b : a), null);
  const newestRowById = new Map((newestRun?.report?.riders ?? []).map(r => [r.rider_id, r]));
  const dayXpWhen: DayXpWhen | null = !newestRun ? null
    : newestRun.tick_date === todayKey ? { kind: "today" }
    : newestRun.tick_date === dayKeyMinus(todayKey, 1) ? { kind: "yesterday" }
    : { kind: "dated", date: newestRun.tick_date };

  return riders.map((rider): DevRow => {
    const m = monthById.get(rider.id);
    const gains = seasonGains[rider.id];
    const season = gains ? Object.values(gains).reduce((sum, n) => sum + (finite(n) && n > 0 ? n : 0), 0) : null;

    let today: XpTodayCell;
    const hasRow = Boolean(todayRun && todayRowById.has(rider.id));
    const pendingRace = Boolean(rider.racingToday && !settled);
    if (!hasRow) today = pendingRace ? { state: "locked" } : { state: "none" }; // no row = unknown, never a measured zero
    else {
      const view = todayById.get(rider.id);
      const raw = todayRowById.get(rider.id);
      const xp = view?.xp ?? Object.values(xpBySource(raw?.activities)).reduce((s, v) => s + v.training + v.race, 0);
      today = pendingRace
        ? { state: "xp", xp, point: view?.pointAbility ?? trainedNowPoint(raw), soFar: true }
        : { state: "xp", xp, point: view?.pointAbility ?? trainedNowPoint(raw) };
    }

    const bar = bars.get(rider.id) ?? {};
    const newestRow = newestRowById.get(rider.id);
    const dayXp = newestRow ? dayXpByAbility(newestRow.activities) : null;
    const keys = new Set<string>([...Object.keys(bar), ...Object.entries(gains ?? {}).filter(([, n]) => finite(n) && n > 0).map(([k]) => k)]);
    const abilities = [...keys].map((key): DevAbility => ({
      key,
      now: finite(rider.abilities[key]) ? (rider.abilities[key] as number) : null,
      season: gains ? (finite(gains[key]) && gains[key]! > 0 ? gains[key]! : 0) : null,
      pct: barPct(bar[key]),
      line: xpLineOf(bar[key]),
      dayXp: dayXp && finite(dayXp[key]) && dayXp[key] > 0 ? Math.round(dayXp[key]) : null,
    })).sort((a, b) => (b.season ?? 0) - (a.season ?? 0) || (b.pct ?? -1) - (a.pct ?? -1) || a.key.localeCompare(b.key))
      .slice(0, MAX_ABILITIES);

    const nextKey = m?.next?.key ?? null;
    const nextPct = m?.next ? barPct(m.next) : null;
    const nextLine = m?.next ? xpLineOf(m.next) : null;
    return {
      id: rider.id, name: rider.name, firstname: rider.firstname ?? null, lastname: rider.lastname ?? null, nation: rider.nation,
      natural: rider.natural, bestRole: rider.bestRole,
      rating: rider.rating, age: rider.age ?? null, top: rider.top, season,
      ratingSeason: seasonRatingChange(rider.abilities, gains),
      rating30: seasonRatingChange(rider.abilities, gainsLast30(runs, rider.id, todayKey)),
      today,
      spark: m?.spark ?? Array.from({ length: days }, () => 0),
      xp30: m?.xp ?? 0,
      xpDays: xpDatesById.get(rider.id)?.size ?? 0,
      xpPerDay: (xpDatesById.get(rider.id)?.size ?? 0) > 0 ? Math.round((m?.xp ?? 0) / xpDatesById.get(rider.id)!.size) : null,
      next: nextKey && nextPct != null && nextLine ? { key: nextKey, pct: nextPct, xp: nextLine.xp, price: nextLine.price } : null,
      abilities,
      dayXpWhen: newestRow ? dayXpWhen : null,
    };
  });
}

export function devSummary(rows: readonly DevRow[]): DevSummary {
  const seasons = rows.map(r => r.season).filter(finite);
  return {
    riders: rows.length,
    days: rows[0]?.spark.length ?? 0,
    riderDays: rows.reduce((a, r) => a + r.xpDays, 0),
    // Fable 20/11: before today's training no rider has a row; a dash, not a measured 0.
    xpToday: rows.some(r => r.today.state === "xp") ? rows.reduce((a, r) => a + (r.today.state === "xp" ? r.today.xp : 0), 0) : null,
    unsettled: rows.filter(r => r.today.state === "locked" || (r.today.state === "xp" && r.today.soFar)).length,
    xp30: rows.reduce((a, r) => a + r.xp30, 0),
    seasonPoints: seasons.length ? seasons.reduce((a, b) => a + b, 0) : null,
    close: rows.filter(r => (r.next?.pct ?? 0) >= CLOSE_PCT).length,
  };
}

export type SortKey = "rider" | "natural" | "role" | "age" | "rating" | "top" | "season" | "rating30" | "xpToday" | "xp30" | "next";
export type SortState = { key: SortKey; dir: 1 | -1 };
export const DEFAULT_SORT: SortState = { key: "xp30", dir: -1 };

/** Text columns sort A-Z first; numbers sort highest first. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 };
  return { key, dir: key === "rider" || key === "natural" || key === "role" ? 1 : -1 };
}

function sortValue(row: DevRow, key: SortKey): string | number | null {
  switch (key) {
    case "rider": return row.name;
    case "natural": return row.natural?.primary ?? null;
    case "role": return row.bestRole;
    case "age": return row.age;
    case "rating": return row.rating;
    case "top": return topSortValue(row.top);
    case "season": return row.ratingSeason;
    case "rating30": return row.rating30;
    case "xpToday": return row.today.state === "xp" ? row.today.xp : null;
    case "xp30": return row.xpPerDay;
    case "next": return row.next?.pct ?? null;
  }
}

/** Sorted copy. Missing values always go last, whatever the direction; ties keep name order. */
export function sortDevRows(rows: readonly DevRow[], sort: SortState): DevRow[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : va - vb;
    return c * sort.dir || a.name.localeCompare(b.name);
  });
}

// --- The two type columns (ejer 20/11) -------------------------------------------
//
// The type is shown in both forms, and the manager picks with the table's column
// button: "Natural type" (the gold badge, as in the other tables) is shown by
// default, "Role now" (the grey tag, the role he rates highest in now) is hidden.
// The choice is remembered in the browser, the same way as the other tables' columns.
// Ejer 20/11: "Rating, 30 d" (the rating's change over the last 30 days) is a third
// optional column, hidden by default.
export type DevColumnKey = "natural" | "role" | "rating30";
export const DEV_COLUMNS: readonly { key: DevColumnKey; defaultVisible: boolean }[] = [
  { key: "natural", defaultVisible: true },
  { key: "role", defaultVisible: false },
  { key: "rating30", defaultVisible: false },
];
export const DEV_COLUMNS_STORAGE_KEY = "cz-training-development-xp-columns";

/**
 * #7947 (owner 23/11): the natural type on one line, never two types stacked in one cell.
 * The table cell shows `primary`; `secondary` is the second type when it is a different
 * one (read out for screen readers and shown in the fold-out). null = no natural type.
 */
export function naturalTypeLine(natural: XpRiderType | null | undefined): { primary: string; secondary: string | null } | null {
  if (!natural?.primary) return null;
  const secondary = natural.secondary && natural.secondary !== natural.primary ? natural.secondary : null;
  return { primary: natural.primary, secondary };
}

export function defaultDevColumns(): Set<DevColumnKey> {
  return new Set(DEV_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
}

/** The stored choice (a JSON list of shown columns); anything unreadable falls back to the default. */
export function parseDevColumns(raw: string | null | undefined): Set<DevColumnKey> {
  if (!raw) return defaultDevColumns();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultDevColumns();
    const known = new Set<string>(DEV_COLUMNS.map(c => c.key));
    return new Set(parsed.filter((k): k is DevColumnKey => typeof k === "string" && known.has(k)));
  } catch {
    return defaultDevColumns();
  }
}

export function serializeDevColumns(visible: ReadonlySet<DevColumnKey>): string {
  return JSON.stringify(DEV_COLUMNS.map(c => c.key).filter(k => visible.has(k)));
}

export function toggleDevColumn(visible: ReadonlySet<DevColumnKey>, key: DevColumnKey): Set<DevColumnKey> {
  const next = new Set(visible);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/** Hiding the column the table is sorted on falls back to the default sort. */
export function sortAfterColumns(sort: SortState, visible: ReadonlySet<DevColumnKey>): SortState {
  return (sort.key === "natural" || sort.key === "role" || sort.key === "rating30") && !visible.has(sort.key) ? DEFAULT_SORT : sort;
}

// --- Which surface the tab shows -------------------------------------------------
//
//   off      (default) today's Development tab, exactly as before.
//   live     the XP switch (development_xp_model) reads as on for this viewer AND the
//            stored receipts carry XP (the same gate as the XP report, #7627).
//   fixture  preview build only (VITE_PREVIEW_MOCK) with ?xp=1: invented riders.
export const XP_DEV_FLAG_KEY = "development_xp_model";
export const XP_DEV_PREVIEW_PARAM = "xp";
export type XpDevMode = "off" | "live" | "fixture";

export function previewXpDevelopment(isPreview: boolean, search: string): boolean {
  if (!isPreview) return false;
  const value = new URLSearchParams(search).get(XP_DEV_PREVIEW_PARAM);
  return value === "1" || value === "on";
}

export function xpDevelopmentMode({ preview, flagOn, hasXp }: { preview: boolean; flagOn: boolean; hasXp: boolean }): XpDevMode {
  if (preview) return "fixture";
  return flagOn && hasXp ? "live" : "off";
}

// --- PREVIEW FIXTURE, NOT GAME DATA ---------------------------------------------
//
// The XP report's invented receipts (reportXp/xpReportFixture.ts) plus invented
// ratings, abilities and estimates, so the owner can see the tab on the preview
// build before XP is switched on. No number here is a measurement or a balance
// number, and none of it is the model's.
export const DEV_FIXTURE_TODAY = XP_FIXTURE_LAST_DATE;
const CERTAINTY_WORDS = ["unsure", "fair", "sure"] as const;

function fixtureHash(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const between = (n: number, lo: number, hi: number) => Math.round(lo + n * (hi - lo));

export function buildDevelopmentFixture(): { runs: XpReceipt[]; riders: DevRiderInput[]; seasonGains: Record<string, Record<string, number>> } {
  const fx = buildXpReportFixture();
  // The report's invented bars can run several points past the price; a stored bar has paid
  // those out, so the tab's preview keeps only what is left toward the next point ("x / y XP").
  for (const run of fx.receipts) {
    for (const row of run.report.riders) {
      for (const bar of Object.values(row.xp_bar ?? {})) if (finite(bar?.xp) && finite(bar?.price) && bar.price > 0 && bar.xp >= bar.price) bar.xp %= bar.price;
    }
  }
  const latest = fx.receipts.find(r => r.tick_date === DEV_FIXTURE_TODAY) ?? fx.receipts[0];
  const seasonGains: Record<string, Record<string, number>> = {};
  for (const run of fx.receipts) {
    for (const row of run.report.riders) {
      const out = (seasonGains[row.rider_id] ??= {});
      for (const [key, n] of Object.entries(row.gains ?? {})) if (finite(n) && n > 0) out[key] = (out[key] ?? 0) + n;
    }
  }
  const riders = (latest?.report.riders ?? []).map((row, index): DevRiderInput => {
    const id = row.rider_id;
    const base = between(fixtureHash(id, "rating"), 61, 76);
    // Every ability, so the rating and the role are read the same way as on the live tab.
    const abilities = Object.fromEntries(ABILITY_KEYS.map(key => [key, between(fixtureHash(id, key, "now"), base - 12, base + 6)]));
    const best = riderBestRole(abilities);
    const rating = best.rating ?? base;
    const certainty = CERTAINTY_WORDS[index % CERTAINTY_WORDS.length];
    return {
      id, name: row.name || id, nation: fx.nations[id] ?? null,
      natural: fx.types[id] ?? null,
      bestRole: best.role,
      rating, abilities,
      age: between(fixtureHash(id, "age"), 20, 33),
      top: { kind: "view", value: rating + between(fixtureHash(id, "top"), 2, 9),
        view: { hidden: false, value: rating + between(fixtureHash(id, "top"), 2, 9), certainty, previousValue: null, previousCertainty: null, changedAt: null } },
      racingToday: row.activities?.some(a => a.race_day === true) ?? false,
    };
  });
  return { runs: fx.receipts, riders, seasonGains };
}
