// Balance-drift-vagt (#2414) — natlig kredibilitets-scorecard mod LIVE prod-resultater.
//
// 100% REN lib: intet I/O, ingen imports fra supabase/raceRunner — kun plain data
// ind/ud (samme kontrakt som raceDominanceMetrics.js/raceDryRunOracles.js). Bruges
// af balanceDriftWatch.js (I/O-adapter + cron-entrypoint) til at:
//   1. aggregere ÉN dags prod-observationer til det samme metrik-sæt som
//      simulateSeasonDryRun.js's DOMINANCE_TARGETS + evaluateIncidentBoundsOracle,
//   2. klassificere hver metrik grøn/gul/rød mod de KANONISKE kalibrerings-bånd
//      (kopieret 1:1 fra backend/scripts/simulateSeasonDryRun.js DOMINANCE_TARGETS
//      + backend/lib/raceDryRunOracles.js DEFAULT_INCIDENT_TARGETS — ÆNDRES DE DÉR,
//      skal de ændres her med samme begrundelse),
//   3. afgøre om et bånd-brud har stået på i 3+ på hinanden følgende dage (#2397:
//      deploy-støj-lærdommen — én enkelt dags udsving alarmerer ALDRIG).
//
// Enheder er bevidst BLANDEDE (matcher hvordan hver metrik allerede logges i
// simulateSeasonDryRun.js — vi opfinder ikke en ny konvention):
//   favoriteWinRate/favoritePodiumRate/share4PlusSameTeamTop10/maxRiderWinRate
//     = andel 0-1 (samme som aggregateObservations()/winRateStats()-output).
//   avgDistinctTeamsTop10 = optælling (7.5 = gennemsnit over dagens løb).
//   dnfRatePct/jourSansSharePct/breakawayWinSharePct = procent-tal 0-100 (samme
//     som aggregateIncidentObservations()/simulateSeasonDryRun.js's log-linjer).

import { aggregateObservations, aggregateIncidentObservations, winRateStats } from "./raceDominanceMetrics.js";

// ── Kanoniske bånd ───────────────────────────────────────────────────────────
// reportOnly:true ⇒ metrikken vises i tabellen/trenden, men deltager ALDRIG i
// rød-klassifikation eller 3-dages-alarmen. To metrikker er bevidst report-only:
//   - jourSansSharePct: simulateSeasonDryRun.js linje ~1260 logger den eksplicit
//     "bånd 2-5%, rapport-only" — aldrig håndhævet som hard gate i harnesset.
//   - breakawayWinSharePct: simulateSeasonDryRun.js's baseline-log (2026-07-11,
//     #2224 S0) fandt at bånd 1-7% EKSPLODERER i ægte population-mode (42-48%
//     escapee-sejre) fordi puljerne er langt mere evne-homogene end den
//     genererede 800-population — kendt, afventer #1021-refit. At gøre den til
//     en hard rød/alarm-metrik her ville skabe konstant falsk støj fra dag 1.
export const BALANCE_DRIFT_BANDS = Object.freeze({
  favoriteWinRate:         Object.freeze({ min: 0.25, max: 0.40 }),
  favoritePodiumRate:      Object.freeze({ min: 0.55, max: 0.75 }),
  share4PlusSameTeamTop10: Object.freeze({ max: 0.05 }),
  avgDistinctTeamsTop10:   Object.freeze({ min: 7.5 }),
  dnfRatePct:              Object.freeze({ min: 0.3, max: 1.5 }),
  maxRiderWinRate:         Object.freeze({ max: 0.45 }), // ≥5 starter i vinduet
  jourSansSharePct:        Object.freeze({ min: 2, max: 5, reportOnly: true }),
  breakawayWinSharePct:    Object.freeze({ min: 1, max: 7, reportOnly: true }),
});

// Metrikker der IKKE skal deltage i 3-dages-alarmen selv når de er "røde"
// (report-only — se begrundelse ovenfor).
export const ALARM_ELIGIBLE_METRICS = Object.freeze(
  Object.entries(BALANCE_DRIFT_BANDS)
    .filter(([, band]) => !band.reportOnly)
    .map(([key]) => key)
);

/**
 * Aggregér ÉN dags rå prod-observationer til scorecard-metrikkerne.
 *
 * @param {object} args
 * @param {Array<ReturnType<typeof import("./raceDominanceMetrics.js").observeRace>>} [args.observations]
 * @param {Array<ReturnType<typeof import("./raceDominanceMetrics.js").observeIncidents>>} [args.incidentObservations]
 * @param {Map<string, number>} [args.winsByRider]     rullende-vindue sejre pr. rytter (til maxRiderWinRate)
 * @param {Map<string, number>} [args.startsByRider]   rullende-vindue starter pr. rytter
 * @param {number} [args.jourSansHits]      antal rytter-etape-instanser med jour_sans<0 i dagens data
 * @param {number} [args.riderStageCount]   samlet rytter-etape-instanser i dagens data (nævner for jourSans)
 * @param {number} [args.breakawayWins]     antal etape-vindere der vandt fra udbrud (in_breakaway=true)
 * @param {number} [args.breakawayEligibleStages]  antal etape-instanser med et gyldigt udbrudsfelt (nævner)
 * @returns {Record<string, number|null> & {stageInstances:number, incidentStages:number}}
 */
