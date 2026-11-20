// #8476 · Under XP kan en dato faa hele point betalt fra bjaelken (bar_paid): XP rytteren
// havde gemt FOER datoen. De point er ikke dagens traening, saa "+N i dag", gennembrud og
// dagens historie taeller kun point tjent paa datoen = gains minus bar_paid. Hvordan
// bar_paid laeses (pr. slot, raekkens total som reserve, aldrig mere end de landede point)
// er samme regel som XP-rapporten (paidPoints i trainingReportXp.ts).
//
// Kun til brug naar XP-kontakten er taendt. Uden XP findes bar_paid ikke, og kalderne
// bruger de eksisterende funktioner (breakthroughJumps, todayGainTotal) uaendret.
import { paidPoints } from "./trainingReportXp.ts";
import { breakthroughJumps } from "./trainingReport.js";

type Numbers = Record<string, number>;
/** Rytterens kvitterings-raekke: baerer slottene (activities) og raekkens bar_paid. */
export interface EarnedRow {
  gains?: Numbers | null;
  bar_paid?: Numbers | null;
  activities?: ReadonlyArray<{ bar_paid?: Numbers | null }> | null;
}
/** Raekken der baerer gains (fx row.trained_now foer aftenafregningen). */
export interface EarnedView {
  gains?: Numbers | null;
  gains_detail?: Record<string, { from?: unknown; to?: unknown }> | null;
}
export interface EarnedJump { ability: string; n: number; from: number | null; to: number | null }

/** Hele point pr. evne tjent paa datoen; kun evner med mindst ét tjent point. */
export function earnedGains(row: EarnedRow | null | undefined, view: EarnedView | null | undefined = row): Numbers {
  const gains = view?.gains ?? {};
  const source = { gains, bar_paid: row?.bar_paid ?? null, activities: row?.activities ?? [] };
  const out: Numbers = {};
  for (const [ability, n] of Object.entries(gains)) {
    const total = Number(n);
    if (!Number.isFinite(total) || total <= 0) continue;
    const earned = total - paidPoints(source, ability);
    if (earned > 0) out[ability] = earned;
  }
  return out;
}

/** Summen af point tjent paa datoen (0 = intet tjent). */
export function earnedGainTotal(row: EarnedRow | null | undefined, view: EarnedView | null | undefined = row): number {
  return Object.values(earnedGains(row, view)).reduce((sum, n) => sum + n, 0);
}

/**
 * Gennembruds-spring som breakthroughJumps, men kun de tjente point. Bjaelkens point
 * udbetales ved datoens start, saa et spring "fra" flyttes op med de betalte point.
 */
export function earnedJumps(row: EarnedRow | null | undefined, view: EarnedView | null | undefined = row): EarnedJump[] {
  const earned = earnedGains(row, view);
  const jumps = breakthroughJumps(view) as EarnedJump[];
  return jumps
    .filter((jump) => earned[jump.ability] > 0)
    .map((jump) => {
      const paid = jump.n - earned[jump.ability];
      return { ...jump, n: earned[jump.ability], from: jump.from != null && paid > 0 ? jump.from + paid : jump.from };
    });
}
