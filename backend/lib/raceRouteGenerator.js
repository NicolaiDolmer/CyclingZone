// backend/lib/raceRouteGenerator.js
// Sub-1 (#2769): rute-berigelse (pass 2) af en allerede-valgt etape. Ren funktion.
// Bruger en DEDIKERET rng-strøm (seed + ":route:" + stage_number) → forstyrrer ALDRIG
// pass 1's profile_type/finale_type/demand_vector. Udsender distance_km, elevation_gain_m,
// climbs[], sprints[], sectors[] jf. spec §3-4. Ingen DB/fs, ingen Math.random/Date.

import { makeRng } from "./fictionalRiderGenerator.js";

// FNV-1a 32-bit (lokal kopi af raceStageProfileGenerator.stableSeed — selvstændig fil).
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const presentKey = (v) => (typeof v === "string" ? (v.trim() === "" ? null : v) : v ?? null);
function seedIdentityFor(race) {
  return presentKey(race?.external_id) ?? presentKey(race?.pool_race_id) ?? race?.id ?? "adhoc";
}
function routeSeedKey(race, stageNumber) {
  const id = String(seedIdentityFor(race));
  const season = race?.season_id ? `::${race.season_id}` : "";
  return `${id}${season}:route:${stageNumber}`;
}

function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
function randFloat(rng, min, max, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round((min + rng() * (max - min)) * f) / f;
}
function round5(n) { return Math.round(n / 5) * 5; }

// Distance-bånd pr. profil (spec §4.1, WT-kalibreret). [min,max] km.
export const DISTANCE_BANDS = Object.freeze({
  flat: [150, 200], rolling: [150, 190], hilly: [160, 210],
  mountain: [150, 190], high_mountain: [140, 180],
  cobbles: [150, 170], classic: [200, 260],
  itt: [15, 40], ttt: [25, 45],
});
// Sub-3 (#2771) Task 6: prolog-arketype. profile_type FORBLIVER "itt" (design-
// beslutning låst i spec §6 + plan Task 6 self-review) — prolog er en DISTANCE-
// egenskab afgjort her i pass 2, ikke en ny arketype i pass 1 (som forbliver
// urørt/bit-identisk). KUN etape 1 i et etapeløb kan trække en prolog.
export const PROLOGUE_PROBABILITY = 0.6;
export const PROLOGUE_DISTANCE_BAND = [5, 8];
// Climb-antal + kategori-pool pr. profil (spec §4.1).
const CLIMB_SPEC = Object.freeze({
  flat: { count: [0, 1], cats: ["4"] },
  rolling: { count: [1, 3], cats: ["3", "4"] },
  hilly: { count: [2, 4], cats: ["2", "3"] },
  mountain: { count: [3, 5], cats: ["1", "2", "3"] },
  high_mountain: { count: [2, 4], cats: ["HC", "1", "2"] },
  cobbles: { count: [0, 2], cats: ["3", "4"] },
  classic: { count: [2, 5], cats: ["1", "2", "3"] },
  itt: { count: [0, 0], cats: [] },
  ttt: { count: [0, 0], cats: [] },
});
// Længde (km) + gns. gradient (%) pr. kategori (WT-typisk).
const CAT_PROFILE = Object.freeze({
  HC: { length: [8, 20], grad: [7.5, 9.5] },
  "1": { length: [8, 16], grad: [6.5, 8.5] },
  "2": { length: [5, 10], grad: [5.5, 7.5] },
  "3": { length: [2, 6], grad: [4.5, 6.5] },
  "4": { length: [1, 3], grad: [4.0, 6.0] },
});
const CAT_ORDER = Object.freeze({ HC: 0, "1": 1, "2": 2, "3": 3, "4": 4 }); // 0 = hårdest
const SUMMIT_FINALE = new Set(["long_climb"]);
// Basis-højdemeter (ikke-kategoriseret bølgeterræn) pr. profil.
const BASE_ELEVATION = Object.freeze({
  flat: 200, rolling: 500, hilly: 700, mountain: 900, high_mountain: 1100,
  cobbles: 400, classic: 900, itt: 80, ttt: 120,
});

