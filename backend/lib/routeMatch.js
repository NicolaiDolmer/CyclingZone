// backend/lib/routeMatch.js
// #6207 / #6471 / #6472: ÉT rute-match-tal (0-100) fra motoren.
//
// Før denne fil fandtes to regnskaber: frontendens suitability.js (normaliseret
// mod løbets aggregerede demand-vektor, sæsonmatrix/planner) og backendens
// terrainScore-snit (holdudtagelse/Planlæg dag, randomness-vægten talte med i
// nævneren). Samme rytter på samme løb fik derfor to tal. Begge byggede desuden
// kun på rutegeneratorens gemte demand_vector, som motoren (v4) ikke afgør
// etapen med: en S5-enkeltstart regnes fx alene på tidskørsel i motoren, mens
// den gemte vektor også vægtede positionering.
//
// Nu: ét sted, bygget på motorens egne krav til etapen under løbets regel-
// revision (raceEngineRulesRevision.ts). Motoren læses, ændres aldrig:
//   - Enkeltstart (itt/itt_hilly/ttt): motorens tidskørsels-evne (ittAbilityTuning
//     + ittClimbShare, samme blanding som individualTimeTrial.ittAbilityScore).
//   - Alle andre etaper: motorens finale-krav (samme opslag som finale.ts:
//     nedkørselsfinalen, S5-grundsæt + hybrid, finale-tabellen, feltets finale
//     bag et udbrud, brostens-justering) blandet med etapens terræn-krav
//     (race_stage_profiles.demand_vector uden randomness; det er den vektor
//     motorens klassements-model selv læser som "etapens krav", gcThreat.ts).
//     Terræn-delen dækker hvem der overlever ruten til finalen.
//
// Hver etapes vektor normaliseres til sum 1. Etape-tallet er rytterens evner mod
// den vektor (0-99-evner → 0-100; en rytter med 99 i alt etapen kræver = 100).
//
// LØBSTALLET (dokumenteret aggregering): snittet af etapernes vektorer, og
// rytterens tal mod den vektor. Da tallet er lineært i vektoren, er det PRÆCIS
// snittet af de (urundede) etapetal: hver etape tæller lige meget, fordi hver
// etape er en chance for et resultat. Rundes først til sidst.
//
// Versionering: vektoren afhænger af revisionen (et løb der er startet, bruger
// sin bundne revision; et ikke-startet løb den revision det vil blive bundet til,
// CURRENT_RACE_RULES_REVISION). En regel-ændring i motoren slår derfor igennem
// automatisk, og ROUTE_MATCH_MODEL_VERSION bumpes kun når DENNE fils model ændres.
//
// REN: ingen IO. Kaldstederne henter rækkerne.

import { RACE_V4_TUNING } from "./engine/v4/tuning.ts";
import { routeFromStageProfileRow } from "./engine/v4/adapters/routeAdapter.ts";
import { routeForRulesRevision, s5FinaleDemandVector } from "./engine/v4/s5Profiles.ts";
import { fieldFinaleTypeBehindBreakaway } from "./engine/v4/finale.ts";
import { cobbledFinaleDemandVector } from "./engine/v4/mechanics/cobbles.ts";
import { ittAbilityTuning, ittClimbShare } from "./engine/v4/mechanics/individualTimeTrial.ts";
import { TIME_MODEL_V3_TUNING } from "./engine/v4/mechanics/timeModel.ts";
import {
  CURRENT_RACE_RULES_REVISION,
  isKnownRulesRevision,
  isOrdersGcV3OrLater,
  isS5ProfilesV1OrLater,
  usesSharedGroupTime,
} from "./raceEngineRulesRevision.ts";

export const ROUTE_MATCH_MODEL_VERSION = "engine_v1";

// De race_stage_profiles-kolonner motorens rute-adapter læser. Kaldsteder henter
// præcis disse, så rute-matchen ser samme rute som motoren (uden segmenter
// syntetiserer adapteren dem deterministisk, samme fallback som motoren selv).
export const ROUTE_MATCH_STAGE_COLUMNS =
  "race_id, stage_number, profile_type, finale_type, demand_vector, distance_km, segments, climbs, sectors";

