// backend/lib/raceRouteGenerator.js
// Sub-1 (#2769): rute-berigelse (pass 2) af en allerede-valgt etape. Ren funktion.
// Bruger en DEDIKERET rng-strøm (seed + ":route:" + stage_number) → forstyrrer ALDRIG
// pass 1's profile_type/finale_type/demand_vector. Udsender distance_km, elevation_gain_m,
// climbs[], sprints[], sectors[] jf. spec §3-4. Ingen DB/fs, ingen Math.random/Date.
//
// v4 F1 (#3855, 2026-08-20): buildClimbs/buildSectors/makeRegionNamer/regionOf er nu
// EKSPORTERET (var interne) så routeSegments.js's synthesizeSegments() kan genbruge de
// SAMME byggeklodser til at syntetisere climbs/sectors for legacy race_stage_profiles-
// rækker uden gemt rute. Rent additivt — ingen adfærdsændring for attachRoute selv.

import { makeRng } from "./fictionalRiderGenerator.js";
import { seasonSeedSuffix } from "./raceSeedAxis.js";

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
// #3347: sæson-aksen (inkl. re-draw-varianten) kommer fra raceSeedAxis.js, så pass 2's
// ruter ligger på PRÆCIS samme akse som pass 1's profiler. Variant 0 → uændret nøgle.
function routeSeedKey(race, stageNumber) {
  const id = String(seedIdentityFor(race));
  return `${id}${seasonSeedSuffix(race)}:route:${stageNumber}`;
}

function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
function randFloat(rng, min, max, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round((min + rng() * (max - min)) * f) / f;
}
function round5(n) { return Math.round(n / 5) * 5; }

// Distance-bånd pr. profil (spec §4.1, WT-kalibreret). [min,max] km.
// itt_hilly (#3546 D): kuperet enkeltstart-arketype: realistisk KORTERE end en flad ITT
// (klatring begrænser den opnåelige distance inden for en etapedags rammer; virkelighedens
// kuperede/bjerg-ITT'er, fx Vueltaens Alto de Arrate-typer, ligger typisk 15-30 km).
export const DISTANCE_BANDS = Object.freeze({
  flat: [150, 200], rolling: [150, 190], hilly: [160, 210],
  mountain: [150, 190], high_mountain: [140, 180],
  // gravel (#4105): grusklassikeren er LAENGERE end brostensklassikeren og kortere end
  // monumentet — Strade Bianche-typen ligger i 180-215 km med sektorerne spredt over
  // anden halvdel. Baandet er sat mellem cobbles og classic, ikke lig med nogen af dem.
  cobbles: [150, 170], gravel: [180, 215], classic: [200, 260],
  itt: [15, 40], ttt: [25, 45], itt_hilly: [15, 30],
});