// --- Region-flavoured stignings-navne (deterministisk) ---
const REGION_PREFIXES = Object.freeze({
  es: ["Alto de", "Puerto de", "Coll de"],
  it: ["Passo di", "Salita di", "Cima"],
  fr: ["Col de", "Côte de", "Mont"],
  default: ["Climb of", "Ascent of", "Hill of"],
});
const PLACE_TOKENS = Object.freeze({
  es: ["Peña Blanca", "Valdeón", "Montaña", "Robledo", "Navacerrada", "El Cordal", "Covadonga", "Ancares"],
  it: ["San Pellegrino", "Fedaia", "Bondone", "Valparola", "Crostis", "Zoncolan", "Mortirolo", "Pratomagno"],
  fr: ["la Colombière", "Granier", "Beauregard", "Saint-Roch", "la Croix", "Portet", "Aubisque", "Vars"],
  default: ["Northgate", "Ravenshill", "Blackford", "Highfield", "Stonebridge", "Ashcombe", "Wynford", "Eldertop"],
});
const SECTOR_TOKENS = Object.freeze({
  es: ["Sector Adoquinado", "Tramo de Piedra"],
  it: ["Settore Pavé", "Tratto in Pietra"],
  fr: ["Secteur de Pavés", "Trouée d'Arenberg-type", "Carrefour de l'Arbre-type"],
  default: ["Cobbled Sector", "Pavé Stretch"],
});
const REGION_HINTS = Object.freeze([
  { re: /vuelta|espa|anda|burg|navarra|castilla|cantabria|picos|almer|llanera|cami|gran premio de|clásica|morvedre|mediterr/i, region: "es" },
  { re: /giro|coppa|trof(e|é)o|piemonte|veneto|emilia|trentino|abruzzo|legnano|peccioli|prato|appenn|ligure|colline|milano/i, region: "it" },
  { re: /tour|france|fran|jura|provence|mayenn|loire|golfe|bess|avesnois|dr[oô]me|touraine|hainaut|flandres|namur|wallonie|criquielion|k[oö]ln|c[eé]vennes|aveyron|ain/i, region: "fr" },
]);
function regionOf(raceName) {
  const s = String(raceName || "");
  for (const h of REGION_HINTS) if (h.re.test(s)) return h.region;
  return "default";
}
// Namer-factory: deterministisk fra rng + region. Undgår dubletter pr. etape via en brugt-mængde.
function makeRegionNamer(rng, region) {
  const prefixes = REGION_PREFIXES[region];
  const places = PLACE_TOKENS[region];
  const used = new Set();
  return {
    climb() {
      let name, guard = 0;
      do {
        name = `${prefixes[randInt(rng, 0, prefixes.length - 1)]} ${places[randInt(rng, 0, places.length - 1)]}`;
      } while (used.has(name) && guard++ < 8);
      used.add(name);
      return name;
    },
    sector(i) {
      const pool = SECTOR_TOKENS[region];
      return `${pool[randInt(rng, 0, pool.length - 1)]} ${i + 1}`;
    },
  };
}

function buildClimbs(rng, profileType, finaleType, distanceKm, namer) {
  const spec = CLIMB_SPEC[profileType] ?? CLIMB_SPEC.flat;
  const n = randInt(rng, spec.count[0], spec.count[1]);
  if (n === 0 || spec.cats.length === 0) return [];
  const cats = [];
  for (let i = 0; i < n; i++) cats.push(spec.cats[randInt(rng, 0, spec.cats.length - 1)]);
  // "Bygger mod klimaks": easiest først, hårdest sidst (descending CAT_ORDER-værdi).
  cats.sort((a, b) => CAT_ORDER[b] - CAT_ORDER[a]);
  const summit = SUMMIT_FINALE.has(finaleType);
  const climbs = [];
  for (let i = 0; i < n; i++) {
    const cp = CAT_PROFILE[cats[i]];
    const length_km = randFloat(rng, cp.length[0], cp.length[1], 1);
    const avg_gradient = randFloat(rng, cp.grad[0], cp.grad[1], 1);
    const isLast = i === n - 1;
    let crest_km;
    if (isLast) {
      crest_km = summit ? distanceKm : Math.max(1, distanceKm - randInt(rng, 5, 20));
    } else {
      crest_km = Math.round(distanceKm * (0.25 + (0.55 * (i + 1)) / n));
    }
    climbs.push({
      name: namer.climb(), category: cats[i], crest_km: Math.round(crest_km),
      length_km, avg_gradient, summit_finish: isLast && summit,
    });
  }
  climbs.sort((a, b) => a.crest_km - b.crest_km);
  return climbs;
}

