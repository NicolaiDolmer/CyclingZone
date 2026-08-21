// backend/lib/engine/v4/mechanics/distanceFatigue.ts
// Race Engine v4 F3 (#4030 M7): distance-slid.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M7 ("Distance-slid: monument-effekt (250 km+ dræner finalen) + dag-til-
// dag-slid i etapeløb, baaret af endurance") + §8 beslutning 12 (begge dele,
// baaret af endurance).
//
// To UAFHAENGIGE CP-modifikatorer, begge rene funktioner:
//  (a) monumentDrainFraction/distanceFatigueCpMultiplier: km-tilbagelagt >
//      ~250 km draener CP GRADVIST (glidende rampe, ikke et spring) — mildnet
//      af rytterens endurance-evne ("baaret af endurance", mor-spec §4 M7).
//  (b) conditionCpMultiplier: dag-til-dag-slid via Entrant.condition (0-1,
//      allerede baaret som felt paa Entrant-kontrakten, jf. types.ts's
//      kommentar "M7 forbruger i F3; F2 baerer feltet") — lavere condition =
//      lavere effektiv CP denne etape.
//
// Tuning-vaerdierne bor i tuning.ts's DISTANCE_FATIGUE_EXTRA_TUNING (additiv,
// samme moenster som FINALE_EXTRA_TUNING/EFFORT_COST_EXTRA_TUNING) — denne
// fil eksporterer selve mekanikken, ikke tallene.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random/rng
// overhovedet (begge modifikatorer er deterministiske funktioner af km/
// evne/condition, ikke stoej).
//
// MONOTONI: begge multiplikatorer er >= 0 og skalerer CP'en ENSARTET —
// distanceFatigueCpMultiplier er ALDRIG stigende i km (jo laengere etapen har
// vaeret i gang, jo mere/lige meget draening, aldrig mindre), og er svagt
// STIGENDE i endurance-evnen ved samme km (bedre endurance mildner altid,
// aldrig forvaerrer, draeningen). conditionCpMultiplier er svagt stigende i
// condition. Ingen af funktionerne kan derfor invertere en rytters relative
// CP-rangering paa den evne der testes (endurance) inden for samme km/condition
// — samme "monotoni, ikke bare gaettet"-standard som climbSelection.ts/
// descent.ts (mor-spec §3.2 haardt krav gaelder principielt kun INDEN FOR en
// gruppe pr. segment, men modifikatoren er konstrueret saa den aldrig
// modarbejder det, hvis/naar den wires ind i segmentLoop's cp-udregning).
//
// WIRING-BEHOV (denne fil roerer IKKE segmentLoop.ts/physiology.ts —
// orkestratoren wirer hooken ind): segmentLoop.ts's `riderCpForSegment`
// beregner i dag `baseCp = deriveCp(...); return baseCp + riderState.dayform`.
// Wiring-punktet er PRAECIS dér: efter deriveCp() og FOER dayform laegges til,
// gang baseCp med `applyDistanceFatigueToCp(baseCp, { kmSoFar: state.km,
// enduranceAbility: entrant.abilities.endurance, condition: entrant.condition
// })`. `state.km` (segmentLoop's cursor, opdateret til `segment.to_km` ved
// segmentets slutning) er den naturlige "km tilbagelagt saa vidt"-vaerdi ved
// segmentets INDGANG — samme moenster som computeGroupTempo's eksisterende
// brug af segment-graenser. F2's segmentLoop kalder ALDRIG denne fil i dag,
// saa modifikatoren er INERT (multiplikator 1.0 for alle) indtil wiret ind.

import { DISTANCE_FATIGUE_EXTRA_TUNING } from "../tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Ability-vaerdier er 0-99 (abilityRegistry-skala) — samme normalisering som
// physiology.ts's normAbility (dupliceret lokalt: physiology.ts eksporterer
// den ikke, og denne fil maa ikke aendre physiology.ts for at faa den
// eksponeret — samme praecedens som finale.ts's egen normAbility-kopi).
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

/**
 * Tuning-formen DISTANCE_FATIGUE_EXTRA_TUNING (tuning.ts) implementerer.
 * Holdt her (ikke i types.ts, som er frosset og kun aendres af arkitekten)
 * saa funktionerne nedenfor har en navngiven, testbar parameter-type.
 */
