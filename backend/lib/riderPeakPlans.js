// Race Engine v3 (#2224), slice S5 — peak-planner API-service-lib.
// Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md (§10)
//   + docs/superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md (§2/§4/§8).
//
// REN service-lib for CRUD-endpointsene i routes/api.js: vindue-snap, lås-udledning,
// fokus-anbefaling, foreslået træningsblok, guards og serialisering. INGEN I/O /
// Date / Math.random her — "nu" gives ind som CET-dag-ordinal (samme dag-enhed som
// racePeakPlans.js's motor-sti), så alt er deterministisk og testbart uden DB-mock.
// Den impure orkestrering (routes/api.js) laver DB-opslaget + beregner ordinalen.
//
// Dag-enheden er CET-kalenderdag-ordinal via racePeakPlans.dateStringToOrdinal —
// PRÆCIS samme skala motoren sammenligner etape-dato mod peak-vindue i, så et
// vindue snappet her og læst af motoren dér er bit-for-bit den samme grænse.

import { dateStringToOrdinal, ordinalToDateString } from "./racePeakPlans.js";
import { focusCoverage } from "./racePeaks.js";
import { TRAINING_FOCUSES, TRAINING_FOCUS_KEYS, WEEKDAY_KEYS } from "./training.js";
import { RACE_V3_TUNING } from "./raceRoles.js";

// Vindue-radius: peak-vinduet snappes til center ± radius = 5 dage ved radius 2
// (spec §10: 4-6 dage). PLANLÆGNINGS-konstant (ikke en score-balance-konstant), så
// den bor her, ikke i RACE_V3_TUNING (som er motorens scoring-flade).
export const PEAK_WINDOW_RADIUS_DAYS = 2;

// Låses senest 3 dage før vinduets start (addendum §2). Effektiv lås udledes ved
// læse-tid; en persisteret locked_at er en hård lås der overtrumfer tærsklen.
export const PEAK_LOCK_LEAD_DAYS = 3;

// Maks 2 peak-planer pr. (rytter, sæson) — håndhæves i API (count-check), ikke en
// DB-constraint (spec §11.4 / addendum §4).
export const MAX_PEAK_PLANS_PER_SEASON = 2;

/**
 * Snap et ~5-dags peak-vindue om et mål-løbs kalenderdatoer. Centrerer om løbets
 * midterdag (median af min/max etape-dato), så et endags-løb får et symmetrisk
 * vindue og et kort etapeløb dækkes helt. Vinduet er center ± radiusDays.
 *
 * @param {string[]} raceStageDates  mål-løbets etape-datoer ("YYYY-MM-DD")
 * @param {{radiusDays?:number}} [opts]
 * @returns {{window_start:string, window_end:string}|null}  null ved ingen gyldige datoer
 */
export function snapPeakWindow(raceStageDates, { radiusDays = PEAK_WINDOW_RADIUS_DAYS } = {}) {
  let min = Infinity, max = -Infinity;
  for (const d of raceStageDates || []) {
    const ord = dateStringToOrdinal(d);
    if (ord == null) continue;
    if (ord < min) min = ord;
    if (ord > max) max = ord;
  }
  if (!Number.isFinite(min)) return null;
  const center = Math.floor((min + max) / 2);
  return {
    window_start: ordinalToDateString(center - radiusDays),
    window_end: ordinalToDateString(center + radiusDays),
  };
}

/**
 * Er en peak-plan låst (ikke længere redigerbar)? En persisteret locked_at er en
 * hård lås; ellers udledes låsen ved læse-tid: nu >= (window_start − lockLeadDays).
 *
 * @param {{locked_at:string|null, window_start:string}} plan
 * @param {number} nowOrdinal  CET-dag-ordinal for "nu"
 * @param {{lockLeadDays?:number}} [opts]
 * @returns {boolean}
 */
export function isPlanLocked(plan, nowOrdinal, { lockLeadDays = PEAK_LOCK_LEAD_DAYS } = {}) {
  if (plan?.locked_at != null) return true;
  const start = dateStringToOrdinal(plan?.window_start);
  if (start == null || !Number.isFinite(Number(nowOrdinal))) return false;
  return Number(nowOrdinal) >= start - lockLeadDays;
}

