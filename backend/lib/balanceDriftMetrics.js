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
  // #2731-opfølgning B (count-baseret dominans-trigger, se
  // maxRiderWinCountAboveRateFloor() nedenfor for kalibreringsgrundlaget).
  COUNT_TRIGGER_MIN_RATE: envNum("BALANCE_DRIFT_COUNT_TRIGGER_MIN_RATE", 0.40),
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
  // #2731-opfølgning B — count-baseret supplement til maxRiderWinRate, se
  // maxRiderWinCountAboveRateFloor()'s header for kalibrering + Rubio-casen.
  // reportOnly: 50% dags-hit-rate over en 30-dages empirisk scanning (se
  // funktionens header) er ikke sjælden nok til hård alarm endnu.
  maxRiderDominantWinCount: Object.freeze({ max: 6, reportOnly: true }), // >=7 sejre m. rate>=COUNT_TRIGGER_MIN_RATE
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
 * #2731-opfølgning B — COUNT-baseret supplement til maxRiderWinRate/Wilson-LB.
 *
 * HVORFOR WILSON IKKE FANGER RUBIO-CASEN: Wilson-LB (ovenfor) belønner en
 * EKSTREM rate over et lille antal starter højere end en mere moderat rate
 * over et stort, troværdigt antal starter — fordi LB måler "hvor sikre kan vi
 * være på at raten er høj", ikke "hvor mange sejre har rytteren faktisk
 * samlet". #3245-auditens 2/8-vindue: Aitor Rubio (7 sejre/17 starter,
 * rate 0,412) har Wilson-LB **0,216**, mens Lars Wouters (5/7=0,714, en langt
 * mindre robust stikprøve) har LB **0,359** — højere, selvom Rubio ifølge
 * auditens p≈1e-9-beregning er "dagens reelt mest dominerende rytter målt på
 * et troværdigt antal starter". Et rent COUNT-mål retter denne blinde vinkel
 * ved at se på det ABSOLUTTE sejrsantal, med et rate-gulv som eneste filter
 * mod highvolume/lav-rate-ryttere (mange starter, tilfældigt nogle sejre).
 *
 * EMPIRISK KALIBRERING (2026-08-03, read-only SELECT mod prod, samme
 * 14-dages rullende vinduer som windowRows i balanceDriftWatch.js, 30
 * target-datoer 5/7-3/8 — se PR-body for de fulde tal):
 *   - wins>=7 UDEN rate-gulv: 29/30 dage (97%) — poolen (alle divisioner,
 *     tusindvis af ryttere) har ALTID en topscorer et sted; ren
 *     sejrs-optælling er lige så følsom over for pooling-støj som den rå
 *     maxRiderWinRate var før #3245.
 *   - wins>=7 MED rate>=0,40: 15/30 dage (50%) — rate-gulvet er derfor ikke
 *     pynt, det er det eneste håndtag der faktisk diskriminerer signal fra
 *     "ugens topscorer".
 *   - wins>=8 (uden gulv): 10/30 (33%). wins>=9: 0/30 — aldrig observeret,
 *     så X=9 ville aldrig fange NOGEN dominans, heller ikke ægte tilfælde.
 *
 * X=7 (bånd-max=6 i BALANCE_DRIFT_BANDS.maxRiderDominantWinCount, dvs. værdi
 * >6 er "brud"), Y=0,40 (COUNT_TRIGGER_MIN_RATE): Rubios 0,412 klarer Y med
 * kun 0,012 margin — Y=0,45 (samme som det rå maxRiderWinRate-bånd) ville
 * UDELUKKE ham. minStarts=5 matcher den eksisterende konvention.
 *
 * 50% dags-hit-rate er IKKE sjælden — se BALANCE_DRIFT_BANDS' reportOnly-
 * begrundelse for hvorfor denne metrik (ligesom jourSansSharePct/
 * breakawayWinSharePct) er synlig/persisteret, men aldrig alarm-eligible.
 *
 * @param {object} args
 * @param {Map<string, number>} args.winsByRider
 * @param {Map<string, number>} args.startsByRider
 * @param {number} [args.minStarts]
 * @param {number} [args.minRate]  rate-gulv (0-1)
 * @returns {{maxWinsAboveRateFloor:number|null, riders:number, leader:{riderId:string, wins:number, starts:number, rate:number}|null}}
 */
