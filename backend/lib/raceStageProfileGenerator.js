// Race Engine light-motor (#1102), slice 1 — deterministisk stage-profil-generator.
//
// Eneste sandhedskilde for hvordan et løb får sine etaper + terræn. Ren funktion:
//   (race, {seed}) → [{ stage_number, profile_type, finale_type, demand_vector }]
// Ingen DB/fs. backend/scripts/backfillRaceStageProfiles.js persisterer output i
// race_stage_profiles; race-simulatoren (slice 2) scorer rider_derived_abilities
// mod demand_vector.
//
// Determinisme: seed = stableSeed(seedIdentityFor(race)) (override via opts.seed i
// test), kørt gennem makeRng (mulberry32, genbrugt fra fictionalRiderGenerator.js).
// Seed-NØGLEN er løbets VIRKELIGE identitet (external_id), IKKE den per-pulje/
// per-sæson races-række (race.id): det SAMME rigtige løb skal have det SAMME
// parcours i alle en divisions parallelle puljer ("Division 3 kører samme løb")
// og på tværs af kalender-rebuilds. v1 seedede på race.id, så hver pulje fik sit
// EGET tilfældige parcours i nominelt samme løb (urimeligt for kryds-pulje-
// sammenligning/oprykning) — rettet i v2.
//
// demand_vector: normaliserede vægte (sum 1.0) over de 10 rider_derived_abilities-
// kolonner + 'randomness' (variations-skalar brugt af simulatoren). Vægtene er
// launch-defaults — centraliseret her, så de er ÉT sted at tune.

import { makeRng } from "./fictionalRiderGenerator.js";

// v1: #1102-launch (seedet på race.id). v2 (2026-06-28): seedet på løbets virkelige
// identitet (external_id) via seedIdentityFor — samme løb = samme parcours i alle en
// divisions puljer + på tværs af rebuilds. KUN seed-kilden ændret; terræn-logik +
// demand-vektorer er uændrede. Bump'et stempler regenererede rækker, så de kan skelnes
// fra v1-rækker (ingen runtime-guard afhænger af tallet — kun et persisteret stempel).
export const GENERATOR_VERSION = 2;

// rider_derived_abilities-kolonnerne (scoring-dimensioner). demand_vector-nøgler
// skal være ⊆ disse ∪ {"randomness"}.
export const ABILITY_DIMENSIONS = Object.freeze([
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobblestone", "acceleration", "recovery", "tactics", "positioning",
  // Plan 1 (#1122): matcher ABILITY_KEYS i raceSimulator.js. flat/tempo vægtes
  // i DEMAND_VECTORS nedenfor; durability/aggression/descending loades men
  // vægtes ikke i terrain-scoren (seam/dynamik/finale-modifier).
  "flat", "tempo", "durability", "aggression", "descending",
]);

export const PROFILE_TYPES = Object.freeze([
  "flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "ttt", "cobbles", "classic",
]);

export const FINALE_TYPES = Object.freeze([
  "bunch_sprint", "reduced_sprint", "punch", "long_climb", "descent", "solo_tt", "breakaway",
]);

