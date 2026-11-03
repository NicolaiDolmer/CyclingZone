// #7588 (realisme-gate, løsning B, PR 1): målemodulet. ÉN definition af M1-M11,
// som CI-gaten, motor-testporten og drift-vagten skal bruge, så simulation og prod
// måles ens.
//
// REN: ingen IO, ingen RNG, ingen tal. Båndene og tærsklerne (M4/M5) er private
// (hard rule 17, private_config `realism_gate_bands`, schema i
// backend/lib/realismGateBands.ts); her står kun hvordan der måles.
//
// ── Målekontrakten (MEASUREMENT_CONTRACT, låst af testene) ───────────────────
//  1. Kun motorens eget, afregnede output: timeline-events (`breakaway_formed`,
//     `gap_update`, `breakaway_caught`) og etape-rækkernes resultatfelter
//     (ROW_FIELDS). Aldrig afledte ordre- eller planfelter (læren fra #7473, hvor
//     ordrens første opgave blev læst som motorens indsats).
//  2. Udbruddet = dagens morgenudbrud: første `breakaway_formed` uden
//     `reformation`. Forspringet = `separation_seconds` på dets `gap_update`
//     (motorens jagt-afstand til jagtgruppen, s5_profiles_v3+). Uden de punkter er
//     forløbet ikke målt (null), aldrig 0. Indhentningens km = `exact_km` ellers `km`.
//  3. Tiendedele: etapens distance i 10 lige stykker. Værdien er det største
//     forspring i stykket (inkl. forspringet ved stykkets start); null hvor
//     udbruddet ikke findes (før det er dannet, efter det er hentet).
//  4. Enkeltstarter (itt, itt_hilly, ttt) er ude af alle udbrudsmål (M2-M8).
//  5. Tidsgab til nr. 10 (M1) måles kun på etaper udbruddet ikke vandt.
//  6. Alt grupperes pr. løb (raceId). Effektiv n = distinkte ruter (raceId + etape),
//     ikke etaper x seeds: seeds af samme rute er ikke uafhængige.
//  7. Endagsløbets vinder er klassementets vinder (`result_type = 'gc'` på prod-
//     siden), ikke en etape-række (målefælden fra 31/10).
//  8. Mangler en måling, tælles den som manglende (`missing`), aldrig tabt af
//     nævneren eller gjort til et stille PASS.

import {
  CELL_WILDCARD, REALISM_GC_GROUPS, cellKey,
} from "../../../lib/realismGateBands.ts";
import { canonicalFinaleType } from "../../../lib/stageProfileTypes.js";
import { median, raceGroupOfStages } from "./v3Gates.mjs";

export const MEASUREMENT_CONTRACT_VERSION = 1;

export const MEASUREMENT_CONTRACT = Object.freeze({
  version: MEASUREMENT_CONTRACT_VERSION,
  engineOutputOnly: true,
  breakaway: "morning", // første breakaway_formed uden reformation
  leadSource: "gap_update.separation_seconds",
  caughtKmSource: "breakaway_caught.exact_km ?? km",
  deciles: 10,
  timeTrialsExcludedFromBreakawayMetrics: true,
  gapTo10ExcludesBreakawayWins: true,
  groupBy: "raceId",
  effectiveN: "distinct routes (raceId + stage)",
  oneDayWinnerResultType: "gc",
  missingIsCounted: true,
});

/** Antal stykker etapen deles i (strukturelt, ikke balance). */
export const DECILES = 10;

/** M7: plateauet måles i etapens sjette tiendedel (50-60 %, designets definition). */
export const PLATEAU_DECILE = 5;

const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

/**
 * De række-felter modulet læser (alle afregnet af motoren). Felter uden for listen
 * påvirker aldrig en måling; testen låser det.
 */
export const ROW_FIELDS = Object.freeze([
  "stage", "profile_type", "finale_type", "gapTo10", "ittGapTo10Per40Km", "breakawayWon", "breakawaySize", "winnerId",
  "breakawayLeadByDecile", "breakawayPeakFrac", "breakawayCaughtKmToGo",
]);