export type DistanceFatigueTuning = {
  monumentThresholdKm: number; // km hvor monument-draeningen begynder (mor-spec §4 M7: "~250 km"; sat lidt under saa rampen naar sit maks INDEN maal paa en 250 km+ etape)
  monumentRampKm: number; // km-vindue draeningen naar sit maks over, efter threshold (glidende rampe, ikke et spring)
  monumentMaxCpPenalty: number; // maks CP-reduktion (fraktion, 0-1) ved/efter rampens slutning, FOER endurance-mildning
  monumentEnduranceMitigation: number; // 0-1: hvor stor en andel af draeningen fuld endurance-evne (99) mildner (1 = fuld mildning, 0 = ingen mildning)
  conditionFloorMultiplier: number; // CP-multiplikator ved condition=0 (vaerst taenkelige dag-til-dag-slid); condition=1 => multiplikator 1
};

export { DISTANCE_FATIGUE_EXTRA_TUNING as DISTANCE_FATIGUE_TUNING };

/**
 * Monument-draenings-FRAKTION (0-1, FOER endurance-mildning) ved en given
 * km-position: 0 under threshold, lineaer rampe [0, monumentMaxCpPenalty]
 * over monumentRampKm, derefter fladt ud paa monumentMaxCpPenalty. ALDRIG
 * faldende i km (haardt krav: laengere etape kan aldrig give MINDRE draening).
 */
export function monumentDrainFraction(kmSoFar: number, tuning: DistanceFatigueTuning): number {
  const km = Math.max(0, kmSoFar);
  if (km <= tuning.monumentThresholdKm) return 0;
  const rampKm = Math.max(1e-6, tuning.monumentRampKm);
  const progress = clamp((km - tuning.monumentThresholdKm) / rampKm, 0, 1);
  return progress * Math.max(0, tuning.monumentMaxCpPenalty);
}

/**
 * Monument-CP-multiplikator (0-1] for én rytter ved en given km-position:
 * draenings-fraktionen mildnet af rytterens endurance-evne (§4 M7: "baaret af
 * endurance"). Svagt STIGENDE i endurance ved fastholdt km (bedre endurance
 * mildner altid, aldrig forvaerrer, draeningen) og ALDRIG stigende i km ved
 * fastholdt endurance.
 */
export function distanceFatigueCpMultiplier(
  kmSoFar: number,
  enduranceAbility: number,
  tuning: DistanceFatigueTuning = DISTANCE_FATIGUE_EXTRA_TUNING,
): number {
  const drain = monumentDrainFraction(kmSoFar, tuning);
  if (drain <= 0) return 1;
  const mitigation = clamp(tuning.monumentEnduranceMitigation, 0, 1) * normAbility(enduranceAbility);
  const effectiveDrain = clamp(drain * (1 - mitigation), 0, 1);
  return clamp(1 - effectiveDrain, 0, 1);
}

/**
 * Dag-til-dag-slid-CP-multiplikator (0-1] ud fra Entrant.condition (0-1,
 * allerede en del af Entrant-kontrakten). Lineaer interpolation mellem
 * conditionFloorMultiplier (condition=0) og 1 (condition=1) — svagt STIGENDE
 * i condition, aldrig faldende.
 */
export function conditionCpMultiplier(
  condition: number,
  tuning: DistanceFatigueTuning = DISTANCE_FATIGUE_EXTRA_TUNING,
): number {
  const c = Number.isFinite(condition) ? clamp(condition, 0, 1) : 1;
  const floor = clamp(tuning.conditionFloorMultiplier, 0, 1);
  return floor + (1 - floor) * c;
}

/**
 * Modifier-hook (wiring-signatur til orkestratoren, se filens toppe-
 * kommentar): kombinerer begge M7-delmekanikker til ÉN multiplikator der
 * ganges paa en rytters segment-CP (FOER dayform laegges til, jf.
 * segmentLoop.riderCpForSegment). REN — ingen mutation, intet sidevirkning.
 * Multiplikatoren er altid i (0,1] (kan reducere CP, aldrig forstaerke den —
 * "slid" laegger aldrig energi TIL en rytter).
 */
export function applyDistanceFatigueToCp(
  baseCp: number,
  args: { kmSoFar: number; enduranceAbility: number; condition: number },
  tuning: DistanceFatigueTuning = DISTANCE_FATIGUE_EXTRA_TUNING,
): number {
  const distanceMult = distanceFatigueCpMultiplier(args.kmSoFar, args.enduranceAbility, tuning);
  const conditionMult = conditionCpMultiplier(args.condition, tuning);
  return Math.max(0, baseCp * distanceMult * conditionMult);
}
