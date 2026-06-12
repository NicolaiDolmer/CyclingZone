// backend/lib/raceAutopick.js
// #1307: assistent-autopick — fornuftigt 6-8-rytter-hold + kaptajn når manageren
// ikke selv har udtaget. Ren funktion (ingen DB); raceRunner kalder med beriget data.
// Egnethed = gennemsnitlig terrain-score over løbets etapeprofiler, let dæmpet af
// træthed (assistenten skåner smadrede ryttere). Deterministisk (stabil tiebreak).

import { terrainScore } from "./raceSimulator.js";

// Spec 8.1: 6-8 pr. løb, kategori-afhængigt. Grand Tours kører fulde hold på 8.
// nøgler = race_class-værdier fra races-tabellen (DB-enum)
export const SELECTION_SIZE = Object.freeze({
  default: Object.freeze({ min: 6, max: 8 }),
  TourFrance: Object.freeze({ min: 8, max: 8 }),
  GiroVuelta: Object.freeze({ min: 8, max: 8 }),
});

export function selectionSizeForRace(race) {
  return SELECTION_SIZE[race?.race_class] || SELECTION_SIZE.default;
}

const AUTOPICK_FATIGUE_DAMPING = 0.3; // træthed 100 → egnethed × 0.7

export function suitabilityScore(abilities, stages) {
  if (!stages?.length) return 0;
  let sum = 0;
  for (const s of stages) sum += terrainScore(abilities, s.demand_vector || {});
  return sum / stages.length;
}

// Flade etaper (sprint-stages) bruges ikke til GC-captain-udvælgelse.
// Captain = bedst på non-sprint etaper (bjerg/TT/etc.); sprint_captain = bedste
// sprinter på flat stages der ikke allerede er captain.
const FLAT_PROFILES = new Set(["flat"]);

function gcStages(stages) {
  const nonFlat = stages.filter((s) => !FLAT_PROFILES.has(s.profile_type));
  return nonFlat.length ? nonFlat : stages; // fallback: brug alle hvis kun flade
}

/**
 * @param {{riders:Array<{rider_id:string, abilities:object, fatigue?:number}>, stages:Array, sizeRule:{min:number,max:number}}} args
 * @returns {Array<{rider_id:string, race_role:string}>} tom hvis ingen ryttere.
 */
export function autopickTeamSelection({ riders = [], stages = [], sizeRule }) {
  const rule = sizeRule || SELECTION_SIZE.default;

  // Samlet egnethed (alle etaper) bruges til holdudvælgelsen.
  const scored = riders
    .filter((r) => r?.rider_id && r.abilities)
    .map((r) => {
      const raw = Number(r.fatigue);
      const clampedFatigue = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) / 100 : 0;
      const freshness = 1 - clampedFatigue * AUTOPICK_FATIGUE_DAMPING;
      return { rider_id: r.rider_id, abilities: r.abilities, score: suitabilityScore(r.abilities, stages) * freshness };
    })
    .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)));

  const picked = scored.slice(0, Math.min(rule.max, scored.length));
  if (!picked.length) return [];

  // Captain = bedst egnede på GC-etaper (non-flat); sprint og flad-topspeedvinding
  // hører til sprint_captain. Tiebreak: rider_id-rækkefølge.
  const gcStagesToUse = gcStages(stages);
  const captainId = [...picked]
    .sort((a, b) =>
      suitabilityScore(b.abilities, gcStagesToUse) - suitabilityScore(a.abilities, gcStagesToUse) ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )[0].rider_id;

  // Sprint-kaptajn: kun hvis løbet har flade etaper og feltets bedste sprinter
  // ikke allerede ER kaptajnen (assistenten holder det simpelt).
  let sprintCaptainId = null;
  if (stages.some((s) => FLAT_PROFILES.has(s.profile_type)) && picked.length > 1) {
    const bestSprint = [...picked].sort((a, b) =>
      (Number(b.abilities?.sprint) || 0) - (Number(a.abilities?.sprint) || 0) ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )[0];
    if (bestSprint.rider_id !== captainId) sprintCaptainId = bestSprint.rider_id;
  }

  return picked.map((p) => ({
    rider_id: p.rider_id,
    race_role: p.rider_id === captainId ? "captain"
      : p.rider_id === sprintCaptainId ? "sprint_captain"
      : "helper",
  }));
}
