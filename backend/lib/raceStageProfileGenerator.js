// Race Engine light-motor (#1102), slice 1 — deterministisk stage-profil-generator.
//
// Eneste sandhedskilde for hvordan et løb får sine etaper + terræn. Ren funktion:
//   (race, {seed}) → [{ stage_number, profile_type, finale_type, demand_vector }]
// Ingen DB/fs. backend/scripts/backfillRaceStageProfiles.js persisterer output i
// race_stage_profiles; race-simulatoren (slice 2) scorer rider_derived_abilities
// mod demand_vector.
//
// Determinisme: seed = stableSeed(race.id) (override via opts.seed i test), kørt
// gennem makeRng (mulberry32, genbrugt fra fictionalRiderGenerator.js). Samme løb
// → samme etaper hver gang, så resultater er reproducerbare.
//
// demand_vector: normaliserede vægte (sum 1.0) over de 10 rider_derived_abilities-
// kolonner + 'randomness' (variations-skalar brugt af simulatoren). Vægtene er
// launch-defaults — centraliseret her, så de er ÉT sted at tune.

import { makeRng } from "./fictionalRiderGenerator.js";

export const GENERATOR_VERSION = 1;

// rider_derived_abilities-kolonnerne (scoring-dimensioner). demand_vector-nøgler
// skal være ⊆ disse ∪ {"randomness"}.
export const ABILITY_DIMENSIONS = Object.freeze([
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobblestone", "acceleration", "recovery", "tactics", "positioning",
]);

export const PROFILE_TYPES = Object.freeze([
  "flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "ttt", "cobbles", "classic",
]);

export const FINALE_TYPES = Object.freeze([
  "bunch_sprint", "reduced_sprint", "punch", "long_climb", "descent", "solo_tt", "breakaway",
]);

// Normaliserede demand-vektorer pr. terræn (ability-vægte + randomness, sum 1.0).
// Launch-defaults — tunes HER. Nøgler ⊆ ABILITY_DIMENSIONS ∪ {randomness}.
export const DEMAND_VECTORS = Object.freeze({
  flat:          Object.freeze({ sprint: 0.62, acceleration: 0.18, positioning: 0.08, endurance: 0.04, randomness: 0.08 }),
  rolling:       Object.freeze({ endurance: 0.22, punch: 0.14, tactics: 0.12, positioning: 0.10, sprint: 0.10, climbing: 0.06, recovery: 0.06, randomness: 0.20 }),
  hilly:         Object.freeze({ punch: 0.48, climbing: 0.06, acceleration: 0.10, endurance: 0.08, positioning: 0.06, sprint: 0.02, randomness: 0.20 }),
  mountain:      Object.freeze({ climbing: 0.56, endurance: 0.16, punch: 0.04, recovery: 0.08, tactics: 0.04, positioning: 0.02, randomness: 0.10 }),
  high_mountain: Object.freeze({ climbing: 0.54, endurance: 0.20, punch: 0.04, recovery: 0.08, tactics: 0.04, randomness: 0.10 }),
  itt:           Object.freeze({ time_trial: 0.60, positioning: 0.28, randomness: 0.12 }),
  ttt:           Object.freeze({ time_trial: 0.50, tactics: 0.18, positioning: 0.14, endurance: 0.12, randomness: 0.06 }),
  cobbles:       Object.freeze({ cobblestone: 0.70, punch: 0.08, positioning: 0.08, endurance: 0.06, randomness: 0.08 }),
  classic:       Object.freeze({ endurance: 0.20, punch: 0.18, climbing: 0.14, cobblestone: 0.12, positioning: 0.08, tactics: 0.06, sprint: 0.04, randomness: 0.18 }),
});

// Plausible finale-typer pr. terræn (display + senere modifier). Første = mest typisk.
const FINALE_BY_PROFILE = Object.freeze({
  flat:          ["bunch_sprint", "reduced_sprint"],
  rolling:       ["breakaway", "reduced_sprint", "bunch_sprint"],
  hilly:         ["punch", "reduced_sprint"],
  mountain:      ["long_climb", "descent"],
  high_mountain: ["long_climb"],
  itt:           ["solo_tt"],
  ttt:           ["solo_tt"],
  cobbles:       ["reduced_sprint", "breakaway"],
  classic:       ["punch", "reduced_sprint", "long_climb"],
});