// Samme 15 evner og samme rækkefølge som frontend/src/lib/suitability.js
// (SUITABILITY_ABILITY_KEYS) og raceSimulator.ABILITY_KEYS. Rækkefølgen er en del
// af kontrakten: frontend-visningen regner tooltip-bidrag i samme orden, og
// routeMatch.test.js låser at de to giver samme tal.
export const ROUTE_MATCH_ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone",
  "acceleration", "recovery", "tactics", "positioning", "flat", "tempo",
  "durability", "aggression", "descending",
]);
const KEY_SET = new Set(ROUTE_MATCH_ABILITY_KEYS);
const ABILITY_MAX = 99;

// Finalens andel af en vej-etapes vektor; resten er terrænet. Valgt ud fra
// målingen mod S4-resultater (balance-internals/6207/, privat).
export const ROUTE_MATCH_FINALE_SHARE = 0.25;

const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

/** Revisionen et løb regnes under: den bundne, ellers den et nyt løb bindes til. */
export function routeMatchRevisionFor(race) {
  const bound = race?.engine_rules_revision;
  return isKnownRulesRevision(bound) ? bound : CURRENT_RACE_RULES_REVISION;
}

function normalized(vector) {
  const out = {};
  let total = 0;
  for (const k of ROUTE_MATCH_ABILITY_KEYS) {
    const w = Number(vector?.[k]);
    if (Number.isFinite(w) && w > 0) { out[k] = w; total += w; }
  }
  if (!(total > 0)) return null;
  for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

function blend(a, b, shareA) {
  const out = {};
  for (const k of ROUTE_MATCH_ABILITY_KEYS) {
    const w = shareA * (a?.[k] ?? 0) + (1 - shareA) * (b?.[k] ?? 0);
    if (w > 0) out[k] = w;
  }
  return normalized(out);
}

/** Motorens enkeltstarts-evne for ruten (individualTimeTrial.ittAbilityScore's blanding). */
function timeTrialVector(route, revision) {
  const vectors = ittAbilityTuning(RACE_V4_TUNING, revision).finale.demandVectorByFinaleType;
  const tt = normalized(vectors.solo_tt);
  const climb = normalized(vectors.long_climb);
  // official_times_v3+ blander efter stigningsandelen (#6349). Ældre revisioner
  // regner stigningssegmenter på klatre-vektoren og resten på tidskørsel;
  // strækningsandelen er samme blanding set over hele ruten.
  const share = ittClimbShare(route.segments || []);
  return share > 0 ? blend(climb, tt, share) : tt;
}

/** Motorens finale-krav for etapen (samme opslag som finale.ts's placerings-opgør). */
function finaleVector(route, revision) {
  const table = RACE_V4_TUNING.finale.demandVectorByFinaleType;
  const ctx = { rulesRevision: revision, route };
  const descentV3 = (isOrdersGcV3OrLater(revision) || usesSharedGroupTime(revision)) && route.finale_type === "descent"
    ? TIME_MODEL_V3_TUNING.descentFinaleDemand
    : null;
  const s5 = isS5ProfilesV1OrLater(revision) ? s5FinaleDemandVector(route) : null;
  // Rute-match er feltets tal: på en udbrudsfinale afgør feltet sine placeringer
  // på terrænets egen finale (finale.ts #6073). Under S5 har ruten allerede fået
  // terrænets finale (routeForRulesRevision).
  const fieldFinale = fieldFinaleTypeBehindBreakaway(route);
  const finaleType = fieldFinale ?? route.finale_type;
  const raw = descentV3 ?? s5 ?? (finaleType ? table[finaleType] : null);
  return raw ? normalized(cobbledFinaleDemandVector(raw, ctx)) : null;
}

/**
 * Motorens krav til én etape som evne-vektor (sum 1), eller null uden data.
 * @param {object} stageRow race_stage_profiles-række (profile_type, finale_type, demand_vector, segments, ...)
 * @param {string} revision regel-revisionen løbet regnes under
 * @param {{finaleShare?: number}} [opts] kun til målingen; produktionen bruger default
 */
export function stageRouteVector(stageRow, revision, { finaleShare = ROUTE_MATCH_FINALE_SHARE } = {}) {
  if (!stageRow) return null;
  const terrain = normalized(stageRow.demand_vector);
  let route;
  try {
    route = routeForRulesRevision(routeFromStageProfileRow(stageRow), revision);
  } catch {
    // best-effort: en række motoren ikke kan læse som rute giver terrænet alene
    // (aldrig et opfundet tal). Fejlen er et datafund, ikke et nedbrud: visningen
    // skal stadig kunne vise de øvrige etaper.
    return terrain;
  }
  if (TIME_TRIAL_PROFILES.has(stageRow.profile_type)) return timeTrialVector(route, revision);
  const finale = finaleVector(route, revision);
  if (!finale) return terrain;
  if (!terrain) return finale;
  return blend(finale, terrain, finaleShare);
}

/** Løbets vektor: snittet af etapernes (hver etape vejer lige meget). null uden etaper. */
export function raceRouteVector(stageRows, revision, opts) {
  const vectors = (stageRows || []).map((s) => stageRouteVector(s, revision, opts)).filter(Boolean);
  if (!vectors.length) return null;
  const sum = {};
  for (const v of vectors) for (const [k, w] of Object.entries(v)) sum[k] = (sum[k] || 0) + w / vectors.length;
  return normalized(sum);
}

/**
 * Rytterens evner mod en vektor, urundet 0-100. Samme regning og samme
 * nøgle-rækkefølge som frontend/src/lib/suitability.js (låst af testen).
 */
export function routeMatchRaw(abilities, vector) {
  if (!abilities || !vector) return null;
  let raw = 0, denom = 0;
  for (const k of ROUTE_MATCH_ABILITY_KEYS) {
    const w = Number(vector[k]);
    if (!Number.isFinite(w) || w <= 0) continue;
    const v = Number(abilities?.[k]) || 0;
    raw += (v / ABILITY_MAX) * w;
    denom += w;
  }
  return denom > 0 ? (raw / denom) * 100 : null;
}

/** Afrundet 0-100 eller null. */
export function routeMatchScore(abilities, vector) {
  const raw = routeMatchRaw(abilities, vector);
  return raw == null ? null : Math.round(raw);
}

/**
 * Ét opslag til kaldstederne: løbets vektor + etapevektorer pr. stage_number,
 * og funktioner der giver rytterens tal. Etapetal og løbstal kommer altid herfra.
 * @param {{race?: object, stages: Array<object>, revision?: string}} args
 */
export function buildRouteMatch({ race = null, stages = [], revision = null }) {
  const rev = revision ?? routeMatchRevisionFor(race);
  const sorted = [...(stages || [])].sort((a, b) => (a.stage_number ?? 0) - (b.stage_number ?? 0));
  const stageVectors = sorted.map((s) => ({ stage_number: s.stage_number, vector: stageRouteVector(s, rev) }));
  const raceVector = raceRouteVector(sorted, rev);
  return {
    revision: rev,
    modelVersion: ROUTE_MATCH_MODEL_VERSION,
    raceVector,
    stageVectors,
    /** Løbstallet (0-100) eller null. */
    race(abilities) { return routeMatchScore(abilities, raceVector); },
    /** Etapetal i etape-rækkefølge (samme orden som `stages` sorteret på stage_number). */
    stagesList(abilities) { return stageVectors.map((s) => routeMatchScore(abilities, s.vector)); },
    /** Etapetal nøglet på stage_number. */
    stagesByNumber(abilities) {
      const out = {};
      for (const s of stageVectors) {
        const v = routeMatchScore(abilities, s.vector);
        if (v != null && s.stage_number != null) out[s.stage_number] = v;
      }
      return out;
    },
  };
}

/** Kun til tests: er nøglen en rute-match-evne? */
export function isRouteMatchAbility(key) {
  return KEY_SET.has(key);
}
