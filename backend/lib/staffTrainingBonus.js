// #2216 A4 — Task 7: training-effekt-hook (dimension×niveau, kun under caps, no-op uden staff).
//
// Tynd opslags-funktion der oversætter en holds trænings-chef + en rytters (evne, niveau)
// til ÉN multiplikator ≥ 1.0, som dailyAbilityDelta ganger ind i sin eksisterende kæde.
// Genbruger de to prod-SSOT-primitiver fra effekt-modellen (Task 6):
//   • specializationMatch(staff, {dimension, level})  (facilityEngine.js) — dimension×niveau-match
//   • dimensionOf(ability)                            (staffAbilityConstants.js) — evne → dimension
//
// Design-invarianter:
//   1) NUL REGRESSION: staff==null ELLER ingen trænings-facilitet (facilityTier null/0) → 1.0.
//      dailyAbilityDelta's default (staff=null) rammer denne sti → bit-identisk uden staff.
//   2) TRÆNING STRAFFER ALDRIG: kun en ÆGTE specialiserings-fordel (match > 1.0) løfter bonussen.
//      max(0, match − 1) betyder at en under-baseline akse-kombi (dimension- eller niveau-miss)
//      giver præcis 1.0 — aldrig < 1.0. En chef gør en rytter bedre eller neutral, aldrig værre.
//   3) KUN DAGLIG DELTA: bonussen skalerer delta'en; cap-loopet i dailyTrainingEngine.js klipper
//      stadig hver evne ved ability_caps. Bonussen kan ALDRIG udvide et cap (bevist i test).
import { specializationMatch, effectiveBonus } from "./facilityEngine.js";
import { dimensionOf } from "./staffAbilityConstants.js";

// ── Plan B (#1441 pre-flip engine-slice): facilitets-MAGNITUDE på træning ──────────
// Spec §2.1: Træningscenter = "træningseffekt-bonus (multiplikator på eksisterende
// trænings-motor)". Multiplikatoren er præcis den effectiveBonus UI'et viser
// (FACILITY_BASE_EFFECT.training[tier] × staffEffectFactor(staff)) — så "Effect 8.3%
// training" på Klub-fladen betyder bogstaveligt +8,3% på den daglige trænings-delta.
// Adskilt fra staffTrainingBonus (specialisering, per-rytter) fordi de to led har
// forskellig semantik: magnitude = facilitet+chef-kvalitet (ens for hele truppen);
// specialisering = dimension×niveau-match (varierer pr. rytter-evne).
// Nul regression: facilityTier null/0 → base 0 → multiplikator PRÆCIS 1.0.
// Caps udvides ALDRIG: leddet skalerer kun daglig delta; cap-loopet klipper stadig.
export function facilityTrainingMultiplier({ facilityTier, staff } = {}) {
  return 1 + effectiveBonus("training", facilityTier ?? 0, staff ?? null);
}

// Kalibrerings-konstanter (named-config, så harnesset i Task 8 kan sweepe dem uden at røre
// call-sites). k = global styrke på specialiserings-fordelen; facilityScale = pr.-tier-vægt
// (bedre facilitet → chefens specialisering slår mere igennem). Konservative start-værdier;
// Task 8 kalibrerer dem mod scorecardet — de justeres IKKE her.
export const STAFF_TRAINING_BONUS_CONFIG = Object.freeze({
  k: 0.5,
  facilityScale: Object.freeze({ 0: 0, 1: 0.5, 2: 0.65, 3: 0.8, 4: 0.9, 5: 1.0 }),
});

/**
 * Trænings-multiplikator for én (rytter-evne, rytter-niveau) givet holdets trænings-chef.
 *
 * @param {object}      args
 * @param {number|null} args.facilityTier — holdets trænings-facilitets-tier (0/null = ingen).
 * @param {object|null} args.staff        — den afledte staff-profil (dimensions/levels/overall) el. null.
 * @param {string}      args.ability      — rytter-evnen der trænes (fx "climbing").
 * @param {string}      args.riderLevel   — rytterens niveau-bånd ("youth"|"junior"|"senior").
 * @returns {number} multiplikator ≥ 1.0 (1.0 = ingen effekt / nul regression).
 */
export function staffTrainingBonus({ facilityTier, staff, ability, riderLevel } = {}) {
  // (1) Nul regression: ingen chef ELLER ingen trænings-facilitet → ingen effekt.
  if (staff == null) return 1.0;
  const scale = STAFF_TRAINING_BONUS_CONFIG.facilityScale[facilityTier] ?? 0;
  if (scale <= 0) return 1.0;

  // dimension×niveau-match fra Task 6-primitiven. Generalist / manglende akse → 1.0.
  const dimension = dimensionOf(ability);
  const match = specializationMatch(staff, { dimension, level: riderLevel });

  // (2) Kun ægte fordel løfter (match > 1.0); miss → advantage 0 → bonus præcis 1.0.
  const advantage = Math.max(0, match - 1);
  return 1 + STAFF_TRAINING_BONUS_CONFIG.k * advantage * scale;
}