/**
 * Vælg det træningsfokus hvis evner dækker mest af et mål-løbs demand-vektor.
 * Deterministisk tie-break via TRAINING_FOCUS_KEYS-rækkefølgen. Ingen positiv
 * dækning (tom/ukendt demand) → null (ingen anbefaling).
 *
 * @param {Record<string,number>|null} demandVector
 * @param {Record<string,string[]>} [focusAbilitiesMap=TRAINING_FOCUSES]
 * @returns {string|null}
 */
export function recommendFocusForDemand(demandVector, focusAbilitiesMap = TRAINING_FOCUSES) {
  if (!demandVector || typeof demandVector !== "object") return null;
  let best = null, bestCov = 0;
  for (const focus of TRAINING_FOCUS_KEYS) {
    const cov = focusCoverage(focusAbilitiesMap[focus], demandVector);
    if (cov > bestCov) { bestCov = cov; best = focus; }
  }
  return bestCov > 0 ? best : null;
}

// Build-uge = højt, konsistent load (opbyg fitness); taper-uge = aflastning ind
// mod peaket (drop fatigue — kernen i periodisering, addendum §2). Begge er
// gyldige training_week_plans-"days"-objekter (isValidWeekPlanDays).
function weekDays(intensities) {
  const days = {};
  WEEKDAY_KEYS.forEach((wd, i) => { days[wd] = { intensity: intensities[i] }; });
  return days;
}
const BUILD_WEEK = weekDays(["hard", "normal", "hard", "normal", "hard", "normal", "rest"]);
const TAPER_WEEK = weekDays(["normal", "easy", "normal", "easy", "easy", "rest", "rest"]);

/**
 * Foreslået build→taper-uge-rytme for et peak-vindue (addendum §2). RETURNERES
 * kun (ikke-destruktivt, addendum §8 Q2-kandidat); accept/skrivning sker separat i
 * Planner-slicen. Formen er training_week_plans-kompatibel, så Planneren kan skrive
 * den valgte uges rytme direkte.
 *
 * @param {{recommendedFocus?:string|null, leadupDays?:number}} [args]
 * @returns {{recommendedFocus:string|null, leadupDays:number, weekRhythms:{build:object, taper:object}}}
 */
export function buildSuggestedTrainingBlock({ recommendedFocus = null, leadupDays = RACE_V3_TUNING.PEAK_LEADUP_DAYS } = {}) {
  return {
    recommendedFocus: recommendedFocus ?? null,
    leadupDays,
    weekRhythms: { build: BUILD_WEEK, taper: TAPER_WEEK },
  };
}

/**
 * Guard for oprettelse af en peak-plan: maks 2 pr. sæson + ét vindue pr. mål-løb.
 * (Ejerskab + kalender-tilhør håndhæves i routen mod DB.)
 *
 * @param {{existingTargetRaceIds:string[], targetRaceId:string, maxPlans?:number}} args
 * @returns {{ok:boolean, reason:"max_reached"|"duplicate_target"|null}}
 */
export function canCreatePeakPlan({ existingTargetRaceIds = [], targetRaceId, maxPlans = MAX_PEAK_PLANS_PER_SEASON }) {
  if (existingTargetRaceIds.includes(targetRaceId)) return { ok: false, reason: "duplicate_target" };
  if (existingTargetRaceIds.length >= maxPlans) return { ok: false, reason: "max_reached" };
  return { ok: true, reason: null };
}

/**
 * DB-række → API-form. Udleder `locked` ved læse-tid mod nowOrdinal.
 *
 * @param {object} row  rider_peak_plans-række
 * @param {number} nowOrdinal  CET-dag-ordinal for "nu"
 * @param {object} [opts]  videresendes til isPlanLocked
 * @returns {object}
 */
export function serializePlan(row, nowOrdinal, opts = {}) {
  return {
    id: row.id,
    riderId: row.rider_id,
    seasonId: row.season_id,
    targetRaceId: row.target_race_id ?? null,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    lockedAt: row.locked_at ?? null,
    locked: isPlanLocked(row, nowOrdinal, opts),
    createdAt: row.created_at,
  };
}
