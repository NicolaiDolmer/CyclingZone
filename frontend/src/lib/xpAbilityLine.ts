// #7947 · An ability line in XP ("312 / 540 XP" with a bar) when XP is switched on.
//
// Owner's choice 19/11 (A): the next point is shown as x of y XP. The server sends
// `xp_bar` on /api/training/me ({ [rider_id]: { [ability]: { xp, price } } }, whole
// numbers) only when development_xp_model is on for today; without it the field is
// missing and every surface keeps today's percent line unchanged. Under XP there is
// no ceiling, so a line never reads "done" (the server also sends capped = {}).
//
// Pure view model, no React: the three surfaces (the training page's Development and
// Today tabs, the rider profile's Training tab) all draw AbilityReceiptRow, so the rows
// from trainingReport.js get one extra field here and the row draws XP instead of %.

export interface XpBar { xp: number; price: number }
export interface XpLine { xp: number; price: number; pct: number }
export type XpBarsByAbility = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

/** One ability's bar, or null when it is missing or not a usable { xp, price }. */
export function xpLine(bar: unknown): XpLine | null {
  if (!isRecord(bar)) return null;
  const xp = Number(bar.xp);
  const price = Number(bar.price);
  if (!Number.isFinite(xp) || !Number.isFinite(price) || price <= 0 || xp < 0) return null;
  const wholeXp = Math.round(xp);
  const wholePrice = Math.round(price);
  if (wholePrice <= 0) return null;
  // XP left over by the per-date rule stays on the bar, so xp can pass the price:
  // the text says so honestly, and the fill simply stops at full.
  const pct = Math.min(100, Math.max(0, Math.floor((wholeXp / wholePrice) * 100)));
  return { xp: wholeXp, price: wholePrice, pct };
}

/**
 * The rider's bars from /api/training/me's `xp_bar`, or null when XP is off for the
 * viewer (field missing or not an object). An XP payload without this rider gives {}
 * (XP is on; the rider simply has no bar yet), never null.
 */
export function riderXpBars(xpBar: unknown, riderId: string | null | undefined): XpBarsByAbility | null {
  if (!isRecord(xpBar)) return null;
  const bars = riderId != null ? xpBar[riderId] : null;
  return isRecord(bars) ? bars : {};
}

/**
 * Puts the XP line on receipt rows. `bars` null = XP off: the same array comes back
 * untouched, so today's view cannot change. With bars every row gets `xpLine`
 * (null = no bar for that ability, shown as a dash) and is never locked.
 */
type ReceiptLike = { ability: string; locked?: boolean; pct?: number | null };
type WithXp<T> = Array<T & { xpLine?: XpLine | null; xpDay?: number | null }>;
/** XP pr. evne paa kvitteringsdagen (traening + loeb), eller null for evner uden XP. */
export type XpDayByAbility = Record<string, number> | null | undefined;
export function withXpLines<T extends ReceiptLike>(rows: T[], bars: XpBarsByAbility | null | undefined, dayXp?: XpDayByAbility): WithXp<T>;
export function withXpLines<T extends ReceiptLike>(rows: T[] | null, bars: XpBarsByAbility | null | undefined, dayXp?: XpDayByAbility): WithXp<T> | null;
export function withXpLines<T extends ReceiptLike>(rows: T[] | null | undefined, bars: XpBarsByAbility | null | undefined, dayXp?: XpDayByAbility): WithXp<T> | null | undefined;
export function withXpLines<T extends ReceiptLike>(
  rows: T[] | null | undefined,
  bars: XpBarsByAbility | null | undefined,
  dayXp?: XpDayByAbility,
): WithXp<T> | null | undefined {
  if (!bars || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const line = xpLine(bars[row.ability]);
    // Ejer/spiller 19/11: dagens XP pr. evne ("i dag +54 XP") som i dag-kolonnen i procent-visningen.
    const day = Number(dayXp?.[row.ability]);
    return { ...row, locked: false, pct: line ? line.pct : null, xpLine: line, xpDay: Number.isFinite(day) && day > 0 ? Math.round(day) : null };
  });
}

/** Dagens XP pr. evne fra rytterens kvitteringsraekke (aktiviteternes `xp`, traening + loeb). */
export function dayXpByAbility(activities: ReadonlyArray<{ xp?: Record<string, unknown> | null }> | null | undefined): Record<string, number> | null {
  if (!Array.isArray(activities)) return null;
  const out: Record<string, number> = {};
  for (const a of activities) for (const [k, v] of Object.entries(a?.xp ?? {})) { const n = Number(v); if (Number.isFinite(n) && n > 0) out[k] = (out[k] ?? 0) + n; }
  return out;
}
