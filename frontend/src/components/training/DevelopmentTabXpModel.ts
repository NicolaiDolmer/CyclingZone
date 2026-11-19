// #7947 · The Development tab in XP (direction 5, sketch R5Development in PR #8248).
// Pure view model: it never computes development. It reads what the stored
// receipts carry (the same XP fields the XP report reads, lib/trainingReportXp.ts)
// plus the squad and the shared potential estimate, and lays it out as one line
// per rider. No React, so `node --test` runs it.
import { buildMonthView, buildTodayView, xpBySource, type XpReceipt, type XpRiderType } from "../../lib/trainingReportXp.ts";
import { potentialViewOf, potentialViewValue, type PotentialView } from "../../lib/potentialEstimateDisplay.ts";
import { buildXpReportFixture, XP_FIXTURE_LAST_DATE } from "./reportXp/xpReportFixture.ts";
import { ABILITY_KEYS as ABILITY_KEYS_BASE } from "../../lib/generated/abilityRegistry.js";
import { riderBestRole as riderBestRoleBase } from "../../lib/riderRating.js";

const ABILITY_KEYS = ABILITY_KEYS_BASE as unknown as readonly string[];
const riderBestRole = riderBestRoleBase as unknown as (rider: Record<string, unknown>) => { rating: number | null; role: string | null };

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
  type: XpRiderType | null;
  rating: number | null;
  /** Age this season (ejer 19/11: aldrig mindre end den gamle Udvikling-fane). */
  age?: number | null;
  /** Ability values now, keyed like the receipts (climbing, flat, ...). */
  abilities: Record<string, number | null | undefined>;
  top: TopValue;
  racingToday: boolean;
};

export type DevAbility = { key: string; now: number | null; season: number | null; pct: number | null };
export type XpTodayCell = { state: "locked" } | { state: "none" } | { state: "xp"; xp: number; point: string | null };

export type DevRow = {
  id: string; name: string; firstname: string | null; lastname: string | null; nation: string | null; type: XpRiderType | null;
  rating: number | null; age: number | null; top: TopValue;
  /** Ability points this season (the summary line and the opened row count these). */
  season: number | null;
  /** Ejer 19/11: the rating's change this season (now minus at season start); null = unknown. */
  ratingSeason: number | null;
  today: XpTodayCell;
  spark: number[]; xp30: number;
  next: { key: string; pct: number } | null;
  abilities: DevAbility[];
};

/** `days` = the dates with a receipt in the window (at most 30), the same divisor as each row's XP per day. */
export type DevSummary = { riders: number; days: number; xpToday: number; unsettled: number; xp30: number; seasonPoints: number | null; close: number };

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

  return riders.map((rider): DevRow => {
    const m = monthById.get(rider.id);
    const gains = seasonGains[rider.id];
    const season = gains ? Object.values(gains).reduce((sum, n) => sum + (finite(n) && n > 0 ? n : 0), 0) : null;

    let today: XpTodayCell;
    if (rider.racingToday && !settled) today = { state: "locked" };
    else if (!todayRun || !todayRowById.has(rider.id)) today = { state: "none" }; // no row = unknown, never a measured zero
    else {
      const view = todayById.get(rider.id);
      const raw = todayRowById.get(rider.id);
      const xp = view?.xp ?? Object.values(xpBySource(raw?.activities)).reduce((s, v) => s + v.training + v.race, 0);
      today = { state: "xp", xp, point: view?.pointAbility ?? null };
    }

    const bar = bars.get(rider.id) ?? {};
    const keys = new Set<string>([...Object.keys(bar), ...Object.entries(gains ?? {}).filter(([, n]) => finite(n) && n > 0).map(([k]) => k)]);
    const abilities = [...keys].map((key): DevAbility => ({
      key,
      now: finite(rider.abilities[key]) ? (rider.abilities[key] as number) : null,
      season: gains ? (finite(gains[key]) && gains[key]! > 0 ? gains[key]! : 0) : null,
      pct: barPct(bar[key]),
    })).sort((a, b) => (b.season ?? 0) - (a.season ?? 0) || (b.pct ?? -1) - (a.pct ?? -1) || a.key.localeCompare(b.key))
      .slice(0, MAX_ABILITIES);

    const nextKey = m?.next?.key ?? null;
    const nextPct = m?.next ? barPct(m.next) : null;
    return {
      id: rider.id, name: rider.name, firstname: rider.firstname ?? null, lastname: rider.lastname ?? null, nation: rider.nation, type: rider.type,
      rating: rider.rating, age: rider.age ?? null, top: rider.top, season,
      ratingSeason: seasonRatingChange(rider.abilities, gains), today,
      spark: m?.spark ?? Array.from({ length: days }, () => 0),
      xp30: m?.xp ?? 0,
      next: nextKey && nextPct != null ? { key: nextKey, pct: nextPct } : null,
      abilities,
    };
  });
}

export function devSummary(rows: readonly DevRow[]): DevSummary {
  const seasons = rows.map(r => r.season).filter(finite);
  return {
    riders: rows.length,
    days: rows[0]?.spark.length ?? 0,
    xpToday: rows.reduce((a, r) => a + (r.today.state === "xp" ? r.today.xp : 0), 0),
    unsettled: rows.filter(r => r.today.state === "locked").length,
    xp30: rows.reduce((a, r) => a + r.xp30, 0),
    seasonPoints: seasons.length ? seasons.reduce((a, b) => a + b, 0) : null,
    close: rows.filter(r => (r.next?.pct ?? 0) >= CLOSE_PCT).length,
  };
}

export type SortKey = "rider" | "type" | "age" | "rating" | "top" | "season" | "xpToday" | "xp30" | "next";
export type SortState = { key: SortKey; dir: 1 | -1 };
export const DEFAULT_SORT: SortState = { key: "xp30", dir: -1 };

/** Text columns sort A-Z first; numbers sort highest first. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 };
  return { key, dir: key === "rider" || key === "type" ? 1 : -1 };
}

function sortValue(row: DevRow, key: SortKey): string | number | null {
  switch (key) {
    case "rider": return row.name;
    case "type": return row.type?.primary ?? null;
    case "age": return row.age;
    case "rating": return row.rating;
    case "top": return topSortValue(row.top);
    case "season": return row.ratingSeason;
    case "xpToday": return row.today.state === "xp" ? row.today.xp : null;
    case "xp30": return row.xp30;
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
      // Ejer 19/11: the role he is best in now, not the natural one.
      type: best.role ? { primary: best.role, secondary: null } as XpRiderType : fx.types[id] ?? null,
      rating, abilities,
      age: between(fixtureHash(id, "age"), 20, 33),
      top: { kind: "view", value: rating + between(fixtureHash(id, "top"), 2, 9),
        view: { hidden: false, value: rating + between(fixtureHash(id, "top"), 2, 9), certainty, previousValue: null, previousCertainty: null, changedAt: null } },
      racingToday: row.activities?.some(a => a.race_day === true) ?? false,
    };
  });
  return { runs: fx.receipts, riders, seasonGains };
}