export function computeDayMetrics({
  observations = [],
  incidentObservations = [],
  winsByRider = new Map(),
  startsByRider = new Map(),
  jourSansHits = 0,
  riderStageCount = 0,
  breakawayWins = 0,
  breakawayEligibleStages = 0,
} = {}) {
  const dom = aggregateObservations(observations);
  const inc = aggregateIncidentObservations(incidentObservations);
  const winStats = winRateStats({ winsByRider, startsByRider, minStarts: 5 });

  return {
    favoriteWinRate: dom.favoriteWinRate,
    favoritePodiumRate: dom.favoritePodiumRate,
    share4PlusSameTeamTop10: dom.share4PlusSameTeamTop10,
    avgDistinctTeamsTop10: dom.avgDistinctTeamsTop10,
    dnfRatePct: inc.meanDnfRatePct,
    maxRiderWinRate: winStats.maxWinRate,
    jourSansSharePct: riderStageCount > 0 ? (100 * jourSansHits) / riderStageCount : null,
    breakawayWinSharePct: breakawayEligibleStages > 0 ? (100 * breakawayWins) / breakawayEligibleStages : null,
    stageInstances: dom.races,
    incidentStages: inc.stages,
  };
}

/**
 * Klassificér ÉN metrik-værdi mod dens bånd.
 * "yellow" = uden for bånd, men inden for en margin på 15% af båndets bredde
 * (nærved-brud — endnu ikke et rødt brud). Bredden for et ensidet bånd (kun
 * min ELLER kun max) bruger selve grænseværdien som bredde-proxy (min/max ≠ 0),
 * så marginen skalerer fornuftigt uanset om båndet er "0.25-0.40" eller "≤0.05".
 *
 * @param {number|null|undefined} value
 * @param {{min?:number, max?:number, reportOnly?:boolean}} band
 * @returns {"n/a"|"info"|"green"|"yellow"|"red"}
 */
export function classifyMetric(value, band) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (band.reportOnly) return "info";

  const { min, max } = band;
  const width = (min != null && max != null) ? (max - min) : Math.abs((max ?? min) || 1);
  const margin = Math.max(width * 0.15, 1e-9);

  if (min != null && value < min) return value >= min - margin ? "yellow" : "red";
  if (max != null && value > max) return value <= max + margin ? "yellow" : "red";
  return "green";
}

/**
 * Klassificér en hel dags metrik-sæt mod BALANCE_DRIFT_BANDS.
 *
 * @param {Record<string, number|null>} metrics  computeDayMetrics()-output (eller en persisteret række)
 * @returns {Record<string, {value:number|null, band:object, status:string}>}
 */
export function classifyDay(metrics = {}) {
  const out = {};
  for (const [key, band] of Object.entries(BALANCE_DRIFT_BANDS)) {
    const value = metrics[key] ?? null;
    out[key] = { value, band, status: classifyMetric(value, band) };
  }
  return out;
}

/**
 * Kalenderdags-diff i heltalsdage (UTC), robust mod millisekund-støj.
 * @param {string} a  YYYY-MM-DD
 * @param {string} b  YYYY-MM-DD
 * @returns {number}
 */
function daysBetween(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

/**
 * Find metrikker med et bånd-brud (status "red") i ≥minConsecutiveDays på
 * hinanden følgende KALENDERDAGE, regnet bagud fra den seneste dag i `rows`.
 * Et hul i datoerne (manglende cron-kørsel en nat) nulstiller streaken — vi
 * gætter ALDRIG på et manglende tick. Kun ALARM_ELIGIBLE_METRICS (ikke
 * report-only) kan trigge en alarm (#2414 acceptkriterium: "uden falske
 * positiver ved enkeltdage" — udvidet her til også aldrig at alarmere på
 * kendte, endnu ukalibrerede report-only-bånd).
 *
 * @param {Array<{date:string, statuses:Record<string,{status:string}>}>} rows  ASCENDING efter date (ældst→nyest)
 * @param {{minConsecutiveDays?:number}} [opts]
 * @returns {Array<{metric:string, days:number, since:string}>}
 */
export function findConsecutiveBreaches(rows = [], { minConsecutiveDays = 3 } = {}) {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const breaches = [];
  for (const metric of ALARM_ELIGIBLE_METRICS) {
    let streak = 0;
    let streakStart = null;
    let prevDate = null;
    for (const row of sorted) {
      const status = row.statuses?.[metric]?.status;
      const isConsecutiveDay = prevDate == null || daysBetween(prevDate, row.date) === 1;
      if (status === "red" && isConsecutiveDay) {
        streak = isConsecutiveDay && prevDate != null && streak > 0 ? streak + 1 : 1;
        if (streak === 1) streakStart = row.date;
      } else if (status === "red" && !isConsecutiveDay) {
        // Hul i datoerne — streak starter forfra på denne dag.
        streak = 1;
        streakStart = row.date;
      } else {
        streak = 0;
        streakStart = null;
      }
      prevDate = row.date;
    }
    if (streak >= minConsecutiveDays) {
      breaches.push({ metric, days: streak, since: streakStart });
    }
  }
  return breaches;
}
