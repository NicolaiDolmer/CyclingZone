// Staff-evne-model SSOT (#2216 A4). Ingen I/O — ren konstant-/mapping-modul.
// Spejler rytter-evne-taksonomien: de 3 coaching-DIMENSIONER (physical/mental/technical)
// partitionerer de 15 synlige rytter-evner (abilityDerivation.VISIBLE_ABILITIES) præcist,
// så en trænings-chefs dimension direkte matcher hvilke rytter-evner han løfter.
// Drift-guard-test asserterer union == VISIBLE_ABILITIES.
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// De 5 staff-roller (§1). training = den fulde dimension×niveau-model; øvrige = rolle-akser.
export const STAFF_ROLES = Object.freeze(["training", "scouting", "medical", "academy", "commercial"]);

// Niveau-affiniteter — en trænings-chef kan specialisere sig i en alders-fase.
export const LEVEL_BANDS = Object.freeze(["youth", "junior", "senior"]);

// Dimension → hvilke af de 15 VISIBLE_ABILITIES den dækker. Præcis partition (drift-guard).
// physical(10): fysiologi-drevne disciplin-evner. mental(2): aggression/tactics.
// technical(3): descending/cobblestone/positioning.
export const DIMENSION_TO_ABILITIES = Object.freeze({
  physical: ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"],
  mental: ["aggression", "tactics"],
  technical: ["descending", "cobblestone", "positioning"],
});

// Ability → dens dimension (afledt opslag; bygget fra DIMENSION_TO_ABILITIES).
export const ABILITY_TO_DIMENSION = Object.freeze(
  Object.entries(DIMENSION_TO_ABILITIES).reduce((acc, [dim, abilities]) => {
    for (const ab of abilities) acc[ab] = dim;
    return acc;
  }, {}),
);

// Afledt kvalitets-bånd pr. tier (overall-interval kandidaten trækkes inden for).
// Monotont stigende 1→5. Kalibreres i harness (Task 8).
export const TIER_OVERALL_BAND = Object.freeze({
  1: { lo: 28, hi: 44 },
  2: { lo: 40, hi: 56 },
  3: { lo: 52, hi: 68 },
  4: { lo: 63, hi: 79 },
  5: { lo: 72, hi: 90 },
});

// Alders-bånd → niveau (grunding: is_academy 16–21 = youth; 22–25 = junior; 26+ = senior).
export function riderLevelBand({ is_academy, age } = {}) {
  if (is_academy && age <= 21) return "youth";
  if (age >= 26) return "senior";
  return "junior";
}

// Dimensionen for en given ability (eller undefined hvis ukendt/skjult).
export function dimensionOf(ability) {
  return ABILITY_TO_DIMENSION[ability];
}
