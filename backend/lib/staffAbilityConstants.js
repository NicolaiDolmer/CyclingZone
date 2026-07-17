// Staff-evne-model SSOT (#2216 A4). Ingen I/O — ren konstant-/mapping-modul.
// Spejler rytter-evne-taksonomien: de 3 coaching-DIMENSIONER (physical/mental/technical)
// partitionerer de 15 synlige rytter-evner (abilityDerivation.VISIBLE_ABILITIES) præcist,
// så en trænings-chefs dimension direkte matcher hvilke rytter-evner han løfter.
// Drift-guard-test (staffAbilityConstants.test.js) asserterer union == abilityDerivation.VISIBLE_ABILITIES.

// De 5 staff-roller (§1). training = den fulde dimension×niveau-model; øvrige = rolle-akser.
export const STAFF_ROLES = Object.freeze(["training", "scouting", "medical", "academy", "commercial"]);

// Niveau-affiniteter — en trænings-chef kan specialisere sig i en alders-fase.
// #2529 (ejer-beslutning Discord 16/7): "youth" + "junior" kollapset til ÉT "u23"-bånd
// (spillere kunne ikke finde forklaringen, og koden matchede ikke ejerens egen
// beskrivelse). Kaldes "coaching group"/"trænings-gruppe" i UI-tekster — IKKE
// "tier" — for ikke at kollidere med #2492's tre-tier KLUBSTRUKTUR
// (Senior/U23/Junior), som er noget andet (klub-niveau, ikke trænings-affinitet).
export const LEVEL_BANDS = Object.freeze(["u23", "senior"]);

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

// Alders-bånd → niveau (#2529: youth+junior kollapset til u23 — ≤25 = u23, 26+ = senior).
// `is_academy` beholdes i signaturen for bagud-kompatibilitet med eksisterende
// kald-steder (fx dailyTrainingEngine.js), men påvirker ikke længere resultatet:
// bånd-kollapset gør skellet mellem akademi/ikke-akademi irrelevant for coaching-gruppen.
export function riderLevelBand({ age } = {}) {
  return age >= 26 ? "senior" : "u23";
}

// Graceful læsning af PERSISTEREDE staff-evne-niveauer fra FØR #2529-migrationen
// (staff_derived_abilities.levels med gamle "youth"/"junior"-nøgler). Migrationen
// (database/2026-07-17-staff-u23-band.sql) committes men applies ALDRIG automatisk
// (ejer-apply, jf. AGENTS.md) — i vinduet mellem merge og apply kan DB-rækker stadig
// have det gamle format. Denne funktion tåler BEGGE tilstande: allerede migreret
// (kun u23/senior) → uændret pass-through; gammelt format (youth/junior/senior) →
// u23 = MAX(youth, junior) (se migrationens PR-body for begrundelse).
export function normalizeLevelBands(levels) {
  if (!levels || typeof levels !== "object") return levels ?? {};
  if (!("youth" in levels) && !("junior" in levels)) return levels;
  const youth = Number.isFinite(levels.youth) ? levels.youth : undefined;
  const junior = Number.isFinite(levels.junior) ? levels.junior : undefined;
  const u23 = youth != null && junior != null
    ? Math.max(youth, junior)
    : (youth ?? junior);
  const out = { ...levels };
  delete out.youth;
  delete out.junior;
  if (u23 != null) out.u23 = u23;
  return out;
}

// Dimensionen for en given ability (eller undefined hvis ukendt/skjult).
export function dimensionOf(ability) {
  return ABILITY_TO_DIMENSION[ability];
}
