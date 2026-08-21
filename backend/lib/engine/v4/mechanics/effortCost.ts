// backend/lib/engine/v4/mechanics/effortCost.ts
// Race Engine v4 F3 (#4030 M12): effort-styring (protect/normal/save fra
// TeamOrder/Entrant.effort) modulerer work-cost/W'-forbrug i fysiologi-ticket.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M12 ("Effort-styring pr. rytter pr. etape") + §8 beslutning 14 (fuld
// effort-pakke fra start).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random (ingen rng
// overhovedet: effort-modulationen er et rent taerskel-lookup, ikke stoej).
//
// Kontrakt (opgave-brief): "effortFatigueMultiplier-moensteret fra
// backend/lib/raceRoles.js genimplementeres RENT i v4 (laes raceRoles.js
// foerst, kopier ikke - genimplementer som ren funktion)." raceRoles.js's
// effortFatigueMultiplier(effort) returnerer RACE_V3_TUNING's
// FATIGUE_MULTIPLIER_PROTECT/_SAVE/_NORMAL (1.2/0.7/1.0) — protect (arbejder
// FOR holdet: leadout, tempo-traek, beskytter kaptajnen) koster ekstra
// belastning, save (koerer inden for sig selv) koster mindre, normal er
// uaendret. v4-genimplementeringen ANKRER paa DE SAMME tre startvaerdier
// (samme kalibrerings-praecedens: v3-tallene er allerede spillet ind mod
// virkelige etaper), som `tuning.ts`'s EFFORT_COST_EXTRA_TUNING (additiv
// tuning-flade, samme moenster som FINALE_EXTRA_TUNING) — v4 importerer
// ALDRIG raceRoles.js (renheds-graensen).
//
// WIRING-BEHOV (denne fil roerer IKKE segmentLoop.ts/physiology.ts — orkestra-
// toren wirer hooken ind): segmentLoop.ts's `tickGroupRiders` beregner i dag
// `demand = baseDemand * positionFactor` (positionFactor = front-/draftFactor
// fra tuning.work) foer den kaldes ind i physiology.tickPhysiology. Wiring-
// punktet er PRAECIS dér: gang `demand` med
// `effortDemandMultiplier(entrant.effort)` FOER tick-kaldet (eller kald
// `applyEffortToDemand(demand, entrant.effort)` direkte), saa en 'protect'-
// rytter braender W' hurtigere/krydser CP oftere (betaler for holdarbejdet),
// og en 'save'-rytter braender langsommere. F2's segmentLoop behandler alle
// entrants som 'normal' (f2-core-design.md §2), saa denne modulator er INERT
// (multiplikator 1.0 for alle) indtil wiret ind — ingen eksisterende adfaerd
// aendres af blot at tilfoeje denne fil.

import type { EffortLevel } from "../types.ts";
import { EFFORT_COST_EXTRA_TUNING } from "../tuning.ts";

/**
 * Tuning-formen EFFORT_COST_EXTRA_TUNING (tuning.ts) implementerer. Holdt her
 * (ikke i types.ts, som er frosset og kun aendres af arkitekten) saa
 * funktionerne nedenfor har en navngiven, testbar parameter-type.
 */
export type EffortCostTuning = {
  demandMultiplierProtect: number; // >1: beskytter/traekker for holdet koster ekstra effekt-krav (raceRoles FATIGUE_MULTIPLIER_PROTECT-anker)
  demandMultiplierNormal: number; // =1: baseline, ingen modulation
  demandMultiplierSave: number; // <1: koerer bevidst inden for sig selv (raceRoles FATIGUE_MULTIPLIER_SAVE-anker)
};

export { EFFORT_COST_EXTRA_TUNING as EFFORT_COST_TUNING };

/**
 * effortFatigueMultiplier-moensteret (raceRoles.js), ren v4-genimplementering:
 * effort-niveauet lookes op til en effekt-krav-multiplikator. Ingen rng, ingen
 * afhaengighed af rytter-tilstand — REN funktion af effort alene, saa den er
 * triviel at property-teste (samme multiplikator for samme effort, uanset
 * kalde-kontekst) og trivielt determinismesikker.
 */
export function effortDemandMultiplier(
  effort: EffortLevel,
  tuning: EffortCostTuning = EFFORT_COST_EXTRA_TUNING,
): number {
  if (effort === "protect") return tuning.demandMultiplierProtect;
  if (effort === "save") return tuning.demandMultiplierSave;
  return tuning.demandMultiplierNormal;
}

/**
 * Modifier-hook (wiring-signatur til orkestratoren): tager den effekt-krav
 * (`demand`) segmentLoop.ts allerede har udregnet for en rytter i dette
 * segment (baseDemand * positionFactor, foer physiology-tick'et) og
 * returnerer den effort-modulerede vaerdi. REN — ingen mutation, intet
 * sidevirkning; `demand < 0` clampes forsvarsmaessigt til 0 (effekt-krav kan
 * aldrig vaere negativt), men multiplikatoren selv aendrer ALDRIG fortegn
 * (protect/save/normal skalerer altid samme ikke-negative demand op/ned).
 */
export function applyEffortToDemand(
  demand: number,
  effort: EffortLevel,
  tuning: EffortCostTuning = EFFORT_COST_EXTRA_TUNING,
): number {
  const safeDemand = Math.max(0, demand);
  return safeDemand * effortDemandMultiplier(effort, tuning);
}
