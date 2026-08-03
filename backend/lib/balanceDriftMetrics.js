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

// ── #2731: robuste estimatorer (DEFAULT OFF — flip kræver ejer-go) ───────────
//
// Auditen 2026-08-03 (docs/audits/2026-08-03-race-balance-2731.md) viste at de
// tre "røde" metrikker ikke måler motor-dominans, men SAMPLING-STØJ:
//
//   maxRiderWinRate = max(wins/starts) over 2.100-4.100 ryttere med ≥5 starter.
//   Et maksimum over tusindvis af brøker med nævner 5-7 ER højt uanset motor.
//   Out-of-sample-test mod prod: ryttere der målte ≥0,45 i ét 14-dages vindue
//   leverede 0,065 i det NÆSTE — nøjagtig samme niveau som ryttere der målte
//   0,25-0,45. Metrikken har ~nul persistens ⇒ den måler ikke dominans.
//
//   favoriteWinRate/favoritePodiumRate/share4PlusSameTeamTop10 klassificeres på
//   ÉN kalenderdags 31-51 etaper. SE ved p=0,6 og n=41 er 0,077 — båndet
//   0,55-0,75 brydes rutinemæssigt af ren støj. Poolet over 824 etaper
//   (16/7-2/8) er favoriteWinRate 0,269 og favoritePodiumRate 0,579 — BEGGE
//   grønne. Bånd-bruddene findes kun i dags-linsen.
//
// De kanoniske BÅND ændres IKKE her — kun ESTIMATOREN der måles mod dem:
//   1. maxRiderWinRate → Wilson 95 % NEDRE grænse ("kan vi bevise at nogen
//      vinder over 45 %?"). Mod prod 16/7-2/8 giver den 0,191-0,409 (aldrig
//      rød), mens en ægte dominator (12 sejre af 17 starter) giver 0,469 → rød.
//   2. De tre dags-rater → poolet over POOL_WINDOW_DAYS persisterede dage
//      (n≈290-343 etaper i stedet for 31-51).
//
// Flag OFF ⇒ bit-identisk med den nuværende vagt.
function envFlag(name, fallback) {
  const raw = process.env?.[name];
  if (raw == null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
function envNum(name, fallback) {
  const raw = process.env?.[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const BALANCE_DRIFT_TUNING = Object.freeze({
  ROBUST_ESTIMATORS: envFlag("BALANCE_DRIFT_ROBUST_ESTIMATORS", false),
  WILSON_Z: envNum("BALANCE_DRIFT_WILSON_Z", 1.96),
  POOL_WINDOW_DAYS: envNum("BALANCE_DRIFT_POOL_WINDOW_DAYS", 7),
});

// Metrikker der klassificeres på et POOLET vindue når robust-mode er ON.
export const POOLED_RATE_METRICS = Object.freeze([
  "favoriteWinRate",
  "favoritePodiumRate",
  "share4PlusSameTeamTop10",
]);

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
 * Wilson score-interval, NEDRE grænse (én metrik-værdi, ikke et bånd).
 *
 * Svarer på "hvad er den laveste sande sejrsrate der er forenelig med
 * wins/starts ved konfidensniveau z?" — modsat den rå brøk, som ved nævner 5-7
 * er en ekstremværdi-magnet. Wilson (ikke Wald) fordi Wald bryder sammen ved
 * små n og ved p nær 0/1, som er præcis det regime metrikken lever i.
 *
 * @param {number} wins
 * @param {number} starts
 * @param {number} [z]  z-score (1,96 = 95 % ensidet-nedre-agtig dækning)
 * @returns {number|null} null hvis starts ≤ 0
 */
export function wilsonLowerBound(wins, starts, z = BALANCE_DRIFT_TUNING.WILSON_Z) {
  const n = Number(starts);
  const w = Number(wins);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w)) return null;
  const z2 = z * z;
  const denom = n + z2;
  const centre = (w + z2 / 2) / denom;
  const spread = (z / denom) * Math.sqrt((w * (n - w)) / n + z2 / 4);
  return Math.max(0, centre - spread);
}

/**
 * Største Wilson-nedre-grænse over alle ryttere med ≥minStarts starter.
 *
 * Læses som: "den højeste sejrsrate vi kan BEVISE at nogen rytter ligger over".
 * Samme bånd (≤0,45) som den rå maxRiderWinRate — kun estimatoren er skiftet.
 *
 * @param {object} args
 * @param {Map<string, number>} args.winsByRider
 * @param {Map<string, number>} args.startsByRider
 * @param {number} [args.minStarts]
 * @param {number} [args.z]
 * @returns {{maxLowerBound:number|null, riders:number, leader:{riderId:string, wins:number, starts:number}|null}}
 */
export function maxRiderWinRateLowerBound({
  winsByRider = new Map(),
  startsByRider = new Map(),
  minStarts = 5,
  z = BALANCE_DRIFT_TUNING.WILSON_Z,
} = {}) {
  let best = null;
  let leader = null;
  let riders = 0;
  for (const [riderId, starts] of startsByRider.entries()) {
    if (starts < minStarts) continue;
    riders++;
    const wins = winsByRider.get(riderId) || 0;
    const lb = wilsonLowerBound(wins, starts, z);
    if (lb == null) continue;
    if (best == null || lb > best) {
      best = lb;
      leader = { riderId, wins, starts };
    }
  }
  return { maxLowerBound: best, riders, leader };
}

/**
 * Fold rå `race_results`-rækker til (wins, starts) pr. rytter.
 *
 * #2731-FÆLDEN: `rider_id` kan være NULL på auto-fill-/phantom-rækker — 17.071
 * af 66.408 rækker (25,7 %) med 106 etapesejre i 14-dages-vinduet 20/7-2/8.
 * En bar `map.set(row.rider_id, …)` samler dem ALLE under nøglen `null` og
 * behandler dem som ÉN rytter med tusindvis af starter. `observeRace()` har
 * allerede det tilsvarende værn for `team_id` ("null-ryttere må ALDRIG klumpes
 * sammen som ét fælles nulhold"); denne sti manglede det.
 *
 * En række uden rytter-identitet kan ikke bære en per-rytter-sejrsrate, så den
 * EKSKLUDERES (ikke bucketes under en fælles nøgle, ikke tildeles en syntetisk
 * id — begge dele ville opfinde data).
 *
 * @param {Array<{rider_id:string|null, rank:number}>} rows
 * @returns {{winsByRider:Map<string,number>, startsByRider:Map<string,number>, skippedNullRiderRows:number}}
 */
export function foldRiderWindowRows(rows = []) {
  const winsByRider = new Map();
  const startsByRider = new Map();
  let skippedNullRiderRows = 0;

  for (const row of rows) {
    const riderId = row?.rider_id;
    if (riderId == null || riderId === "") {
      skippedNullRiderRows++;
      continue;
    }
    startsByRider.set(riderId, (startsByRider.get(riderId) || 0) + 1);
    if (row.rank === 1) winsByRider.set(riderId, (winsByRider.get(riderId) || 0) + 1);
  }

  return { winsByRider, startsByRider, skippedNullRiderRows };
}

/**
 * Pool en dags-rate over de seneste `windowDays` PERSISTEREDE rækker.
 *
 * Rekonstruerer tællere fra (rate × stageInstances) — rækkerne gemmer rater, ikke
 * counts — og returnerer sum(tællere)/sum(nævnere). Ingen ekstra prod-læsning:
 * vagten henter allerede de seneste rækker til 3-dages-streaken.
 *
 * Rækker uden brugbar rate eller uden stageInstances springes over (et hul i
 * cron-kørslerne må aldrig gætte en værdi — samme princip som
 * findConsecutiveBreaches' dato-hul-håndtering).
 *
 * @param {Array<{date:string, metrics?:Record<string, number|null>}>} rows  vilkårlig rækkefølge
 * @param {string} metricKey
 * @param {number} [windowDays]
 * @returns {{value:number|null, stages:number, days:number}}
 */
export function poolDailyRate(rows = [], metricKey, windowDays = BALANCE_DRIFT_TUNING.POOL_WINDOW_DAYS) {
  const sorted = [...rows]
    .filter((r) => r && r.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, Math.max(1, Math.floor(windowDays)));

  let numerator = 0;
  let denominator = 0;
  let days = 0;
  for (const row of sorted) {
    // FÆLDEN (#2804-klassen): Number(null) === 0, og 0 ER finit. En dag hvor
    // metrikken var n/a (null) ville derfor blive poolet ind som "raten var 0"
    // og trække vinduet kunstigt ned — netop den slags falske bånd-brud denne
    // ændring skal fjerne. Eksplicit null/'' -check FØR Number().
    const rawRate = row.metrics?.[metricKey];
    const rawStages = row.metrics?.stageInstances;
    if (rawRate == null || rawRate === "" || rawStages == null || rawStages === "") continue;
    const rate = Number(rawRate);
    const stages = Number(rawStages);
    if (!Number.isFinite(rate) || !Number.isFinite(stages) || stages <= 0) continue;
    numerator += rate * stages;
    denominator += stages;
    days++;
  }
  if (denominator <= 0) return { value: null, stages: 0, days: 0 };
  return { value: numerator / denominator, stages: denominator, days };
}

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
  // #2731: ALTID beregnet og persisteret (additivt felt i metrics-JSON'en), så
  // trenden kan sammenlignes historisk uanset om robust-mode er flippet.
  // Klassifikationen bruger den kun når flaget er ON.
  const winLb = maxRiderWinRateLowerBound({ winsByRider, startsByRider, minStarts: 5 });

  return {
    favoriteWinRate: dom.favoriteWinRate,
    favoritePodiumRate: dom.favoritePodiumRate,
    share4PlusSameTeamTop10: dom.share4PlusSameTeamTop10,
    avgDistinctTeamsTop10: dom.avgDistinctTeamsTop10,
    dnfRatePct: inc.meanDnfRatePct,
    maxRiderWinRate: winStats.maxWinRate,
    maxRiderWinRateLb: winLb.maxLowerBound,
    maxRiderWinRateRiders: winLb.riders,
    jourSansSharePct: riderStageCount > 0 ? (100 * jourSansHits) / riderStageCount : null,
    breakawayWinSharePct: breakawayEligibleStages > 0 ? (100 * breakawayWins) / breakawayEligibleStages : null,
    stageInstances: dom.races,
    incidentStages: inc.stages,
  };
}

/**
 * #2557 — PER-TIER-opdeling af dagens dominans-observationer.
 *
 * HVORFOR: aggregatet er et gennemsnit af puljer der opfører sig MODSAT. Målt
 * 27/7-3/8 (docs/audits/2026-08-03-team-dominance-2557.md) vandt favoritten
 * 49% i tier 3 (for forudsigeligt) men kun 15,6-17,5% i tier 1/2/4 (for
 * tilfældigt, under bånd-min 0,25). Ét gennemsnit landede tæt på båndet og
 * skjulte begge fejl i 3 uger — og variant C (PR #2575) blev kalibreret mod
 * netop det gennemsnit. Opdelingen er derfor ikke pynt: uden den kan en
 * kalibrering ikke se hvilken retning den skal gå.
 *
 * REPORT-ONLY: deltager ALDRIG i rød-klassifikation eller 3-dages-alarmen
 * (classifyDay itererer kun BALANCE_DRIFT_BANDS). Den lever i den persisterede
 * metrics-jsonb så admin-trenden og fremtidige kalibreringer kan læse den.
 *
 * @param {Array<ReturnType<typeof import("./raceDominanceMetrics.js").observeRace> & {tier?:number|null}>} observations
 * @returns {Record<string, {stages:number, favoriteWinRate:number|null,
 *   favoritePodiumRate:number|null, share4PlusSameTeamTop10:number|null,
 *   avgDistinctTeamsTop10:number|null}>} nøgle = `tier${n}` eller "unknown"
 */
export function computeTierBreakdown(observations = []) {
  const byTier = new Map();
  for (const obs of observations) {
    const key = obs?.tier == null ? "unknown" : `tier${obs.tier}`;
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key).push(obs);
  }

  const out = {};
  for (const [key, group] of [...byTier].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const agg = aggregateObservations(group);
    out[key] = {
      stages: agg.races,
      favoriteWinRate: agg.favoriteWinRate,
      favoritePodiumRate: agg.favoritePodiumRate,
      share4PlusSameTeamTop10: agg.share4PlusSameTeamTop10,
      avgDistinctTeamsTop10: agg.avgDistinctTeamsTop10,
    };
  }
  return out;
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
 * #2731: når `robust` er ON byttes ESTIMATOREN (ikke båndet) for fire metrikker:
 *   - maxRiderWinRate  → Wilson-nedre-grænse (metrics.maxRiderWinRateLb)
 *   - de tre dags-rater → poolet over de seneste POOL_WINDOW_DAYS rækker
 * `basis` fortæller hvilken linse cellen blev bedømt på ("day" | "wilson-lb" |
 * "pooled-Nd"), og `dayValue` bevarer altid den rå dags-værdi så admin-trenden
 * kan vise begge. Robust OFF ⇒ output er felt-for-felt identisk med før.
 *
 * @param {Record<string, number|null>} metrics  computeDayMetrics()-output (eller en persisteret række)
 * @param {object} [opts]
 * @param {Array<{date:string, metrics?:object}>} [opts.recentRows]  persisterede rækker inkl. DAGENS (til pooling)
 * @param {boolean} [opts.robust]
 * @param {number} [opts.poolWindowDays]
 * @returns {Record<string, {value:number|null, band:object, status:string, basis:string, dayValue:number|null}>}
 */
export function classifyDay(metrics = {}, {
  recentRows = null,
  robust = BALANCE_DRIFT_TUNING.ROBUST_ESTIMATORS,
  poolWindowDays = BALANCE_DRIFT_TUNING.POOL_WINDOW_DAYS,
} = {}) {
  const out = {};
  const pooledSet = new Set(POOLED_RATE_METRICS);

  for (const [key, band] of Object.entries(BALANCE_DRIFT_BANDS)) {
    const dayValue = metrics[key] ?? null;
    let value = dayValue;
    let basis = "day";

    if (robust) {
      if (key === "maxRiderWinRate") {
        // Ingen LB tilgængelig (gamle rækker / ingen kvalificerede ryttere) ⇒
        // fald tilbage til dags-værdien frem for at rapportere n/a.
        const lb = metrics.maxRiderWinRateLb;
        if (lb != null && Number.isFinite(Number(lb))) {
          value = Number(lb);
          basis = "wilson-lb";
        }
      } else if (pooledSet.has(key) && Array.isArray(recentRows) && recentRows.length > 0) {
        const pooled = poolDailyRate(recentRows, key, poolWindowDays);
        if (pooled.value != null) {
          value = pooled.value;
          basis = `pooled-${pooled.days}d`;
        }
      }
    }

    out[key] = { value, band, status: classifyMetric(value, band), basis, dayValue };
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

/**
 * #2730 — edge-triggered dedup for balance-drift-Discord-alarmen.
 *
 * Byg en STABIL signatur af det aktuelle brud-sæt (metric + streak-start,
 * sorteret) og sammenlign med den sidst-persisterede signatur. Formålet: en
 * boot-/restart-kørsel (24h-timeren nulstilles ved hver deploy) må ikke
 * re-alarmere et UÆNDRET vedvarende brud på hver deploy (Discord-spam, #2730).
 *
 * Signaturen bruger `since` (streak-start), ikke `days`, så et brud der bare
 * bliver ÆLDRE ikke tæller som en ændring — kun et NYT brud, et brud der
 * FORSVINDER, eller et brud hvis streak er brudt og genstartet (ny `since`)
 * udløser en ny alarm.
 *
 * @param {Array<{metric:string, since:string}>} breaches  findConsecutiveBreaches()-output
 * @param {string} [prevSignature]  sidst-persisterede signatur ("" hvis aldrig alarmeret)
 * @returns {{ shouldAlert: boolean, signature: string, changed: boolean }}
 *   shouldAlert: send Discord-alarm nu (signaturen ændrede sig OG er ikke-tom).
 *   signature:   den nye signatur der skal persisteres.
 *   changed:     signaturen afviger fra prev (persistér også når brud RYDDES,
 *                så et fremtidigt identisk brud alarmerer igen).
 */
export function evaluateBreachAlert(breaches, prevSignature = "") {
  const signature = (breaches || [])
    .map((b) => `${b.metric}@${b.since}`)
    .sort()
    .join("|");
  const changed = signature !== (prevSignature || "");
  return { shouldAlert: changed && signature !== "", signature, changed };
}