// #4104 (ejer-direktiv 21/8: "monumenter skal vaere lange ruter som i virkeligheden").
// KLASSE-baandet slaar TERRAEN-baandet. Rod-aarsagen til at direktivet ikke bare var en
// datarettelse: distancen blev valgt UDELUKKENDE af profile_type, og et monument faar en
// almindelig terraen-profil (cobbles/hilly/rolling/mountain). Modellen havde derfor intet
// sted at udtrykke "L'Enfer du Nord er 259 km" - maalt paa den LEVENDE S3-kalender var
// Roubaix 155 km og dermed D1's KORTESTE endagsloeb, mens Division 4 koerte
// classic-etaper paa 210-220 km.
//
// Baandet er sat efter de virkelige monumenter (255-288 km) og gOEr dem til spillets
// laengste loeb, som de skal vaere. Naeste skridt (eget issue): per-loeb FORFATTEDE
// laengder, saa Sanremo faktisk er laengere end Roubaix i stedet for tilfaeldigt fordelt
// inden for baandet - modellen mangler stadig et sted at sige praecis det.
//
// NB: raceRouteRealismMetrics.js' WT_DISTANCE_BANDS spejler dette, ellers taelles
// monumenterne som distance-outliers i realisme-scorecardet.
export const CLASS_DISTANCE_BANDS = Object.freeze({
  Monuments: [250, 290],
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
  // high_mountain trækker KUN "1"/"2" her — HC'en tildeles deterministisk til
  // etapens klimaks i buildClimbs() nedenfor.
  high_mountain: { count: [2, 4], cats: ["1", "2"] },
  cobbles: { count: [0, 2], cats: ["3", "4"] },
  // gravel: flere og lidt haardere korte stigninger end brosten (toscanske bakker),
  // men aldrig kat 1/HC — saa bliver det en bjergetape med grus paa, ikke en grusklassiker.
  gravel: { count: [2, 4], cats: ["2", "3", "4"] },
  classic: { count: [2, 5], cats: ["1", "2", "3"] },
  itt: { count: [0, 0], cats: [] },
  ttt: { count: [0, 0], cats: [] },
  // itt_hilly (#3546 D): 1-2 SMÅ stigninger (kat 3/4: aldrig HC/1/2, det ville reelt gøre
  // den til en mountain-etape med kronometer-facit i stedet for en kuperet enkeltstart).
  itt_hilly: { count: [1, 2], cats: ["3", "4"] },
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
// #3546 E (ejer-valgt 17/8 aften): andel af hilly/rolling-etaper med uphill-klimaks
// (summit_finish=true). Prod-mål: ~35% hilly, ~20% rolling (0% målt i dag for begge).
export const UPHILL_FINISH_SHARE = Object.freeze({ hilly: 0.35, rolling: 0.20 });
// Basis-højdemeter (ikke-kategoriseret bølgeterræn) pr. profil.
const BASE_ELEVATION = Object.freeze({
  flat: 200, rolling: 500, hilly: 700, mountain: 900, high_mountain: 1100,
  cobbles: 400, gravel: 800, classic: 900, itt: 80, ttt: 120,
  // itt_hilly (#3546 D): moderat: mere end den flade ITT, men langt under en hel
  // hilly-etape (kortere distance holder det samlede højdemeter-tal nede).
  itt_hilly: 350,
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
// #4105: grus-sektorerne har deres egne navne. Et grusloeb der kalder sine sektorer
// "Settore Pave" er den samme indholdsfejl som at Terre di Toscana var brosten.
const GRAVEL_SECTOR_TOKENS = Object.freeze({
  es: ["Sector de Grava", "Tramo de Tierra"],
  it: ["Settore Sterrato", "Tratto di Strada Bianca"],
  fr: ["Secteur de Terre", "Chemin Blanc"],
  default: ["Gravel Sector", "White Road"],
});
const REGION_HINTS = Object.freeze([
  { re: /vuelta|espa|anda|burg|navarra|castilla|cantabria|picos|almer|llanera|cami|gran premio de|clásica|morvedre|mediterr/i, region: "es" },
  { re: /giro|coppa|trof(e|é)o|piemonte|veneto|emilia|trentino|abruzzo|legnano|peccioli|prato|appenn|ligure|colline|milano/i, region: "it" },
  { re: /tour|france|fran|jura|provence|mayenn|loire|golfe|bess|avesnois|dr[oô]me|touraine|hainaut|flandres|namur|wallonie|criquielion|k[oö]ln|c[eé]vennes|aveyron|ain/i, region: "fr" },
]);
export function regionOf(raceName) {
  const s = String(raceName || "");
  for (const h of REGION_HINTS) if (h.re.test(s)) return h.region;
  return "default";
}
// Namer-factory: deterministisk fra rng + region. Undgår dubletter pr. etape via en brugt-mængde.
export function makeRegionNamer(rng, region) {
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
    sector(i, kind = "cobbles") {
      const pool = (kind === "gravel" ? GRAVEL_SECTOR_TOKENS : SECTOR_TOKENS)[region];
      return `${pool[randInt(rng, 0, pool.length - 1)]} ${i + 1}`;
    },
  };
}

export function buildClimbs(rng, profileType, finaleType, distanceKm, namer) {
  const spec = CLIMB_SPEC[profileType] ?? CLIMB_SPEC.flat;
  const n = randInt(rng, spec.count[0], spec.count[1]);
  if (n === 0 || spec.cats.length === 0) return [];
  const cats = [];
  for (let i = 0; i < n; i++) cats.push(spec.cats[randInt(rng, 0, spec.cats.length - 1)]);
  // "Bygger mod klimaks": easiest først, hårdest sidst (descending CAT_ORDER-værdi).
  cats.sort((a, b) => CAT_ORDER[b] - CAT_ORDER[a]);
  let summit = SUMMIT_FINALE.has(finaleType);
  // #3546 E (ejer-valgt 17/8 aften): en SEEDET andel af hilly/rolling-etaper skal have et
  // uphill-klimaks (sidste stigning topper VED målstregen) i stedet for aldrig at gøre det.
  // Prod målte 0/254 hilly og 0/65 rolling med summit_finish, fordi finale_type-baseret
  // summit-logik kun dækker mountain-familien (FINALE_WEIGHTS_BY_PROFILE for hilly/rolling
  // indeholder aldrig "long_climb"). Denne roll er UAFHÆNGIG af finale_type (rører ALDRIG
  // motoren/passage-ordenen/KOM-pointene: den genbruger blot summit-boolean'en buildClimbs
  // allerede havde) og forbruges KUN for hilly/rolling, så alle andre profil-typers rute-
  // rng-strøm forbliver uændret (bit-identisk).
  if (!summit && (profileType === "hilly" || profileType === "rolling")) {
    if (rng() < (UPHILL_FINISH_SHARE[profileType] ?? 0)) summit = true;
  }
  // En high_mountain-etape UDEN HC er ikke høj-bjerg. Kategorien blev tidligere
  // trukket uniformt fra ["HC","1","2"], så en etape kunne lande på 0 HC — eller
  // fire i træk. Over en grand tour gav lotteriet 1-6 HC mod realisme-båndet 3-8
  // (S2's Tour de l'Hexagone ramte 1). HC'en tildeles nu deterministisk til
  // etapens klimaks, præcis én pr. high_mountain-etape: en GT's HC-total bliver
  // dermed lig antallet af high_mountain-etaper — legibelt og uden hale. (Dobbelt
  // HC på "queen stages" blev målt og fravalgt: det gav flere bånd-brud, 10,8%
  // mod 9,7%, med en hale til 16 HC.) Puljetrækket ovenfor beholder sit antal
  // rng-kald, så længde-, gradient- og sprint-trækkene nedenfor bevarer deres
  // strøm-offset — distance og antal stigninger er bit-identiske med før.
  if (profileType === "high_mountain") cats[n - 1] = "HC";
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

// #3048: en kategoriseret stignings "klatresegment" er [crest_km - length_km, crest_km]
// (samme grænse som frontend stageRouteProfile.js bruger til den visuelle "top"-bump og
// som raceSimulator/racePassages implicit forudsætter for KOM-passager). En mellemsprint
// der lander heri belønner klatrere med sprint-point/bonussekunder de ikke skal have —
// KOM-passager SKAL fortsat ligge på stigninger; kun mellemsprints flyttes.
function isOnClimb(km, climbs) {
  return climbs.some((c) => km >= Number(c.crest_km) - Number(c.length_km) && km <= Number(c.crest_km));
}

// #3048 — kanonisk dalregel (ejer-godkendt 27/7, verificeret mod alle 137 ramte
// prod-rækker; erstatter den oprindelige crest+1-nedkørsel fra PR #3054, som ejeren
// afviste som urealistisk — konkret modeksempel: Vuelta a los Picos etape 4, hvor
// crest+1 landede i et 6 km hul mellem to kategori-1-stigninger).
//
// Reglen er UAFHÆNGIG af den oprindelige rå km: samme climbs+distance giver altid
// samme dal, så samme reglen giver samme resultat som den allerede kørte prod-
// reparation, uanset hvor den oprindelige (fejlplacerede) sprint lå.
export function sprintSearchWindow(distanceKm) {
  return [Math.ceil(distanceKm * 0.2), Math.floor(distanceKm * 0.85)];
}

// Sammenhængende frie strækninger ("dale") i søgevinduet. Et km-punkt er BESAT hvis
// det ligger i [crest_km - length_km - 1, crest_km + 1] for en climb — én kilometers
// luft i begge ender (§2 i den kanoniske regel). Returnerer [lo,hi]-par (reelle km,
// ikke afrundede) sorteret på lo.
export function sprintValleys(climbs, distanceKm) {
  const [winLo, winHi] = sprintSearchWindow(distanceKm);
  if (winHi <= winLo) return [];

  const occupied = climbs
    .map((c) => [
      Math.max(winLo, Number(c.crest_km) - Number(c.length_km) - 1),
      Math.min(winHi, Number(c.crest_km) + 1),
    ])
    .filter(([lo, hi]) => hi > lo)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const iv of occupied) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }

  const valleys = [];
  let cursor = winLo;
  for (const [lo, hi] of merged) {
    if (lo > cursor) valleys.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < winHi) valleys.push([cursor, winHi]);
  return valleys;
}

// §4 i den kanoniske regel: findes dale på >= 15 km, vælg den hvis midtpunkt ligger
// tættest på distance_km * 0.55. Findes ingen på 15 km, vælg den længste dal.
export function pickSprintValley(valleys, distanceKm) {
  if (!valleys.length) return null;
  const big = valleys.filter(([lo, hi]) => hi - lo >= 15);
  const pool = big.length ? big : valleys;
  const target = distanceKm * 0.55;
  const scoreOf = (v) => (big.length ? Math.abs((v[0] + v[1]) / 2 - target) : -(v[1] - v[0]));

  let best = pool[0];
  let bestScore = scoreOf(best);
  for (const v of pool) {
    const score = scoreOf(v);
    if (score < bestScore) { bestScore = score; best = v; }
  }
  return best;
}

// Flyt en fejlplaceret mellemsprint til midtpunktet af den valgte dal (§5). Findes
// slet ingen fri strækning i søgevinduet (§6), falder funktionen tilbage til den
// oprindelige nedkørsel/tilgang-logik fra PR #3054 som sidste udvej — deterministisk,
// ingen ekstra rng-forbrug, resten af rute-strømmen (sectors) er upåvirket.
export function clampSprintKm(km, climbs, distanceKm) {
  if (!climbs.length || !isOnClimb(km, climbs)) return km;

  const valley = pickSprintValley(sprintValleys(climbs, distanceKm), distanceKm);
  if (valley) return Math.round((valley[0] + valley[1]) / 2);

  let after = km;
  for (let guard = 0; guard < 20 && isOnClimb(after, climbs); guard++) {
    const hit = climbs.find((c) => after >= Number(c.crest_km) - Number(c.length_km) && after <= Number(c.crest_km));
    after = Number(hit.crest_km) + 1;
  }
  if (after <= distanceKm - 2 && !isOnClimb(after, climbs)) return Math.round(after);

  let before = km;
  for (let guard = 0; guard < 20 && isOnClimb(before, climbs); guard++) {
    const hit = climbs.find((c) => before >= Number(c.crest_km) - Number(c.length_km) && before <= Number(c.crest_km));
    before = Number(hit.crest_km) - Number(hit.length_km) - 1;
  }
  if (before >= 2 && !isOnClimb(before, climbs)) return Math.round(before);

  // Defensivt fald-tilbage (bør ikke rammes for reelle climb-specs): behold original km
  // fremfor at kaste — en uændret km er stadig bedre end en crash i rute-generatoren.
  return Math.round(km);
}

// Tidskørsels-profiler (spejler raceStageProfileGenerator.js's TIME_TRIAL_PROFILES  - 
// lokal kopi, samme princip som stableSeed ovenfor: selvstændig fil, ingen krydsimport).
const isTimeTrialProfile = (pt) => pt === "itt" || pt === "ttt" || pt === "itt_hilly";

function buildSprints(rng, profileType, finaleType, distanceKm, isStageRace, climbs = []) {
  const sprints = [];
  const summit = SUMMIT_FINALE.has(finaleType);
  const wantIntermediate = isStageRace && !isTimeTrialProfile(profileType) && !(summit && rng() < 0.5);
  if (wantIntermediate) {
    const rawKm = Math.round(distanceKm * randFloat(rng, 0.4, 0.65, 2));
    sprints.push({ name: "Intermediate Sprint", km: clampSprintKm(rawKm, climbs, distanceKm), kind: "intermediate" });
  }
  sprints.push({ name: "Finish", km: Math.round(distanceKm), kind: "finish" });
  return sprints;
}

// #4105: sektor-KIND foelger profiltypen. `gravel` faar GARANTERET mindst een sektor
// (undergraensen er 5, ikke 0), fordi brostensevnen kun taeller paa etaper med brosten
// eller grus (ejer-regel 3/9) — en grus-etape uden sektorer ville lade
// DEMAND_VECTORS.gravel's dominerende cobblestone-vaegt hvile paa ingenting. Grus-
// sektorerne er FLERE og LAENGERE end brostens-sektorerne: grusklassikeren har typisk
// 8-11 sektorer paa 1-12 km mod brostenens 3-6 paa 1-3 km.
const SECTOR_SPEC = Object.freeze({
  cobbles: { count: [3, 6], length: [1.0, 3.0], kind: "cobbles" },
  gravel: { count: [5, 8], length: [1.5, 6.0], kind: "gravel" },
  classic: { count: [0, 3], length: [1.0, 3.0], kind: "cobbles" }, // Roubaix-type; typisk 0
});

export function buildSectors(rng, profileType, distanceKm, namer) {
  const spec = SECTOR_SPEC[profileType];
  if (!spec) return [];
  const n = randInt(rng, spec.count[0], spec.count[1]);
  if (n === 0) return [];
  const sectors = [];
  let cursor = Math.round(distanceKm * 0.45); // brosten/grus koncentreres i 2. halvdel
  for (let i = 0; i < n; i++) {
    const length_km = randFloat(rng, spec.length[0], spec.length[1], 1);
    if (cursor + length_km > distanceKm - 2) break;
    sectors.push({ kind: spec.kind, start_km: Math.round(cursor), length_km, name: namer.sector(i, spec.kind) });
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
 * @param {{external_id?:string, pool_race_id?:string, id?:string, season_id?:string, name?:string, race_class?:string}} race
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
  // #4104: klasse-baandet vinder over terraen-baandet, men KUN for endagsloeb (et
  // monument er pr. definition et endagsloeb) og KUN naar race_class faktisk er sat.
  // Kalder-stier der bygger et delvist seedRace-objekt uden race_class falder derfor
  // uaendret gennem terraen-baandet i stedet for at kaste - samme defensive linje som
  // #3620's "undefined er ikke det samme som null"-laering.
  const classBand = !isStageRace && race?.race_class ? CLASS_DISTANCE_BANDS[race.race_class] : null;
  const [lo, hi] = isProlog ? PROLOGUE_DISTANCE_BAND : (classBand ?? DISTANCE_BANDS[pt] ?? DISTANCE_BANDS.flat);
  let distance_km = isTimeTrialProfile(pt) ? randInt(rng, lo, hi) : round5(randInt(rng, lo, hi));
  if (distance_km < lo) distance_km = lo; // round5 må aldrig skyde under båndet
  if (distance_km > hi) distance_km = hi;

  const climbs = buildClimbs(rng, pt, stage.finale_type, distance_km, namer);
  const sprints = buildSprints(rng, pt, stage.finale_type, distance_km, isStageRace, climbs);
  const sectors = buildSectors(rng, pt, distance_km, namer);
  return { distance_km, elevation_gain_m: elevationGain(climbs, pt), climbs, sprints, sectors };
}
