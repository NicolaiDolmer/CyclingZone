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
import { attachRoute } from "./raceRouteGenerator.js";

// v1: #1102-launch (seedet på race.id). v2 (2026-06-28): seedet på løbets virkelige
// identitet (external_id) via seedIdentityFor. v3 (2026-06-28): arketype-drevet
// terrænfordeling (ARCHETYPE_PROFILES) + sæson-akse i seed'en (variation pr. sæson).
// Bump'et stempler regenererede rækker, så de kan skelnes fra ældre (intet
// runtime-guard afhænger af tallet — kun et persisteret stempel).
// v4 (2026-07-21, #2769): pass 2 (attachRoute) beriger hver etape med en rute
// (distance/climbs/sprints/sektorer) via en dedikeret rng-strøm. Pass 1 bit-identisk.
export const GENERATOR_VERSION = 4;

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

// Arketype-fordelinger (jf. spec §4). kind:"single" → endagsløbs-profilvægte;
// kind:"stage" → garantier (force-include, trimmet til stages) + filler-vægte.
// Vægte = samme format som weightedPick. Tunbar ÉT sted (jf. spec §12). Et løb
// uden (kendt) terrain_archetype → null → generatoren falder tilbage til de
// generiske vægte ovenfor (bagudkompatibelt).
export const ARCHETYPE_PROFILES = Object.freeze({
  // Endagsløb: kerneterrænet er FAST — et endagsløbs karakter ændrer sig ikke år til
  // år (variation-pr-sæson gælder kun etapeløb). Hvor to profiler er listet, er de
  // SAMME karakter (tekstur, ikke karakterskift): hilly↔classic, mountain↔high_mountain.
  flat_sprint:         { kind: "single", weights: [{ value: "flat", weight: 1 }] },
  cobbled_classic:     { kind: "single", weights: [{ value: "cobbles", weight: 1 }] },
  puncheur:            { kind: "single", weights: [{ value: "hilly", weight: 1 }] },
  hilly_classic:       { kind: "single", weights: [{ value: "hilly", weight: 60 }, { value: "classic", weight: 40 }] },
  mountain_classic:    { kind: "single", weights: [{ value: "high_mountain", weight: 50 }, { value: "mountain", weight: 50 }] },
  long_sprint_classic: { kind: "single", weights: [{ value: "rolling", weight: 1 }] },

  // #2411: TTT scorer i dag som individuel enkeltstart (terrainBucket("ttt")→"itt" i
  // raceTerrain.js — ni ryttere fra samme hold får hver deres tid). Pauset indtil
  // motoren kan simulere ægte hold-TTT (separat fremtidigt issue): "ttt"-filleren
  // (var weight 2) er fjernet — kun ITT genereres for fremtidige parcours. Eksisterende
  // persisterede etaper med ttt RØRES IKKE (kun fremtidige genereringer påvirkes).
  grand_tour:     { kind: "stage", guarantees: ["flat", "flat", "flat", "itt", "mountain", "high_mountain", "high_mountain"], filler: [{ value: "flat", weight: 26 }, { value: "rolling", weight: 12 }, { value: "hilly", weight: 14 }, { value: "mountain", weight: 20 }, { value: "high_mountain", weight: 14 }, { value: "itt", weight: 12 }] },
  mountain_tour:  { kind: "stage", guarantees: ["flat", "mountain", "mountain"], filler: [{ value: "flat", weight: 16 }, { value: "rolling", weight: 14 }, { value: "hilly", weight: 14 }, { value: "mountain", weight: 34 }, { value: "high_mountain", weight: 16 }, { value: "itt", weight: 6 }] },
  hilly_tour:     { kind: "stage", guarantees: ["flat", "hilly", "hilly"], filler: [{ value: "flat", weight: 18 }, { value: "rolling", weight: 22 }, { value: "hilly", weight: 34 }, { value: "mountain", weight: 14 }, { value: "high_mountain", weight: 4 }, { value: "itt", weight: 8 }] },
  sprinters_week: { kind: "stage", guarantees: ["flat", "mountain"], filler: [{ value: "flat", weight: 50 }, { value: "rolling", weight: 22 }, { value: "hilly", weight: 12 }, { value: "mountain", weight: 10 }, { value: "itt", weight: 6 }] },
  balanced_week:  { kind: "stage", guarantees: ["flat", "mountain"], filler: [{ value: "flat", weight: 30 }, { value: "rolling", weight: 20 }, { value: "hilly", weight: 18 }, { value: "mountain", weight: 18 }, { value: "high_mountain", weight: 4 }, { value: "itt", weight: 10 }] },
  // Ørken/sprinter-tur med faste bjergankomster: garanteret 1 TT + 2 bjerg, resten
  // flad/rullende (fx UAE Tour). Filler kun flad/rullende → "resten er flade".
  sprinter_tour_summits: { kind: "stage", guarantees: ["flat", "itt", "mountain", "mountain"], filler: [{ value: "flat", weight: 78 }, { value: "rolling", weight: 22 }] },

  // #2769 (Sub-1): fritstående enkeltstart-endagsløb (#2177 — 0 fritstående ITT i dag).
  itt_classic: { kind: "single", weights: [{ value: "itt", weight: 1 }] },

  // #2769: etapeløb med GARANTERET high_mountain-summit (hæver tier 3/4 summit-finishes,
  // sænker M-Down-andelen — mountain_tour garanterer kun mellembjerg/descent). high_mountain
  // sidst via STAGE_ORDER_HINT (7) → dronningeetape/top-finish. En itt-garanti giver samtidig
  // en enkeltstart i løbet.
  summit_tour: { kind: "stage", guarantees: ["flat", "mountain", "high_mountain", "high_mountain"], filler: [{ value: "flat", weight: 14 }, { value: "rolling", weight: 12 }, { value: "hilly", weight: 12 }, { value: "mountain", weight: 20 }, { value: "high_mountain", weight: 26 }, { value: "itt", weight: 8 }] },

  // #2769: etapeløb med GARANTERET brosten-etape (#2527/#2755 — 0 brosten i etapeløb i dag).
  cobbled_tour: { kind: "stage", guarantees: ["flat", "cobbles", "mountain"], filler: [{ value: "flat", weight: 30 }, { value: "rolling", weight: 20 }, { value: "cobbles", weight: 16 }, { value: "hilly", weight: 16 }, { value: "mountain", weight: 12 }, { value: "itt", weight: 6 }] },
});