export function maxRiderWinCountAboveRateFloor({
  winsByRider = new Map(),
  startsByRider = new Map(),
  minStarts = 5,
  minRate = BALANCE_DRIFT_TUNING.COUNT_TRIGGER_MIN_RATE,
} = {}) {
  let best = null;
  let leader = null;
  let riders = 0;
  for (const [riderId, starts] of startsByRider.entries()) {
    if (starts < minStarts) continue;
    const wins = winsByRider.get(riderId) || 0;
    const rate = starts > 0 ? wins / starts : 0;
    if (rate < minRate) continue;
    riders++;
    if (best == null || wins > best || (wins === best && rate > (leader?.rate ?? 0))) {
      best = wins;
      leader = { riderId, wins, starts, rate };
    }
  }
  return { maxWinsAboveRateFloor: best, riders, leader };
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
  // #2731-opfølgning B: ALTID beregnet og persisteret (samme mønster som
  // maxRiderWinRateLb ovenfor), reportOnly-båndet afgør om den nogensinde
  // klassificerer rødt/alarmerer — se maxRiderWinCountAboveRateFloor()'s header.
  const countDom = maxRiderWinCountAboveRateFloor({ winsByRider, startsByRider, minStarts: 5 });

  return {
    favoriteWinRate: dom.favoriteWinRate,
    favoritePodiumRate: dom.favoritePodiumRate,
    share4PlusSameTeamTop10: dom.share4PlusSameTeamTop10,
    avgDistinctTeamsTop10: dom.avgDistinctTeamsTop10,
    dnfRatePct: inc.meanDnfRatePct,
    maxRiderWinRate: winStats.maxWinRate,
    maxRiderWinRateLb: winLb.maxLowerBound,
    maxRiderWinRateRiders: winLb.riders,
    maxRiderDominantWinCount: countDom.maxWinsAboveRateFloor,
    maxRiderDominantWinCountRiders: countDom.riders,
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

// De fire nøgler computeTierBreakdown() rent faktisk beregner pr. tier
// (dnfRatePct/maxRiderWinRate/jourSans/breakaway lever kun i det globale
// aggregat — ingen pr.-tier-nedbrydning af dem findes endnu).
const TIER_CLASSIFIED_METRICS = Object.freeze([
  "favoriteWinRate",
  "favoritePodiumRate",
  "share4PlusSameTeamTop10",
  "avgDistinctTeamsTop10",
]);

/**
 * #2557/#3250-opfølgning (spor B1, del B) — klassificér HVER tiers
 * nedbrydning mod de SAMME kanoniske bånd som det globale aggregat.
 *
 * HVORFOR: computeTierBreakdown() (ovenfor) beregner allerede tallene, men er
 * bevidst report-only — den deltager ikke i rød/grøn-klassifikation.
 * #3250-auditens hovedfund var netop at det GLOBALE aggregat kan se rimeligt
 * ud (grønt/gult) mens ÉN tier alene bryder båndet kraftigt: tier 3 vandt
 * favoritten 49% af tiden (27/7-3/8, docs/audits/2026-08-03-team-dominance-2557.md)
 * mens tier 1/2/4 lå på 15,6-17,5% — hver ende trækker aggregatet mod midten
 * og skjuler begge fejl. Denne funktion tilføjer klassifikationen ovenpå
 * computeTierBreakdown()'s tal, så et enkelt tier-brud er SYNLIGT selv når
 * det globale aggregat er grønt.
 *
 * Verificeret mod ægte prod-data (2026-08-02 — eneste dag med persisteret
 * byTier på skrivetidspunktet, da #2557/#3250 kun lige er merget): global
 * favoriteWinRate-status var "yellow", mens denne funktion klassificerede
 * tier1 (0,200), tier3 (0,583) OG tier4 (0,188) som "red" — kun tier2 (0,25)
 * var grøn. Beviser konkret at aggregatet kan maskere et per-tier-brud, og at
 * tier 3 IKKE er den eneste tier der kan trippe alene.
 *
 * @param {Record<string, {stages:number, favoriteWinRate:number|null, favoritePodiumRate:number|null, share4PlusSameTeamTop10:number|null, avgDistinctTeamsTop10:number|null}>} byTier  computeTierBreakdown()-output
 * @param {Record<string, {min?:number,max?:number,reportOnly?:boolean}>} [bands]  BALANCE_DRIFT_BANDS som standard
 * @returns {Record<string, Record<string, {value:number|null, status:string}>>}  nøgle = tier (`tier1`..`tier4`/"unknown"), derefter metric
 */
export function classifyTierBreakdown(byTier = {}, bands = BALANCE_DRIFT_BANDS) {
  const out = {};
  for (const [tierKey, tierMetrics] of Object.entries(byTier)) {
    const tierOut = {};
    for (const metricKey of TIER_CLASSIFIED_METRICS) {
      const band = bands[metricKey];
      if (!band) continue;
      const value = tierMetrics?.[metricKey] ?? null;
      tierOut[metricKey] = { value, status: classifyMetric(value, band) };
    }
    out[tierKey] = tierOut;
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
 * #2557/#3250-opfølgning (spor B1, del B) — SAMME algoritme som
 * findConsecutiveBreaches, men på PER-TIER-klassifikationen
 * (classifyTierBreakdown()-output), så fx tier3 kan trippe ALENE i 3+ dage i
 * træk selvom det globale aggregat (findConsecutiveBreaches) er grønt i hele
 * perioden — det var netop det #3250-auditen viste var sket i praksis.
 *
 * IKKE wired til Discord-alarmen (balanceDriftWatch.js sender kun payload for
 * findConsecutiveBreaches' output). Resultatet er forespørgelsesbart via
 * GET /api/admin/balance-drift (tierBreaches-feltet) og fuldt unit-testet her,
 * så at koble den til webhook'en er én lille commit væk — men det kræver
 * ejerens vurdering af støjniveau over en længere periode først (samme
 * beslutning som #3245/#3250 begge eksplicit efterlod til ejeren).
 *
 * @param {Array<{date:string, tierStatuses:Record<string,Record<string,{status:string}>>}>} rows  vilkårlig rækkefølge (sorteres internt), skal indeholde DAGENS række
 * @param {{minConsecutiveDays?:number}} [opts]
 * @returns {Array<{tier:string, metric:string, days:number, since:string}>}  sorteret efter tier, så metric
 */
export function findConsecutiveTierBreaches(rows = [], { minConsecutiveDays = 3 } = {}) {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Saml alle (tier, metric)-par der optræder NOGEN gang i vinduet — en dag
  // uden etaper i en given tier (byTier mangler nøglen den dag) skal IKKE
  // forveksles med et manglende cron-tick; det håndteres separat af
  // isConsecutiveDay nedenfor (datoen selv mangler stadig aldrig en RÆKKE).
  const pairs = new Set();
  for (const row of sorted) {
    for (const [tier, metrics] of Object.entries(row.tierStatuses || {})) {
      for (const metric of Object.keys(metrics)) pairs.add(`${tier}::${metric}`);
    }
  }

  const breaches = [];
  for (const pairKey of pairs) {
    const [tier, metric] = pairKey.split("::");
    let streak = 0;
    let streakStart = null;
    let prevDate = null;
    for (const row of sorted) {
      const status = row.tierStatuses?.[tier]?.[metric]?.status;
      const isConsecutiveDay = prevDate == null || daysBetween(prevDate, row.date) === 1;
      if (status === "red" && isConsecutiveDay) {
        streak = isConsecutiveDay && prevDate != null && streak > 0 ? streak + 1 : 1;
        if (streak === 1) streakStart = row.date;
      } else if (status === "red" && !isConsecutiveDay) {
        streak = 1;
        streakStart = row.date;
      } else {
        streak = 0;
        streakStart = null;
      }
      prevDate = row.date;
    }
    if (streak >= minConsecutiveDays) {
      breaches.push({ tier, metric, days: streak, since: streakStart });
    }
  }
  return breaches.sort((a, b) => (a.tier === b.tier ? (a.metric < b.metric ? -1 : 1) : a.tier < b.tier ? -1 : 1));
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