// Normaliserede demand-vektorer pr. terræn (ability-vægte + randomness, sum 1.0).
// Launch-defaults — tunes HER. Nøgler ⊆ ABILITY_DIMENSIONS ∪ {randomness}.
// Plan 1 (#1122) kandidat-vektorer: tilføjer flat (rouleur/bunch-kraft) + tempo
// (Mid-mountain, 5-15 min) som terræn-kraft, re-normaliseret til sum 1.0. flat
// forbliver underordnet sprint på flad (sprinter ≥90%-mål); tempo underordnet
// climbing i bjerg. Endelig kalibrering låses i race:gate (Plan 1 Task C1).
export const DEMAND_VECTORS = Object.freeze({
  flat:          Object.freeze({ sprint: 0.61, acceleration: 0.15, flat: 0.06, positioning: 0.08, endurance: 0.02, randomness: 0.08 }),
  rolling:       Object.freeze({ endurance: 0.18, flat: 0.12, punch: 0.12, tempo: 0.08, positioning: 0.08, sprint: 0.08, tactics: 0.06, climbing: 0.04, recovery: 0.04, randomness: 0.20 }),
  hilly:         Object.freeze({ punch: 0.44, tempo: 0.10, acceleration: 0.08, climbing: 0.06, endurance: 0.06, positioning: 0.04, sprint: 0.02, randomness: 0.20 }),
  mountain:      Object.freeze({ climbing: 0.50, tempo: 0.12, endurance: 0.14, recovery: 0.06, punch: 0.04, tactics: 0.02, positioning: 0.02, randomness: 0.10 }),
  high_mountain: Object.freeze({ climbing: 0.52, endurance: 0.18, tempo: 0.08, recovery: 0.06, punch: 0.04, tactics: 0.02, randomness: 0.10 }),
  itt:           Object.freeze({ time_trial: 0.58, positioning: 0.24, flat: 0.06, randomness: 0.12 }),
  ttt:           Object.freeze({ time_trial: 0.50, tactics: 0.18, positioning: 0.14, endurance: 0.12, randomness: 0.06 }),
  cobbles:       Object.freeze({ cobblestone: 0.66, flat: 0.08, punch: 0.06, positioning: 0.06, endurance: 0.06, randomness: 0.08 }),
  classic:       Object.freeze({ endurance: 0.18, punch: 0.16, climbing: 0.12, cobblestone: 0.10, tempo: 0.06, flat: 0.06, positioning: 0.06, tactics: 0.04, sprint: 0.04, randomness: 0.18 }),
});

// Plausible finale-typer pr. terræn (display + senere modifier). Første = mest typisk.
// #1021 Fase 1: finale_type driver udbruds-bonussen. mellembjerg (mountain) er
// descent-domineret (transition/nedkørsels-finish = udbruds-venlig; de store summit-
// finaler hører til high_mountain); hilly får et breakaway-alternativ; high_mountain
// er summit-domineret men kan ramme en descent (lang bjergdag der ikke slutter opad).
// finaleFor vægter første element ~60%.
const FINALE_BY_PROFILE = Object.freeze({
  flat:          ["bunch_sprint", "reduced_sprint"],
  rolling:       ["breakaway", "reduced_sprint", "bunch_sprint"],
  hilly:         ["punch", "reduced_sprint", "breakaway"],
  mountain:      ["descent", "breakaway", "long_climb"],
  high_mountain: ["long_climb", "long_climb", "descent"],
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

// FNV-1a 32-bit → heltals-seed fra seed-nøglen (streng). Deterministisk.
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Seed-nøgle = løbets stabile, virkelige identitet. external_id (race_pool-import-
// nøglen) er mest stabil — uændret på tværs af kalender-rebuilds og katalog-reimports.
// pool_race_id (katalog-PK/UUID) er næstbedst; race.id (per-instans-UUID) er sidste
// udvej for ad-hoc-løb uden katalog-binding. ALLE kopier af samme løb i en divisions
// puljer deler external_id → identisk parcours. Eksporteret for testbarhed.
//
// Tom/whitespace-streng behandles som FRAVÆRENDE (ikke kun null/undefined): en
// fremtidig katalog-import med blanke external_id må ikke kollapse distinkte løb til
// samme parcours (`??` alene fanger ikke "").
const presentKey = (v) => (typeof v === "string" ? (v.trim() === "" ? null : v) : v ?? null);
export function seedIdentityFor(race) {
  return presentKey(race?.external_id) ?? presentKey(race?.pool_race_id) ?? race?.id;
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

export function finaleFor(rng, profileType) {
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
 * @param {{id:string, race_type?:string, stages?:number, external_id?:string, pool_race_id?:string}} race
 *   Seedes på external_id ?? pool_race_id ?? id (se seedIdentityFor) — så alle kopier
 *   af samme rigtige løb (en divisions parallelle puljer) får IDENTISK parcours.
 * @param {{seed?:number}} [opts]  override-seed (default: stableSeed(seedIdentityFor(race)))
 * @returns {Array<{stage_number:number, profile_type:string, finale_type:(string|null), demand_vector:object}>}
 */
export function generateRaceStageProfiles(race, { seed } = {}) {
  if (!race?.id) throw new Error("race.id kræves");
  const isStageRace = race.race_type === "stage_race";
  const stages = isStageRace ? Math.max(2, Number(race.stages) || 2) : 1;
  const rng = makeRng(Number.isInteger(seed) ? seed >>> 0 : stableSeed(String(seedIdentityFor(race))));
  return isStageRace ? buildStageRace(rng, stages) : buildSingle(rng);
}