const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Kvantil med lineær interpolation (type 7). null uden værdier. */
export function quantile(xs, q) {
  const s = (xs ?? []).map(num).filter((v) => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** finale_type -> afslutnings-spand (REALISM_FINISHES). */
export function finishOf(profile) {
  const f = canonicalFinaleType(profile?.finale_type);
  if (TIME_TRIAL_PROFILES.has(profile?.profile_type) || f === "solo_tt") return "tt";
  if (f === "long_climb") return "summit";
  if (f === "descent") return "descent";
  if (f === "flat_sprint") return "sprint";
  if (f === "punch" || f === "uphill_sprint" || f === "wall_finish") return "punch";
  return "other";
}

/** Samme grænser som tourScorecard.shortStageRaceGroup (testen låser at de er ens). */
export function gcGroupOf(stageCount) {
  const n = Number(stageCount) || 0;
  if (n >= 2 && n <= 4) return "sr2-4";
  if (n >= 5 && n <= 8) return "sr5-8";
  if (raceGroupOfStages(n) === "gt") return "gt";
  return null;
}

/** Etapens celle. `raceGroup` kan overstyres (fx "monument" fra løbsklassen). */
export function stageCellOf({ stageCount, raceGroup = null, profile }) {
  return {
    group: raceGroup ?? raceGroupOfStages(stageCount),
    terrain: profile?.profile_type ?? null,
    finish: finishOf(profile),
  };
}

/** Den konkrete celle og alle dens jokertegn-samlinger (8 nøgler). */
export function cellKeysOf({ group, terrain, finish }) {
  const keys = [];
  for (const g of [group, CELL_WILDCARD]) for (const t of [terrain, CELL_WILDCARD]) for (const f of [finish, CELL_WILDCARD]) keys.push(cellKey(g, t, f));
  return keys;
}

// ── Udbruddets forløb fra motorens events ────────────────────────────────────

const eventKm = (e) => num(e?.params?.exact_km ?? e?.km);

/**
 * Morgenudbruddets forløb på én etape ud fra motorens timeline-events. REN.
 *  - formed: om et morgenudbrud blev dannet; measured: om der er forspringspunkter.
 *  - leadByDecile: største forspring pr. tiendedel (null hvor udbruddet ikke findes);
 *    null når forløbet ikke er målt.
 *  - maxLead, peakFrac (andel af etapen hvor forspringet først toppede).
 *  - plateau: forspringet i PLATEAU_DECILE / maxLead (0 hvis hentet før).
 *  - caughtKm, caughtKmToGo (null når udbruddet ikke blev hentet).
 */
export function breakawayTrajectory(events, distanceKm) {
  const list = Array.isArray(events) ? events : [];
  const dist = num(distanceKm);
  const formedEvent = list.find((e) => e?.type === "breakaway_formed" && e.params?.reformation !== true);
  const empty = { formed: false, measured: false, maxLead: null, peakFrac: null, leadByDecile: null, plateau: null, caughtKm: null, caughtKmToGo: null };
  if (!formedEvent || !(dist > 0)) return { ...empty, formed: Boolean(formedEvent) };
  const groupId = formedEvent.params?.group_id;
  const formedKm = Math.max(0, eventKm(formedEvent) ?? 0);
  const caughtEvent = list.find((e) => e?.type === "breakaway_caught" && e.params?.group_id === groupId);
  const caughtKm = caughtEvent ? eventKm(caughtEvent) : null;
  const samples = list
    .filter((e) => e?.type === "gap_update" && e.params?.group_id === groupId && num(e.params?.separation_seconds) !== null && num(e.km) !== null)
    .map((e) => ({ km: Number(e.km), lead: Math.max(0, Number(e.params.separation_seconds)) }))
    .sort((a, b) => a.km - b.km);
  const caughtFacts = { caughtKm, caughtKmToGo: caughtKm === null ? null : Math.max(0, dist - caughtKm) };
  if (!samples.length) return { ...empty, formed: true, ...caughtFacts };

  let maxLead = -Infinity;
  let peakKm = null;
  for (const s of samples) if (s.lead > maxLead) { maxLead = s.lead; peakKm = s.km; }

  const leadByDecile = [];
  let carry = null; // forspringet ved stykkets start (sidste punkt før)
  let i = 0;
  for (let d = 0; d < DECILES; d++) {
    const start = (dist * d) / DECILES;
    const end = (dist * (d + 1)) / DECILES;
    const last = d === DECILES - 1;
    const inDecile = [];
    while (i < samples.length && (samples[i].km < end || last)) { inDecile.push(samples[i]); i += 1; }
    const exists = formedKm < end && (caughtKm === null || caughtKm > start);
    if (!exists) { leadByDecile.push(null); if (inDecile.length) carry = inDecile[inDecile.length - 1].lead; continue; }
    const values = [...(carry === null ? [] : [carry]), ...inDecile.map((s) => s.lead)];
    leadByDecile.push(values.length ? Math.max(...values) : null);
    if (inDecile.length) carry = inDecile[inDecile.length - 1].lead;
  }

  const plateauStart = (dist * PLATEAU_DECILE) / DECILES;
  let plateau = null;
  if (maxLead > 0) {
    if (caughtKm !== null && caughtKm <= plateauStart) plateau = 0;
    else if (leadByDecile[PLATEAU_DECILE] !== null) plateau = leadByDecile[PLATEAU_DECILE] / maxLead;
  }
  return {
    formed: true, measured: true, maxLead, peakFrac: Math.min(1, Math.max(0, peakKm / dist)),
    leadByDecile, plateau, ...caughtFacts,
  };
}

/** De tre række-felter tourScorecard.stageMetrics bærer (#7588). REN. */
export function breakawayTrajectoryRowFacts(events, distanceKm) {
  const t = breakawayTrajectory(events, distanceKm);
  return { breakawayLeadByDecile: t.leadByDecile, breakawayPeakFrac: t.peakFrac, breakawayCaughtKmToGo: t.caughtKmToGo };
}

// ── Aggregering pr. celle ────────────────────────────────────────────────────

function newCell(key) {
  return {
    key, observations: 0, routes: new Set(),
    gapTo10: [], ittGapTo10PerKm: [], breakawayWin: { hits: 0, n: 0, missing: 0 },
    maxLead: [], leadMissing: 0, peakFrac: [], plateau: [], caughtKmToGo: [], deciles: Array.from({ length: DECILES }, () => []),
    favourite: { hits: 0, best: 0, n: 0, missing: 0 },
  };
}

function addRow(cell, row, routeId, favourites) {
  cell.observations += 1;
  cell.routes.add(routeId);
  const tt = TIME_TRIAL_PROFILES.has(row.profile_type);
  if (tt) {
    const perKm = num(row.ittGapTo10Per40Km);
    if (perKm !== null) cell.ittGapTo10PerKm.push(perKm / 40);
  } else {
    if (row.breakawayWon !== true && num(row.gapTo10) !== null) cell.gapTo10.push(Number(row.gapTo10));
    if (typeof row.breakawayWon === "boolean") {
      cell.breakawayWin.n += 1;
      if (row.breakawayWon) cell.breakawayWin.hits += 1;
    } else cell.breakawayWin.missing += 1;
    const deciles = Array.isArray(row.breakawayLeadByDecile) && row.breakawayLeadByDecile.length === DECILES ? row.breakawayLeadByDecile : null;
    if (deciles) {
      const values = deciles.map(num).filter((v) => v !== null);
      if (values.length) cell.maxLead.push(Math.max(...values));
      deciles.forEach((v, d) => { if (num(v) !== null) cell.deciles[d].push(Number(v)); });
      const peak = num(row.breakawayPeakFrac);
      if (peak !== null) cell.peakFrac.push(peak);
      const max = values.length ? Math.max(...values) : 0;
      const caught = num(row.breakawayCaughtKmToGo);
      if (max > 0) {
        const pv = num(deciles[PLATEAU_DECILE]);
        if (pv !== null) cell.plateau.push(pv / max);
        else if (deciles.slice(PLATEAU_DECILE).every((v) => num(v) === null) && caught !== null) cell.plateau.push(0); // hentet før plateauet
      }
      if (caught !== null) cell.caughtKmToGo.push(caught);
    } else if (num(row.breakawaySize) > 0) cell.leadMissing += 1; // dannet, men forløbet er ikke målt
  }
  if (favourites) {
    const favs = favourites.get?.(row.stage) ?? null;
    if (Array.isArray(favs) && favs.length && row.winnerId) {
      cell.favourite.n += 1;
      if (favs.includes(row.winnerId)) cell.favourite.hits += 1;
      if (favs[0] === row.winnerId) cell.favourite.best += 1;
    } else cell.favourite.missing += 1;
  }
}

const shareOf = (hits, n) => (n > 0 ? hits / n : null);

function countAbove(xs, threshold) {
  if (num(threshold) === null) return null;
  return xs.filter((v) => v > threshold).length;
}

function finishCell(c, params) {
  const routes = c.routes.size;
  const dist = (xs) => ({ n: xs.length, median: median(xs), p90: quantile(xs, 0.9) });
  const leadN = c.maxLead.length;
  const big = countAbove(c.maxLead, params?.bigLeadSeconds);
  const hard = countAbove(c.maxLead, params?.hardCapSeconds);
  return {
    key: c.key, observations: c.observations, routes,
    metrics: {
      gapTo10: dist(c.gapTo10),
      ittGapTo10PerKm: dist(c.ittGapTo10PerKm),
      breakawayWinShare: { n: c.breakawayWin.n, missing: c.breakawayWin.missing, share: shareOf(c.breakawayWin.hits, c.breakawayWin.n) },
      breakawayMaxLead: { ...dist(c.maxLead), missing: c.leadMissing },
      bigLeadShare: { n: leadN, missing: c.leadMissing, share: big === null ? null : shareOf(big, leadN), missingParam: big === null },
      overHardCapCount: { n: leadN, missing: c.leadMissing, count: hard, missingParam: hard === null },
      breakawayPeakFrac: { n: c.peakFrac.length, median: median(c.peakFrac) },
      breakawayPlateau: { n: c.plateau.length, median: median(c.plateau) },
      breakawayCaughtKmToGo: { n: c.caughtKmToGo.length, median: median(c.caughtKmToGo) },
      favouriteWinShare: { n: c.favourite.n, missing: c.favourite.missing, share: shareOf(c.favourite.hits, c.favourite.n) },
      bestRiderWinShare: { n: c.favourite.n, missing: c.favourite.missing, share: shareOf(c.favourite.best, c.favourite.n) },
    },
    leadByDecile: c.deciles.map((xs) => ({ n: xs.length, median: median(xs) })),
  };
}

/**
 * M1-M11 for et korpus. REN.
 *
 * races: [{ raceId, stageCount, raceGroup?, perSeed: [{ rows, gcFinalTo10?, gcWinnerMargin? }] }]
 *   (perSeed i tourScorecard.runTour-formen; rows[] = stageMetrics-rækker).
 * params: { bigLeadSeconds?, hardCapSeconds? } (private tærskler; uden dem er M4/M5 null).
 * favourites: Map<raceId, Map<stage, riderId[]>> (stærkeste først, fx
 *   raceGroupGates.routeFavourites); uden den er M9 manglende.
 *
 * Returnerer { contractVersion, cells: { <gruppe|terræn|afslutning>: … }, gcGroups: { gt|sr2-4|sr5-8: … } }.
 * Cellerne findes både konkret og med jokertegn (`*`) på hver akse.
 */
export function computeRealismMetrics({ races = [], params = {}, favourites = null } = {}) {
  const cells = new Map();
  const gc = new Map(REALISM_GC_GROUPS.map((g) => [g, { routes: new Set(), seeds: 0, to10: [], margin: [], missing: 0 }]));
  for (const race of races) {
    const raceId = String(race?.raceId ?? "");
    const stageCount = Number(race?.stageCount) || 1;
    const favs = favourites?.get?.(race?.raceId) ?? null;
    for (const seed of race?.perSeed ?? []) {
      for (const row of seed?.rows ?? []) {
        if (!row || typeof row !== "object") continue;
        const cell = stageCellOf({ stageCount, raceGroup: race.raceGroup ?? null, profile: row });
        if (!cell.terrain) continue;
        const routeId = `${raceId}#${row.stage}`;
        for (const key of cellKeysOf(cell)) {
          if (!cells.has(key)) cells.set(key, newCell(key));
          addRow(cells.get(key), row, routeId, favs);
        }
      }
      const g = gcGroupOf(stageCount);
      if (g) {
        const bucket = gc.get(g);
        bucket.seeds += 1;
        bucket.routes.add(raceId);
        const to10 = num(seed?.gcFinalTo10);
        if (to10 === null) bucket.missing += 1;
        else bucket.to10.push(to10);
        const margin = num(seed?.gcWinnerMargin);
        if (margin !== null) bucket.margin.push(margin);
      }
    }
  }
  const gcGroups = {};
  for (const [g, b] of gc) {
    if (!b.seeds) continue;
    gcGroups[g] = {
      key: g, observations: b.seeds, routes: b.routes.size,
      metrics: {
        gcFinalTo10: { n: b.to10.length, missing: b.missing, median: median(b.to10), p90: quantile(b.to10, 0.9) },
        gcWinnerMargin: { n: b.margin.length, median: median(b.margin) },
      },
    };
  }
  return {
    contractVersion: MEASUREMENT_CONTRACT_VERSION,
    cells: Object.fromEntries([...cells].sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) => [k, finishCell(c, params)])),
    gcGroups,
  };
}