function buildSprints(rng, profileType, finaleType, distanceKm, isStageRace) {
  const sprints = [];
  const summit = SUMMIT_FINALE.has(finaleType);
  const wantIntermediate = isStageRace && profileType !== "itt" && profileType !== "ttt" && !(summit && rng() < 0.5);
  if (wantIntermediate) {
    sprints.push({ name: "Intermediate Sprint", km: Math.round(distanceKm * randFloat(rng, 0.4, 0.65, 2)), kind: "intermediate" });
  }
  sprints.push({ name: "Finish", km: Math.round(distanceKm), kind: "finish" });
  return sprints;
}

function buildSectors(rng, profileType, distanceKm, namer) {
  let n = 0;
  if (profileType === "cobbles") n = randInt(rng, 3, 6);
  else if (profileType === "classic") n = randInt(rng, 0, 3); // Roubaix-type; typisk 0
  if (n === 0) return [];
  const sectors = [];
  let cursor = Math.round(distanceKm * 0.45); // brosten koncentreres i 2. halvdel
  for (let i = 0; i < n; i++) {
    const length_km = randFloat(rng, 1.0, 3.0, 1);
    if (cursor + length_km > distanceKm - 2) break;
    sectors.push({ kind: "cobbles", start_km: Math.round(cursor), length_km, name: namer.sector(i) });
    cursor += length_km + randInt(rng, 4, 12);
  }
  return sectors;
}

function elevationGain(climbs, profileType) {
  const fromClimbs = climbs.reduce((s, c) => s + Math.round((c.length_km * 1000 * c.avg_gradient) / 100), 0);
  return fromClimbs + (BASE_ELEVATION[profileType] ?? 300);
}

/**
 * Berig én etape med en rute (pass 2). Ren funktion — muterer ikke input.
 * @param {{stage_number:number, profile_type:string, finale_type:(string|null)}} stage
 * @param {{external_id?:string, pool_race_id?:string, id?:string, season_id?:string, name?:string}} race
 * @param {boolean} isStageRace  true = etape i et etapeløb; false = endagsløb (kun målspurt)
 * @returns {{distance_km,elevation_gain_m,climbs,sprints,sectors}}
 */
export function attachRoute(stage, race, isStageRace) {
  const pt = stage.profile_type;
  const rng = makeRng(stableSeed(routeSeedKey(race, stage.stage_number)));
  const namer = makeRegionNamer(rng, regionOf(race?.name));

  // Sub-3 (#2771): prolog-draw FØR distance-draw'et, fra den SAMME dedikerede
  // rute-rng-strøm (ordering veldefineret). Kun stage 1 i et etapeløb med
  // profile_type "itt" kan blive en prolog — alt andet (senere itt-etaper,
  // enkeltstående itt-løb, ikke-itt-profiler) trækker INGEN ekstra rng her og
  // falder uændret gennem det normale bånd (pass 1 forbliver bit-identisk;
  // determinisme: samme race-identitet + etape → samme afgørelse hver gang).
  const isProlog = pt === "itt" && stage.stage_number === 1 && isStageRace && rng() < PROLOGUE_PROBABILITY;
  const [lo, hi] = isProlog ? PROLOGUE_DISTANCE_BAND : (DISTANCE_BANDS[pt] ?? DISTANCE_BANDS.flat);
  let distance_km = pt === "itt" || pt === "ttt" ? randInt(rng, lo, hi) : round5(randInt(rng, lo, hi));
  if (distance_km < lo) distance_km = lo; // round5 må aldrig skyde under båndet
  if (distance_km > hi) distance_km = hi;

  const climbs = buildClimbs(rng, pt, stage.finale_type, distance_km, namer);
  const sprints = buildSprints(rng, pt, stage.finale_type, distance_km, isStageRace);
  const sectors = buildSectors(rng, pt, distance_km, namer);
  return { distance_km, elevation_gain_m: elevationGain(climbs, pt), climbs, sprints, sectors };
}
