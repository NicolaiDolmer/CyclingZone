// backend/lib/engine/v4/mechanics/breakawayInterest7160Measure.ts
// #7160: maalefunktionen til kalibreringen af "favoritholdene lader ufarlige udbrud gaa paa bjerg".
//
// Udbrudssejre paa bjergetaper (mountain + high_mountain) pr. loebsgruppe (Grand Tour, etapeloeb)
// og afslutning (topankomst = finale long_climb, ellers uden), for EN revision, fra testportens
// loebsresultater (samme form som motorTestportReport.aggregateRaceGroups: `rr.stages`,
// `rr.runs[revision].perSeed[].rows[]` med profile_type, finale_type og breakawayWon). Hver
// (etape, seed) taeller én gang; tidskoersler og raekker uden breakawayWon taelles ikke.
//
// Kalibreringen sker BAGEFTER i testporten med prod-startlister (DolmerPC): testportens frosne
// felt kan ikke bruges (udbruddet vinder alt der). Baandet mod virkeligheden (Touren og Giroen
// 2023-2024) er et balance-tal og staar KUN i den private taerskelfil (hard rule 17):
//   mountainBreakawayWinShareByGroup: { gt|stage_race: { summit?|non_summit?|total?: { min?, max? } } }
// Mangler et baand eller en maaling, er dommen "-" (aldrig en gaettet graense).
//
// REN: ingen IO. Ikke koblet paa kortet endnu (motorTestportReport.mjs ejes af et andet spor).

export const MOUNTAIN_7160_PROFILES: readonly string[] = Object.freeze(["mountain", "high_mountain"]);
export const MOUNTAIN_7160_RACE_GROUPS = Object.freeze(["gt", "stage_race"] as const);
export type Mountain7160RaceGroup = (typeof MOUNTAIN_7160_RACE_GROUPS)[number];
export const MOUNTAIN_7160_FINISHES = Object.freeze(["summit", "non_summit"] as const);
export type Mountain7160Finish = (typeof MOUNTAIN_7160_FINISHES)[number];

export type Mountain7160Row = { profile_type?: string | null; finale_type?: string | null; breakawayWon?: boolean | null };
export type Mountain7160RaceResult = {
  stages?: number | null;
  runs?: Record<string, { perSeed?: ReadonlyArray<{ rows?: ReadonlyArray<Mountain7160Row> }> } | undefined>;
};
export type Mountain7160Band = { min?: number; max?: number };
export type Mountain7160Thresholds = {
  mountainBreakawayWinShareByGroup?: Partial<Record<Mountain7160RaceGroup, Partial<Record<Mountain7160Finish | "total", Mountain7160Band>>>>;
};
export type Mountain7160Cell = { n: number; breakawayWins: number; breakawayWinShare: number | null; verdict: "PASS" | "FAIL" | "-" };
export type Mountain7160Measurement = Record<Mountain7160RaceGroup, Record<Mountain7160Finish | "total", Mountain7160Cell>>;

/** Loebsgruppe ud fra antal etaper (samme inddeling som breakawayIntent.raceGroupOf); endagsloeb = null. */
export function mountain7160RaceGroup(stages: unknown): Mountain7160RaceGroup | null {
  const n = Number(stages) || 1;
  if (n <= 1) return null;
  return n >= 15 ? "gt" : "stage_race";
}

/** Topankomst (long_climb) eller ej; null naar etapen ikke er en bjergetape. */
export function mountain7160Finish(row: Mountain7160Row): Mountain7160Finish | null {
  if (!MOUNTAIN_7160_PROFILES.includes(String(row?.profile_type ?? ""))) return null;
  return row.finale_type === "long_climb" ? "summit" : "non_summit";
}

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** PASS/FAIL for en andel mod et privat {min,max}; "-" uden baand eller maaling. */
export function mountain7160Verdict(value: number | null, band: Mountain7160Band | undefined): "PASS" | "FAIL" | "-" {
  if (value === null || !Number.isFinite(value)) return "-";
  const min = finite(band?.min);
  const max = finite(band?.max);
  if (min === undefined && max === undefined) return "-";
  return (min === undefined || value >= min) && (max === undefined || value <= max) ? "PASS" : "FAIL";
}

/** #7160: udbrudssejre paa bjergetaper pr. loebsgruppe x afslutning (og samlet) for `revision`. */
export function measureMountainBreakawayWins(
  raceResults: ReadonlyArray<Mountain7160RaceResult>,
  revision: string,
  thresholds: Mountain7160Thresholds = {},
): Mountain7160Measurement {
  const counts = Object.fromEntries(MOUNTAIN_7160_RACE_GROUPS.map((g) => [g, { summit: { n: 0, w: 0 }, non_summit: { n: 0, w: 0 } }])) as Record<Mountain7160RaceGroup, Record<Mountain7160Finish, { n: number; w: number }>>;
  for (const rr of raceResults ?? []) {
    const g = mountain7160RaceGroup(rr?.stages);
    const run = rr?.runs?.[revision];
    if (!g || !run) continue;
    for (const s of run.perSeed ?? []) {
      for (const row of s.rows ?? []) {
        const f = mountain7160Finish(row);
        if (!f || typeof row.breakawayWon !== "boolean") continue;
        counts[g][f].n += 1;
        if (row.breakawayWon) counts[g][f].w += 1;
      }
    }
  }
  const bands = thresholds?.mountainBreakawayWinShareByGroup ?? {};
  const cell = (n: number, w: number, band: Mountain7160Band | undefined): Mountain7160Cell => {
    const share = n > 0 ? w / n : null;
    return { n, breakawayWins: w, breakawayWinShare: share, verdict: mountain7160Verdict(share, band) };
  };
  const out = {} as Mountain7160Measurement;
  for (const g of MOUNTAIN_7160_RACE_GROUPS) {
    const c = counts[g];
    out[g] = {
      summit: cell(c.summit.n, c.summit.w, bands[g]?.summit),
      non_summit: cell(c.non_summit.n, c.non_summit.w, bands[g]?.non_summit),
      total: cell(c.summit.n + c.non_summit.n, c.summit.w + c.non_summit.w, bands[g]?.total),
    };
  }
  return out;
}
