// #7947 retning 5, fanerne Udvikling og Rapport: den rene model bag skitsen.
// Ingen React, saa node --test kan koere den. Alle tal kommer fra r5devdata.ts
// og er eksempler; intet her er motorens regel.

import { DEV, POINTS_30, REPORT, RACE_SHARE, devXp30, reportXp, type DevRow, type ReportRow } from "./r5devdata.ts";

/** Tal skrevet paa den ene rigtige maade (TASTE P13, EN): 12,399. */
export const num = (n: number): string => n.toLocaleString("en-US");

export type DevSummary = { riders: number; xpToday: number; unsettled: number; xp30: number; seasonPoints: number; close: number };

/** Holdets udvikling som tal til oversigtslinjen. "Close" = tre fjerdedele af vejen eller mere. */
export function devSummary(rows: readonly DevRow[] = DEV): DevSummary {
  return {
    riders: rows.length,
    xpToday: rows.reduce((a, r) => a + (r.xpToday ?? 0), 0),
    unsettled: rows.filter((r) => r.xpToday === null).length,
    xp30: rows.reduce((a, r) => a + devXp30(r), 0),
    seasonPoints: rows.reduce((a, r) => a + r.season, 0),
    close: rows.filter((r) => r.next.pct >= 75).length,
  };
}

export type ReportSummary = { xp: number; points: number; fromBar: number; raceShare: number };

/** Dagens rapport: XP, evnepoint, hvor mange der blev betalt fra bjaelken, og loebets andel af XP (heltal i procent). */
export function reportSummary(rows: readonly ReportRow[] = REPORT): ReportSummary {
  const xp = rows.reduce((a, r) => a + reportXp(r), 0);
  const race = rows.reduce((a, r) => a + r.race, 0);
  return {
    xp,
    points: rows.reduce((a, r) => a + r.points.length, 0),
    fromBar: rows.reduce((a, r) => a + r.points.filter((p) => p.fromBar).length, 0),
    raceShare: xp === 0 ? 0 : Math.round((race / xp) * 100),
  };
}

export type Summary30 = { xp: number; points: number; fromBar: number; raceShare: number };

/** 30-dages-visningens oversigt. Loebets andel vaegtes med hver rytters XP. */
export function summary30(rows: readonly DevRow[] = DEV): Summary30 {
  const xp = rows.reduce((a, r) => a + devXp30(r), 0);
  const race = rows.reduce((a, r) => a + devXp30(r) * (RACE_SHARE[r.id] ?? 0), 0);
  return {
    xp,
    points: rows.reduce((a, r) => a + (POINTS_30[r.id]?.points ?? 0), 0),
    fromBar: rows.reduce((a, r) => a + (POINTS_30[r.id]?.fromBar ?? 0), 0),
    raceShare: xp === 0 ? 0 : Math.round(race / xp),
  };
}

/** Et pas kan aldrig vaere optjent i dag og betalt fra bjaelken samtidigt. */
export const earnedPoints = (r: ReportRow): number => r.points.filter((p) => !p.fromBar).length;

/** 30-dages-visningen: loebets andel pr. rytter (procent). */
export const raceShare30 = (id: string): number => RACE_SHARE[id] ?? 0;