// Terræn-fordeling for endagsløb (race_type='single'). Afspejler ProSeries-feltet:
// mest flade/kuperede/brosten-klassikere, lejlighedsvis bjergfinale.
const SINGLE_PROFILE_WEIGHTS = Object.freeze([
  { value: "flat", weight: 28 }, { value: "hilly", weight: 26 },
  { value: "rolling", weight: 14 }, { value: "cobbles", weight: 14 },
  { value: "classic", weight: 12 }, { value: "mountain", weight: 6 },
]);

// Filler-terræn til etapeløbs-etaper ud over de garanterede (flad + bjerg).
const STAGE_FILLER_WEIGHTS = Object.freeze([
  { value: "flat", weight: 30 }, { value: "rolling", weight: 24 },
  { value: "hilly", weight: 24 }, { value: "mountain", weight: 14 },
  { value: "high_mountain", weight: 8 },
]);

// "Bygger mod bjergene": lavt = tidlig sprinter-etape, højt = sen klatre-finale.
// Jitter < 1.0 ved ordning omsorterer kun lige-hint-typer (cobbles↔hilly), så
// flad altid er stage 1 og bjerg/high_mountain altid sidst — en bevidst (tunbar)
// grand-tour-form, ikke et tilfælde.
const STAGE_ORDER_HINT = Object.freeze({
  flat: 1, rolling: 2, cobbles: 3, hilly: 3, classic: 4, itt: 5, ttt: 5, mountain: 6, high_mountain: 7,
});

// FNV-1a 32-bit → heltals-seed fra race.id (UUID-streng). Deterministisk.
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it.value;
  }
  return items[items.length - 1].value;
}

function demandVectorFor(profileType) {
  return { ...DEMAND_VECTORS[profileType] };
}

function finaleFor(rng, profileType) {
  const options = FINALE_BY_PROFILE[profileType] || [];
  if (!options.length) return null;
  // Vægt mod den mest typiske (første): ~60% første, ellers uniformt blandt resten.
  if (options.length === 1 || rng() < 0.6) return options[0];
  return pick(rng, options.slice(1));
}

function toStage(rng, profileType, stageNumber) {
  return {
    stage_number: stageNumber,
    profile_type: profileType,
    finale_type: finaleFor(rng, profileType),
    demand_vector: demandVectorFor(profileType),
  };
}

// Endagsløb: ét terræn fra den vægtede fordeling.
function buildSingle(rng) {
  return [toStage(rng, weightedPick(rng, SINGLE_PROFILE_WEIGHTS), 1)];
}

// Etapeløb: multiset af N terræn (garanteret ≥1 flad + ≥1 bjerg; kort TT muligt
// ved N≥5), ordnet "mod klimaks" (sprint tidligt, bjerg sent).
function buildStageRace(rng, stages) {
  const types = ["flat", "mountain"]; // garanterede roller
  if (stages >= 5 && rng() < 0.7) types.push("itt"); // kort TT relevant i længere løb
  while (types.length < stages) types.push(weightedPick(rng, STAGE_FILLER_WEIGHTS));
  types.length = stages; // defensiv trim (garantier kan ikke overstige stages ved stages>=2)

  const ordered = types
    .map((t) => ({ t, key: STAGE_ORDER_HINT[t] + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);

  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1));
}

/**
 * Generér stage-profiler for ét løb (rør ingen DB).
 * @param {{id:string, race_type?:string, stages?:number}} race
 * @param {{seed?:number}} [opts]  override-seed (default: stableSeed(race.id))
 * @returns {Array<{stage_number:number, profile_type:string, finale_type:(string|null), demand_vector:object}>}
 */
export function generateRaceStageProfiles(race, { seed } = {}) {
  if (!race?.id) throw new Error("race.id kræves");
  const isStageRace = race.race_type === "stage_race";
  const stages = isStageRace ? Math.max(2, Number(race.stages) || 2) : 1;
  const rng = makeRng(Number.isInteger(seed) ? seed >>> 0 : stableSeed(String(race.id)));
  return isStageRace ? buildStageRace(rng, stages) : buildSingle(rng);
}
