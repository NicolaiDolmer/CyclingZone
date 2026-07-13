// Season Planner — rytter-egnethed mod en løbsprofil (spec §5.7 egnetheds-tooltip).
//
// Spejl af backend raceSimulator.terrainScore: egnethed = Σ (ability/99 · demand)
// over evne-nøglerne (demand-vektorens "randomness" indgår ikke, det er en støj-
// skala i motoren, ikke en evne). Vi normaliserer med summen af de efterspurgte
// vægte, så en perfekt rytter (alle evner 99) rammer 100 — et aflæseligt 0-100-tal.
// Board'et sender abilities + demandVector; UI'et rangerer + tooltip'er herfra
// (ingen N×M-rangerings-kryds over ledningen). Holdes i sync med backend.

export const SUITABILITY_ABILITY_KEYS = [
  "climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone",
  "acceleration", "recovery", "tactics", "positioning", "flat", "tempo",
  "durability", "aggression", "descending",
];

const ABILITY_MAX = 99;

/**
 * Egnethed for én rytter mod ét løbs demand-vektor.
 * @param {Record<string,number>} abilities  fladet-op evner (climbing, sprint, ...)
 * @param {Record<string,number>|null} demandVector  race_stage_profiles-aggregat
 * @returns {{score:number, contributions:Array<{ability:string, weight:number, value:number, contribution:number}>}}
 */
export function riderSuitability(abilities, demandVector) {
  if (!demandVector || typeof demandVector !== "object") return { score: 0, contributions: [] };
  let raw = 0, denom = 0;
  const contributions = [];
  for (const k of SUITABILITY_ABILITY_KEYS) {
    const w = Number(demandVector[k]);
    if (!Number.isFinite(w) || w <= 0) continue;
    const v = Number(abilities?.[k]) || 0;
    const c = (v / ABILITY_MAX) * w;
    raw += c;
    denom += w;
    contributions.push({ ability: k, weight: w, value: v, contribution: c });
  }
  const score = denom > 0 ? Math.round((raw / denom) * 100) : 0;
  // Sortér efter hvad løbet efterspørger mest (vægt), så tooltip'en "mapper profil →
  // matchende evner" (spec §5.7) læser som løbets krav + rytterens niveau i dem.
  contributions.sort((a, b) => b.weight - a.weight || b.value - a.value);
  return { score, contributions };
}
