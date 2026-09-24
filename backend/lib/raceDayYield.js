// #4850 · Udbytte paa loebsdagen, variant A (ejer-beslutning 24/9, spec
// docs/drafts/spec-lobsdag-udbytte-2026-09-24.md).
//
// Ejerens ord: "etapens profil (bjergetape → klatring, flad → spurt/fladt,
// enkeltstart → tempo osv.) i et fast tempo svarende til et 'mellem'-
// traeningspas, under reglen maks +1 pr. evne pr. dag. Planen er IKKE input."
//
// Derfor er loebsdagen her et PROGRAM, ikke en ny udviklings-model: et
// mellem-pas (`normal`, focusGrowthMult 1,35) hvis fokus-evner er etapens
// profil-evner (RACE_PROFILE_ABILITY_MAP). Programmet koeres gennem den
// eksisterende `applyDailyTick`, saa loebsdagen arver hele kaeden (alder,
// potentiale, rolle-rate, traeningsscore-kobling, staff, fremdrifts-bar med
// carry-over og +1-loftet) uden en eneste kopi af formlen.
//
// Rytterens plan indgaar ikke: programmet bygges KUN af profilen. Motoren
// (dailyTrainingEngine.js, spor C2) sender dette program i stedet for planens
// paa en udviklings-loebsdag, bag race_day_development_enabled.
//
// Variant B (dagens intention, #4632) laegges senere ovenpaa som modifikator.

import { RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";

// Fokus-noeglen loebsdagens program baerer. Den findes bevidst IKKE i
// TRAINING_FOCUSES: den kan ikke vaelges som session i en plan, og
// abilityMult/trainingScore laeser `focusAbilities` i stedet.
export const RACE_DAY_FOCUS = "race_day";

// Profilen en ukendt eller manglende etape falder tilbage til (samme fallback
// som motoren bruger i dag, dailyTrainingEngine.js).
export const RACE_DAY_FALLBACK_PROFILE = "rolling";

// Standard = det ejeren besluttede 24/9. Simuleringen (raceDayYieldSim4850.mjs)
// injicerer andre vaerdier for at vise alternativerne.
//   intensity        "normal" = mellem-passet
//   includeOffFocus  true = de oevrige evner faar off-fokus-vaeksten (0,35) som
//                    ved ethvert rigtigt pas; false = kun profil-evnerne
export const RACE_DAY_YIELD_CONFIG = Object.freeze({
  intensity: "normal",
  includeOffFocus: true,
});

/** Profil-evnerne for en etape-profil; ukendt profil → rolling. */
export function raceDayFocusAbilities(profileType) {
  return RACE_PROFILE_ABILITY_MAP[profileType] ?? RACE_PROFILE_ABILITY_MAP[RACE_DAY_FALLBACK_PROFILE];
}

/**
 * Loebsdagens program til `applyDailyTick`.
 *
 * @param {string|null|undefined} profileType  race_stage_profiles.profile_type
 * @param {{ intensity?: string, includeOffFocus?: boolean }} [cfg]
 * @returns {{ focus: string, intensity: string, focusAbilities: readonly string[], offFocus?: false }}
 */
export function raceDayProgram(profileType, cfg = RACE_DAY_YIELD_CONFIG) {
  const intensity = cfg?.intensity ?? RACE_DAY_YIELD_CONFIG.intensity;
  const includeOffFocus = cfg?.includeOffFocus ?? RACE_DAY_YIELD_CONFIG.includeOffFocus;
  const program = {
    focus: RACE_DAY_FOCUS,
    intensity,
    focusAbilities: raceDayFocusAbilities(profileType),
  };
  if (!includeOffFocus) program.offFocus = false;
  return Object.freeze(program);
}