// Opslag: terrain_archetype → config (eller null ved ukendt/manglende → generisk).
export function archetypeFor(race) {
  return ARCHETYPE_PROFILES[race?.terrain_archetype] ?? null;
}

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

// Fuld seed-nøgle = løb-identitet + sæson. Alle grupper i en sæson deler nøglen
// (konsistens); en ny sæson giver en ny nøgle (variation pr. sæson, jf. spec §5.1).
// Uden season_id seedes på identitet alene (bagudkompatibel — tests/ad-hoc).
function seedKeyFor(race) {
  const id = String(seedIdentityFor(race));
  return race?.season_id ? `${id}::${race.season_id}` : id;
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

// Tidskørsels-profiler (ITT + TTT). Et etapeløb må realistisk kun have få —
// #2029: en Grand Tour blev genereret med 5 enkeltstarter (4 ITT + 1 TTT), fordi
// hver filler-plads ruller uafhængigt mod itt/ttt-vægte og intet loft samlede dem.
const TIME_TRIAL_PROFILES = Object.freeze(["itt", "ttt"]);
const isTimeTrial = (t) => TIME_TRIAL_PROFILES.includes(t);

// Konservativt loft på antal tidskørsler pr. etapeløb (#2029). Balance-default:
// rigtige grand tours har typisk 2 enkeltstarter (lejlighedsvis 3), aldrig 5.
// Loftet udledes pr. arketype som max(garanterede tidskørsler, DEFAULT_TT_CAP),
// så en arketype-garanteret TT ALDRIG fjernes; kun filler-tilføjede TT ud over
// loftet re-rulles til ikke-TT-terræn.
export const DEFAULT_TT_CAP = 2;

// Udled TT-loftet for en (arketype- eller generisk) fordeling. guarantees kan
// selv indeholde flere garanterede TT end default'en — dem respekterer vi (hæver
// loftet), så en fremtidig arketype med 3 faste enkeltstarter ikke får dem trimmet.
export function timeTrialCap(guaranteedTypes = []) {
  const guaranteedTT = guaranteedTypes.filter(isTimeTrial).length;
  return Math.max(guaranteedTT, DEFAULT_TT_CAP);
}

// Håndhæv TT-loftet på et allerede-bygget types-array. Filler-tilføjede TT ud over
// loftet (dvs. TT ved index ≥ protectedCount, scannet fra enden) erstattes med et
// re-rullet ikke-TT-filler-terræn. Guarantees (de første protectedCount) røres ikke.
// Deterministisk: bruger den delte rng, og filtrerer TT ud af filler-vægtene så en
// erstatning aldrig selv er en TT. Muterer + returnerer types (in-place, som resten).
function capTimeTrials(rng, types, protectedCount, fillerWeights) {
  const cap = timeTrialCap(types.slice(0, protectedCount));
  const nonTtFiller = fillerWeights.filter((it) => !isTimeTrial(it.value));
  let ttCount = types.filter(isTimeTrial).length;
  // Scan bagfra: senere (filler-)pladser trimmes først; guarantee-regionen beskyttes.
  for (let i = types.length - 1; i >= protectedCount && ttCount > cap; i--) {
    if (!isTimeTrial(types[i])) continue;
    // Erstatning: re-rul ikke-TT-filler; fald tilbage til "flat" hvis filleren KUN
    // var TT (kan ikke ske for de nuværende arketyper, men holder funktionen total).
    types[i] = nonTtFiller.length ? weightedPick(rng, nonTtFiller) : "flat";
    ttCount--;
  }
  return types;
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

function toStage(rng, profileType, stageNumber, race, isStageRace) {
  const base = {
    stage_number: stageNumber,
    profile_type: profileType,
    finale_type: finaleFor(rng, profileType),
    demand_vector: demandVectorFor(profileType),
  };
  // Pass 2: rute-berigelse via DEDIKERET rng-strøm (rører ikke `rng` ovenfor).
  const route = attachRoute(base, race, isStageRace);
  return { ...base, ...route };
}

// Endagsløb: ét terræn fra arketypens (eller den generiske) vægtede fordeling.
function buildSingle(rng, cfg, race) {
  const weights = cfg?.kind === "single" ? cfg.weights : SINGLE_PROFILE_WEIGHTS;
  return [toStage(rng, weightedPick(rng, weights), 1, race, false)];
}

// Ordn "mod klimaks" (sprint tidligt, bjerg sent) + map til etaper. Delt af begge stier.
function orderAndBuild(rng, types, stages, race) {
  types.length = stages; // defensiv trim
  const ordered = types
    .map((t) => ({ t, key: STAGE_ORDER_HINT[t] + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1, race, true));
}

// Generisk (uændret adfærd): garanterer ≥1 flad + ≥1 bjerg; kort TT muligt ved N≥5.
// STAGE_FILLER_WEIGHTS har ingen TT, så generisk kan ikke akkumulere TT fra filler;
// TT-loftet håndhæves alligevel defensivt (guaranteed TT ⊆ de 2 første pladser).
function buildStageRaceGeneric(rng, stages, race) {
  const types = ["flat", "mountain"];
  if (stages >= 5 && rng() < 0.7) types.push("itt");
  const protectedCount = types.length; // flad+bjerg(+evt. itt) = garantier
  while (types.length < stages) types.push(weightedPick(rng, STAGE_FILLER_WEIGHTS));
  capTimeTrials(rng, types, protectedCount, STAGE_FILLER_WEIGHTS);
  return orderAndBuild(rng, types, stages, race);
}

// Arketype-drevet: garantier (force-include, trimmet til stages) + filler-vægte.
// TT-loftet (#2029) håndhæves EFTER filler er lagt på: filler-tilføjede TT ud over
// loftet re-rulles til ikke-TT-terræn, mens arketypens garanterede TT bevares.
function buildStageRaceArchetype(rng, stages, cfg, race) {
  const types = cfg.guarantees.slice(0, stages);
  const protectedCount = types.length; // guarantees = beskyttet region
  while (types.length < stages) types.push(weightedPick(rng, cfg.filler));
  capTimeTrials(rng, types, protectedCount, cfg.filler);
  return orderAndBuild(rng, types, stages, race);
}

// Etapeløb: arketype-sti hvis kendt arketype, ellers generisk.
function buildStageRace(rng, stages, cfg, race) {
  return cfg?.kind === "stage" ? buildStageRaceArchetype(rng, stages, cfg, race) : buildStageRaceGeneric(rng, stages, race);
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
  const cfg = archetypeFor(race);
  const rng = makeRng(Number.isInteger(seed) ? seed >>> 0 : stableSeed(seedKeyFor(race)));
  return isStageRace ? buildStageRace(rng, stages, cfg, race) : buildSingle(rng, cfg, race);
}
