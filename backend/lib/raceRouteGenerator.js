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
// S5 (#6359): matrixen (spec §3) og pladsholder-kilderne bor i Fase 0's ordforråd.
import { isFinishAllowed as isFinishAllowedS5, S5_PLACEHOLDER_SOURCE_PROFILE, FINISH_MATRIX as FINISH_MATRIX_S5 } from "./stageProfileTypes.js";

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

// #4288 (ejer-beslutning 3/9): en Grand Tour er spillets laengste loeb, og dens etaper
// skal maales mod virkeligheden - ikke mod den samme skabelon som en firedages Class2-tur.
// Ejeren satte tre tal: samlet snit INKL. enkeltstart 155-170 km, landevejsetaper 165-185
// km i snit, prolog 8-14 km og rigtige enkeltstarter 25-40 km. #4709 gOEr dem til en gate
// (GRAND_TOUR_DISTANCE_RULES i raceRouteRealismMetrics.js).
//
// HVORFOR ET EGET BAAND OG IKKE EN JUSTERING AF DISTANCE_BANDS: terraen-baandene daekker
// HELE kataloget - 200+ loeb fra endagsklassikere til firedages-ture. Loefter man dem, faar
// en Class2-tur i Portugal 190 km flade etaper, og #4104's monument-loesning (klasse slaar
// terraen) ville skulle laves om igen. Maalt paa S3's LEVENDE kalender laa GT-snittene paa
// 153,0 / 155,6 / 162,6 km - Touren under gulvet, de to andre i den nederste kant - fordi
// GT'en arvede baandene fra et gennemsnitsloeb. GT'en har sit eget baand, praecis som
// monumentet fik sit i #4104.
//
// KALIBRERING: baandene er sat saa landevejssnittet lander paa ~176 km (midt i 165-185 og
// hoejt nok til at det SAMLEDE snit stadig rammer 155-170 naar to korte tempoetaper traekker
// det ned). Spredningen er smallere end terraen-baandenes 40-50 km, fordi et bredt baand
// giver et snit der falder ud af 155-170 i hver tredje traekning. Raekkefoelgen mellem
// typerne foelger virkeligheden: kuperede og flade etaper er de laengste, hoejbjerget det
// korteste (klatringen begraenser hvad der kan koeres paa en etapedag).
export const GRAND_TOUR_DISTANCE_BANDS = Object.freeze({
  flat: [170, 190], rolling: [165, 190], hilly: [170, 195],
  mountain: [165, 185], high_mountain: [160, 180],
  // Ejerens 25-40 km. itt_hilly holdes i den korte ende af det samme baand (klatringen
  // begraenser distancen), men ALDRIG under 25 - gulvet er det samme for alle rigtige
  // enkeltstarter i en GT.
  itt: [25, 40], itt_hilly: [25, 35],
});

// Sub-3 (#2771) Task 6: prolog-arketype. profile_type FORBLIVER "itt" (design-
// beslutning låst i spec §6 + plan Task 6 self-review) — prolog er en DISTANCE-
// egenskab afgjort her i pass 2, ikke en ny arketype i pass 1 (som forbliver
// urørt/bit-identisk). KUN etape 1 i et etapeløb kan trække en prolog.
export const PROLOGUE_PROBABILITY = 0.6;
export const PROLOGUE_DISTANCE_BAND = [5, 8];
// #4288: en GT-prolog er 8-14 km (ejer-beslutning 3/9). Baandet er GT-specifikt, saa en
// prolog i en almindelig etapeuge stadig maa vaere de 5-8 km den altid har vaeret.
export const GRAND_TOUR_PROLOGUE_DISTANCE_BAND = [8, 14];
// Arketypen der udpeger en Grand Tour. Samme noegle som ARCHETYPE_PROFILES.grand_tour i
// raceStageProfileGenerator.js og isGrandTourArchetype i raceRouteRealismMetrics.js.
const GRAND_TOUR_ARCHETYPE = "grand_tour";
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
// #2789 (bonus-fund): "itt" er IKKE her — den flade enkeltstart havde et FAST tal (80)
// uanset distance, så en 5 km prolog og en 40 km enkeltstart fik samme højdemeter-facit.
// Se ITT_ELEVATION_PER_KM nedenfor, som erstatter den faste værdi med en sats pr. km.
const BASE_ELEVATION = Object.freeze({
  flat: 200, rolling: 500, hilly: 700, mountain: 900, high_mountain: 1100,
  cobbles: 400, gravel: 800, classic: 900, ttt: 120,
  // itt_hilly (#3546 D): moderat: mere end den flade ITT, men langt under en hel
  // hilly-etape (kortere distance holder det samlede højdemeter-tal nede). Beholder sin
  // egen climbs+base-logik uændret (#2789 rører KUN den flade "itt"-profil).
  itt_hilly: 350,
});
// #2789: "itt" skalerer nu LINEÆRT med distance_km i stedet for et fast 80-tal. Satsen er
// kalibreret mod en typisk enkeltstarts reference-distance og skalerer proportionalt
// derfra. Ingen ekstra rng-træk: elevationGain() læser kun det allerede-trukne
// distance_km fra pass 2's normale distance-bånd (prolog 5-8/8-14, normal 15-40,
// GT 25-40 — se DISTANCE_BANDS ovenfor).
const ITT_ELEVATION_PER_KM = 80 / 27.5;

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

// #2789 fund 5 + ejer-beslutning 6/9 (RACE_ENGINE_RULES §9 raekke 6): en brostens-
// FINALE kunne ikke opstaa. Sektorerne blev lagt fra 45 % af distancen og fremad med
// 5-15 km's mellemrum, saa den sidste sektor sluttede langt fra maal — maalt paa en
// proxy-kalender 6/9: 0 af 17 brostens-/grus-etaper havde en sektor der sluttede inden
// for 10 km af maal (samme resultat som #2789's maaling mod aegte S2-data: 0 af 93).
// Konsekvensen var at hele brostens-mekanikken (M8) kunne udloese et split, men feltet
// havde altid 20-70 km fladt til at koere det ind igen.
//
// Rettelsen: paa etaper hvor brostensevnen ER dagens dominerende dimension (cobbles og
// gravel — begge har GARANTERET sektor-forsyning, jf. #4105) reserveres DEN SIDSTE af
// de trukne sektorer til finalen og forankres i vinduet nedenfor. Antallet af sektorer
// er UAENDRET (samme randInt-traek, samme baand) — det er placeringen af den sidste der
// aendrer sig, praecis som i virkeligheden: Carrefour de l'Arbre og Le Tolfe ligger
// begge inden for de sidste 15 km af deres loeb.
//
// `classic` er BEVIDST IKKE med: den traekker 0-3 sektorer og faar ingen i ca. en
// fjerdedel af tilfaeldene (RACE_ENGINE_RULES §2b's advarsel). At give monument-
// arketypen en garanteret brostens-finale er en balance-aendring, ikke en oprydning,
// og kraever sin egen ejer-beslutning. Dens kodesti er derfor bit-identisk med foer.
const FINALE_SECTOR_PROFILES = new Set(["cobbles", "gravel"]);
// Sektorens SLUT maalt fra maalstregen (km). Efter afrundingen af start_km ligger den
// faktiske slutning i [d-10, d-2] — inden for ejerens 10 km-krav, og aldrig HELT paa
// stregen, saa der altid er en kort indkoersel hvor forspringet skal holdes.
const FINALE_SECTOR_END_KM_FROM_FINISH = [2.5, 9.5];
// Plads reserveret til finale-sektoren: 10 km vindue + laengste sektor (6 km, grus) +
// et par km luft, saa krops-sektorerne aldrig loeber ind i den.
const FINALE_SECTOR_RESERVE_KM = 20;

export function buildSectors(rng, profileType, distanceKm, namer) {
  const spec = SECTOR_SPEC[profileType];
  if (!spec) return [];
  const n = randInt(rng, spec.count[0], spec.count[1]);
  if (n === 0) return [];
  // Forankringen kraever plads til baade krop og finale; en (urealistisk) meget kort
  // etape falder tilbage til den gamle adfaerd i stedet for at faa sektorer oven i hinanden.
  const anchorFinale = FINALE_SECTOR_PROFILES.has(profileType) && distanceKm > FINALE_SECTOR_RESERVE_KM * 2;
  const bodyCount = anchorFinale ? n - 1 : n;
  const bodyLimitKm = distanceKm - (anchorFinale ? FINALE_SECTOR_RESERVE_KM : 2);
  const sectors = [];
  let cursor = Math.round(distanceKm * 0.45); // brosten/grus koncentreres i 2. halvdel
  for (let i = 0; i < bodyCount; i++) {
    const length_km = randFloat(rng, spec.length[0], spec.length[1], 1);
    if (cursor + length_km > bodyLimitKm) break;
    sectors.push({ kind: spec.kind, start_km: Math.round(cursor), length_km, name: namer.sector(i, spec.kind) });
    cursor += length_km + randInt(rng, 4, 12);
  }
  if (!anchorFinale) return sectors;

  const length_km = randFloat(rng, spec.length[0], spec.length[1], 1);
  const endOffsetKm = randFloat(rng, FINALE_SECTOR_END_KM_FROM_FINISH[0], FINALE_SECTOR_END_KM_FROM_FINISH[1], 1);
  const start_km = Math.round(distanceKm - endOffsetKm - length_km);
  if (start_km <= cursor) return sectors; // defensivt: bør ikke ske med reserven ovenfor
  sectors.push({ kind: spec.kind, start_km, length_km, name: namer.sector(sectors.length, spec.kind) });
  return sectors;
}

function elevationGain(climbs, profileType, distanceKm) {
  const fromClimbs = climbs.reduce((s, c) => s + Math.round((c.length_km * 1000 * c.avg_gradient) / 100), 0);
  // #2789: den flade "itt" skalerer med distancen (se ITT_ELEVATION_PER_KM); alle andre
  // profiler (inkl. itt_hilly, ttt) bruger uændret det faste BASE_ELEVATION-opslag.
  const base = profileType === "itt" ? Math.round(distanceKm * ITT_ELEVATION_PER_KM) : (BASE_ELEVATION[profileType] ?? 300);
  return fromClimbs + base;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// S5-etapeprofiler (#6359, Spor 1): stigningerne trækkes FØRST, typen afledes af dem.
//
// Spec: docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md (design-go ejer 12/10).
// Byg-plan: docs/superpowers/plans/2026-10-13-s5-etapeprofiler-byg-plan.md, Spor 1.
//
// ROD-ÅRSAGEN (#6359). v5's CLIMB_SPEC trak stigningerne UD FRA en allerede valgt type med
// overlappende spænd: en `hilly` kunne trække to lange kat. 2 (= mellembjerg efter ejerens
// regel), en `mountain` kunne lande uden kat. 1. Typen og ruten sagde derfor to forskellige
// ting om samme etape. S5-stien vender det om: et terræn-MÅL vælger en stignings-skabelon
// hvis udfald altid opfylder netop dét terræns regel, og typen LÆSES bagefter af ruten med
// deriveTerrainType (spec §2, B+). Skabelonerne overlapper ikke, så "type == B+(climbs)"
// holder for hver etape - det er en egenskab testen håndhæver, ikke et håb.
//
// HVAD DER IKKE ÆNDRES. Alt ovenfor (v5-stien, attachRoute) er bit-identisk. S5-stien er en
// SÆRSKILT indgang (attachRouteS5) som raceStageProfileGenerator.js kun kalder når
// kalderen beder om S5-modellen (profileModel: "s5").
// ═══════════════════════════════════════════════════════════════════════════════════

// Spec §2's længdegrænser for kat. 2.
export const S5_CAT2_LONG_MIN_KM = 5;
export const S5_CAT2_SINGLE_MEDIUM_MIN_KM = 8;
const KM_EPS = 1e-9;

/**
 * Terræn-reglen B+ (spec §2, rettet på kort 5). Første regel der passer, oppefra:
 *   højbjerg     ≥ 1 HC eller ≥ 3 × kat. 1
 *   bjerg        ≥ 1 × kat. 1
 *   mellembjerg  ≥ 2 × kat. 2 på mindst 5 km, eller 1 × kat. 2 på mindst 8 km,
 *                eller kat. 2 på mindst 5 km som bjergtopmål
 *   kuperet      kat. 3 eller kort kat. 2 (kat. 4 tæller ALDRIG mod kuperet)
 *   bølget       2 × kat. 4
 *   flad         højst 1 × kat. 4
 * En kat. 2 der ikke opfylder mellembjerg-reglen, er "kort" i reglens forstand og tæller
 * som kuperet (ellers ville en enlig 6 km kat. 2 gøre etapen flad).
 *
 * Ren funktion. Ukendte kategorier ignoreres.
 * @param {Array<{category: string, length_km: number, summit_finish?: boolean}>} climbs
 * @returns {"flat"|"rolling"|"hilly"|"medium_mountain"|"mountain"|"high_mountain"}
 */
export function deriveTerrainType(climbs = []) {
  let hc = 0, cat1 = 0, cat2 = 0, cat2Long = 0, cat2Single = 0, cat3 = 0, cat4 = 0;
  let cat2LongSummit = false;
  for (const c of Array.isArray(climbs) ? climbs : []) {
    const cat = String(c?.category ?? "");
    const len = Number(c?.length_km);
    if (cat === "HC") hc += 1;
    else if (cat === "1") cat1 += 1;
    else if (cat === "2") {
      cat2 += 1;
      if (Number.isFinite(len) && len >= S5_CAT2_LONG_MIN_KM - KM_EPS) {
        cat2Long += 1;
        if (c?.summit_finish === true) cat2LongSummit = true;
        if (len >= S5_CAT2_SINGLE_MEDIUM_MIN_KM - KM_EPS) cat2Single += 1;
      }
    } else if (cat === "3") cat3 += 1;
    else if (cat === "4") cat4 += 1;
  }
  if (hc >= 1 || cat1 >= 3) return "high_mountain";
  if (cat1 >= 1) return "mountain";
  if (cat2Long >= 2 || cat2Single >= 1 || cat2LongSummit) return "medium_mountain";
  if (cat3 >= 1 || cat2 >= 1) return "hilly";
  if (cat4 >= 2) return "rolling";
  return "flat";
}

// Kort kat. 2 (spec §2): en stejl, kort stigning der er kat. 2 på grund af gradienten, ikke
// længden. Altid under S5_CAT2_LONG_MIN_KM, så den aldrig udløser mellembjerg-reglen.
const S5_SHORT_CAT2_PROFILE = Object.freeze({ length: [2.5, 4.5], grad: [7.0, 9.0] });
// En enlig kat. 2 på et mellembjerg skal selv bære reglen (1 × kat. 2 på mindst 8 km).
const S5_SINGLE_MEDIUM_CAT2_PROFILE = Object.freeze({ length: [S5_CAT2_SINGLE_MEDIUM_MIN_KM, 10], grad: [5.5, 7.5] });

// Stignings-skabelon pr. terræn-mål. Hvert felt er [min, max] antal (uniformt) eller
// `chance` (0/1-træk). Antallene er sat så gennemsnittet pr. etape følger benchmarkens 315
// Grand Tour-etaper (backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json, kategori-strengene pr.
// terræn), og så skabelonen ALDRIG kan lande i et andet terræn efter B+:
//   flad:        højst én kat. 4
//   bølget:      kun kat. 4, mindst to
//   kuperet:     mindst én kat. 3; kat. 2 kun som kort kat. 2
//   mellembjerg: ingen kat. 1/HC; mindst to lange kat. 2, eller én på mindst 8 km
//   bjerg:       én eller to kat. 1, ingen HC
//   højbjerg:    præcis én HC (v5's "én HC pr. højbjergetape" bevares, så GT'ens HC-total
//                stadig er lig antallet af højbjergetaper, jf. buildClimbs ovenfor)
export const S5_CLIMB_TEMPLATES = Object.freeze({
  flat:            Object.freeze({ cat4: [0, 1] }),
  rolling:         Object.freeze({ cat4: [2, 3] }),
  hilly:           Object.freeze({ cat3: [1, 2], cat4: [0, 3], shortCat2Chance: 0.35 }),
  medium_mountain: Object.freeze({ cat2: [1, 3], cat3: [0, 2], cat4Chance: 0.23 }),
  mountain:        Object.freeze({ cat1: [1, 2], cat2: [0, 2], cat3: [0, 2], cat4Chance: 0.15 }),
  high_mountain:   Object.freeze({ hc: [1, 1], cat1: [0, 3], cat2: [0, 1], cat3Chance: 0.39, cat4Chance: 0.18 }),
});

/** @typedef {() => number} S5Rng */
/** @typedef {{ category: string, length_km: number, avg_gradient: number }} S5DrawnClimb */

/** @param {S5Rng} rng @param {number[] | undefined} range */
function drawCount(rng, range) { return range ? randInt(rng, range[0], range[1]) : 0; }
/** @param {S5Rng} rng @param {number | undefined} p */
function drawChance(rng, p) { return p ? (rng() < p ? 1 : 0) : 0; }

/**
 * @param {S5Rng} rng
 * @param {string} category
 * @param {{ length: number[], grad: number[] }} [profile]
 * @returns {S5DrawnClimb}
 */
function makeClimb(rng, category, profile = /** @type {Record<string, { length: number[], grad: number[] }>} */ (CAT_PROFILE)[category]) {
  return {
    category,
    length_km: randFloat(rng, profile.length[0], profile.length[1], 1),
    avg_gradient: randFloat(rng, profile.grad[0], profile.grad[1], 1),
  };
}

/**
 * Træk stignings-SÆTTET (kategori, længde, gradient) for et terræn-mål, før placeringen.
 * Rækkefølge: lettest først, hårdest sidst (samme "bygger mod klimaks" som buildClimbs).
 * Ikke-terræn-typer (brosten, grus, klassiker, kuperet enkeltstart) bruger v5's
 * kategori-pulje uændret; deres terræn læses af B+ bagefter.
 *
 * @param {S5Rng} rng
 * @param {string} targetType
 * @returns {S5DrawnClimb[]}
 */
export function drawS5ClimbSet(rng, targetType) {
  /** @type {Record<string, any>} */
  const templates = S5_CLIMB_TEMPLATES;
  const tpl = templates[targetType];
  /** @type {S5DrawnClimb[]} */
  const set = [];
  if (!tpl) {
    const spec = CLIMB_SPEC[targetType] ?? CLIMB_SPEC.flat;
    const n = randInt(rng, spec.count[0], spec.count[1]);
    for (let i = 0; i < n && spec.cats.length; i++) set.push(makeClimb(rng, spec.cats[randInt(rng, 0, spec.cats.length - 1)]));
  } else {
    const nHc = drawCount(rng, tpl.hc);
    const n1 = drawCount(rng, tpl.cat1);
    const n2 = drawCount(rng, tpl.cat2);
    const nShort2 = drawChance(rng, tpl.shortCat2Chance);
    const n3 = drawCount(rng, tpl.cat3) + drawChance(rng, tpl.cat3Chance);
    const n4 = drawCount(rng, tpl.cat4) + drawChance(rng, tpl.cat4Chance);
    for (let i = 0; i < n4; i++) set.push(makeClimb(rng, "4"));
    for (let i = 0; i < n3; i++) set.push(makeClimb(rng, "3"));
    for (let i = 0; i < nShort2; i++) set.push(makeClimb(rng, "2", S5_SHORT_CAT2_PROFILE));
    const single = targetType === "medium_mountain" && n2 === 1;
    for (let i = 0; i < n2; i++) set.push(makeClimb(rng, "2", single ? S5_SINGLE_MEDIUM_CAT2_PROFILE : CAT_PROFILE["2"]));
    for (let i = 0; i < n1; i++) set.push(makeClimb(rng, "1"));
    for (let i = 0; i < nHc; i++) set.push(makeClimb(rng, "HC"));
  }
  // Stabil sortering: kategori (lettest først), inden for kategori kortest først, så den
  // længste af den hårdeste kategori bliver klimakset.
  return set
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (CAT_ORDER[b.c.category] - CAT_ORDER[a.c.category]) || (a.c.length_km - b.c.length_km) || (a.i - b.i))
    .map(({ c }) => c);
}

// ── Afslutningen (spec §3): geometri, ikke udfald ─────────────────────────────────
//
// Nedkørsel: sidste top 5-25 km før mål, og den top er kat. 3 eller hårdere (kort 5).
export const S5_DESCENT_TOP_WINDOW_KM = Object.freeze([5, 25]);
// Alle andre landevejs-afslutninger: sidste kategoriserede top ligger UDEN FOR
// nedkørsels-vinduet ("flad spurt langt efter sidste top", spec §3), så en flad spurt
// aldrig ligner en nedkørsels-etape i ruten.
const S5_OPEN_FINISH_LAST_TOP_KM = Object.freeze([26, 45]);
// Afslutnings-rampen for de tre korte opad-afslutninger (spec §3). Rampen er IKKE en
// kategoriseret stigning: den er afslutningens egen akse og flytter aldrig terrænet.
export const S5_FINISH_RAMPS = Object.freeze({
  uphill_sprint: Object.freeze({ length: [0.5, 1.0], grad: [2.0, 5.0] }),
  wall_finish:   Object.freeze({ length: [0.5, 1.4], grad: [10.0, 20.0] }),
  punch:         Object.freeze({ length: [1.0, 3.0], grad: [5.0, 8.0] }),
});
// Bjergtop pr. terræn (spec §3): hvilken kategori målstigningen skal have.
export const S5_SUMMIT_CATEGORIES = Object.freeze({
  medium_mountain: Object.freeze(["2"]),
  mountain: Object.freeze(["1"]),
  high_mountain: Object.freeze(["1", "HC"]),
});

// Vejens ikke-kategoriserede bølgen (#6366): højdemeter pr. km UDEN FOR de kategoriserede
// stigninger. ÉT tal for alle etaper, så højdemeterne beskriver ruten (distance +
// stigninger + afslutnings-rampe) og ikke etiketten - v5's BASE_ELEVATION gav hver TYPE et
// fast grundtal uanset ruten. Tallet er fundet ved mindste kvadraters tilpasning af
// benchmarkens højdemeter mod distance og stigningernes egen stigning; stignings-leddet
// landede selv på ~1, hvilket er det modellen forudsætter.
export const S5_ROAD_UNDULATION_M_PER_KM = 8;

/** @param {number | string} lengthKm @param {number | string} gradientPct */
function climbGainM(lengthKm, gradientPct) {
  return Math.round((Number(lengthKm) * 1000 * Number(gradientPct)) / 100);
}

/**
 * @param {{ climbs?: Array<{ length_km: number, avg_gradient: number }>, distanceKm?: number,
 *   finishRamp?: { ramp_km: number, ramp_gradient: number } | null }} [args]
 */
export function elevationGainS5({ climbs = [], distanceKm = 0, finishRamp = null } = {}) {
  const fromClimbs = climbs.reduce((s, c) => s + climbGainM(c.length_km, c.avg_gradient), 0);
  const fromRamp = finishRamp ? climbGainM(finishRamp.ramp_km, finishRamp.ramp_gradient) : 0;
  return fromClimbs + fromRamp + Math.round(Number(distanceKm) * S5_ROAD_UNDULATION_M_PER_KM);
}

/**
 * Kaster hvis (terræn, afslutning) ligger uden for matrixen (spec §3).
 * @param {string} terrain
 * @param {string} finish
 */
export function assertFinishAllowed(terrain, finish) {
  if (!isFinishAllowedS5(terrain, finish)) {
    throw new Error(`S5 matrix: finish "${finish}" is not allowed on terrain "${terrain}" (spec §3)`);
  }
}

// Placér stignings-sættet på ruten givet afslutningen. Den sidste stigning i sættet er
// klimakset. Bjergtop: klimakset topper på stregen. Nedkørsel: klimakset topper 5-25 km
// før mål. Andre: klimakset topper 26-45 km før mål. De øvrige stigninger fordeles med
// tilfældige mellemrum mellem km 5 og klimaksets fod, så stigningerne aldrig overlapper.
/**
 * @param {S5Rng} rng
 * @param {S5DrawnClimb[]} set
 * @param {string} finish
 * @param {number} distanceKm
 * @param {{ climb: () => string }} namer
 */
function placeS5Climbs(rng, set, finish, distanceKm, namer, { summitClimax = false } = {}) {
  if (!set.length) return [];
  const n = set.length;
  const last = set[n - 1];
  let lastCrest;
  if (finish === "long_climb" || summitClimax) lastCrest = distanceKm;
  else if (finish === "descent") lastCrest = distanceKm - randInt(rng, S5_DESCENT_TOP_WINDOW_KM[0], S5_DESCENT_TOP_WINDOW_KM[1]);
  else lastCrest = distanceKm - randInt(rng, S5_OPEN_FINISH_LAST_TOP_KM[0], S5_OPEN_FINISH_LAST_TOP_KM[1]);
  const anchor = lastCrest - last.length_km; // klimaksets fod
  const START_KM = 5;
  const bodyLen = set.slice(0, -1).reduce((s, c) => s + c.length_km, 0);
  const free = Math.max(0, anchor - START_KM - bodyLen);
  const weights = Array.from({ length: n }, () => 0.2 + rng());
  const wSum = weights.reduce((s, w) => s + w, 0);
  const climbs = [];
  let cursor = START_KM + (free * weights[0]) / wSum;
  for (let i = 0; i < n - 1; i++) {
    const c = set[i];
    const crest = cursor + c.length_km;
    climbs.push({ name: namer.climb(), category: c.category, crest_km: Math.round(crest), length_km: c.length_km, avg_gradient: c.avg_gradient, summit_finish: false });
    cursor = crest + (free * weights[i + 1]) / wSum;
  }
  climbs.push({
    name: namer.climb(), category: last.category, crest_km: Math.round(lastCrest),
    length_km: last.length_km, avg_gradient: last.avg_gradient, summit_finish: finish === "long_climb" || summitClimax,
  });
  return climbs;
}

/**
 * #6857: en signatur-stigning med topmål på et terræn hvor matrixen ikke tillader bjergtop
 * (kuperet/bølget/flad, fx en kort stejl helling på stregen). Etapen ender da på den
 * stejleste opad-afslutning matrixen tillader for terrænet, valgt af stigningens gradient.
 * Ingen rng. null = matrixen har ingen opad-afslutning (kaster hos kalderen).
 * @param {string} terrain @param {number} gradient
 * @returns {string | null}
 */
export function summitFinishFor(terrain, gradient) {
  const allowed = /** @type {Record<string, readonly string[]>} */ (FINISH_MATRIX_S5)[terrain] ?? [];
  if (allowed.includes("long_climb")) return "long_climb";
  const wanted = gradient >= 10 ? ["wall_finish", "punch", "uphill_sprint"] : gradient >= 5 ? ["punch", "wall_finish", "uphill_sprint"] : ["uphill_sprint", "punch", "wall_finish"];
  return wanted.find((f) => allowed.includes(f)) ?? null;
}

// ── #6857 Løbsidentitet: signaturen i ruten (pass 2) ────────────────────────────────
//
// Et løbs signatur-stigning går igen hvert år (ejer 18/10). Pass 1 har allerede givet
// etapen det terræn stigningen selv giver efter B+ (raceStageProfileGenerator.signatureLockFor),
// så her udskiftes kun klimakset (sættets sidste stigning) med signaturens kategori, længde
// og gradient. Placeringen, afstanden til mål og alle andre stigninger varierer stadig pr.
// sæson. Terrænet læses igen bagefter; skifter det, kaster vi (fail-closed, design §2) i
// stedet for at skrive en etape hvis type og rute siger to forskellige ting.

/**
 * Udskift klimakset i et trukket stignings-sæt med signaturens stigning. Ren.
 * @param {S5DrawnClimb[]} set  sorteret lettest først (drawS5ClimbSet)
 * @param {{ name?: string, category: string, length_km: number, avg_gradient: number, summit_finish?: boolean }} feature
 * @returns {Array<S5DrawnClimb & { summit_finish: boolean }>}
 */
export function applySignature(set, feature) {
  const before = deriveTerrainType(set);
  const sig = {
    category: feature.category, length_km: feature.length_km, avg_gradient: feature.avg_gradient,
    summit_finish: feature.summit_finish === true,
  };
  const out = [...set.slice(0, -1).map((c) => ({ ...c, summit_finish: false })), sig];
  const after = deriveTerrainType(out);
  if (after !== before) {
    throw new Error(`signature climb "${feature.name ?? "?"}" changes the stage terrain from ${before} to ${after} (#6857)`);
  }
  return out;
}

/**
 * Signatur-sektoren erstatter etapens sidste sektor (finale-sektoren på brosten/grus) med
 * sit navn og sin længde, og ligger stadig helt inden for ruten. Ren.
 * @param {any[]} sectors @param {{ name: string, length_km: number, surface: string }} feature @param {number} distanceKm
 */
export function applySectorSignature(sectors, feature, distanceKm) {
  const length_km = feature.length_km;
  const maxStart = Math.max(0, Math.floor(distanceKm - length_km - 2));
  if (!sectors.length) {
    return [{ kind: feature.surface, start_km: Math.max(0, Math.round(distanceKm - 6 - length_km)), length_km, name: feature.name }];
  }
  const last = sectors[sectors.length - 1];
  if (last.kind !== feature.surface) throw new Error(`signature sector "${feature.name}" is ${feature.surface} on a ${last.kind} stage (#6857)`);
  const prevEnd = sectors.length > 1 ? sectors[sectors.length - 2].start_km + sectors[sectors.length - 2].length_km : 0;
  const start_km = Math.max(Math.ceil(prevEnd + 1), Math.min(last.start_km, maxStart));
  if (start_km + length_km > distanceKm) throw new Error(`signature sector "${feature.name}" does not fit on a ${distanceKm} km stage (#6857)`);
  return [...sectors.slice(0, -1), { ...last, start_km, length_km, name: feature.name }];
}

/**
 * Bandopslag for S5: mellembjerg har (endnu) intet eget bånd og bruger sin pladsholder-kilde.
 * @param {string} profileType
 * @returns {string}
 */
function s5BandKey(profileType) {
  return /** @type {Record<string, string>} */ (S5_PLACEHOLDER_SOURCE_PROFILE)[profileType] ?? profileType;
}

/**
 * S5-rute (pass 2) for én etape. Stigningerne trækkes først, terrænet læses af dem (B+),
 * afslutningen vælges INDEN FOR matrixen af `chooseFinish(terrain)`, og først derefter
 * placeres stigningerne efter afslutningens geometri. Ren og deterministisk: samme
 * rute-rng-strøm (seed + ":route:" + etape) som v5, men en anden rækkefølge af træk.
 *
 * @param {{stage_number:number, profile_type:string}} stage  profile_type = terræn-målet
 * @param {any} race
 * @param {boolean} isStageRace
 * @param {{ chooseFinish: (terrain: string, constraint?: { summit?: boolean | null }) => string, shortItt?: boolean, signature?: any }} opts
 *   chooseFinish  vælger afslutningen for det afledte terræn (tidskørsler: "solo_tt")
 *   shortItt      Grand Tour-ugestrukturens korte enkeltstart (spec §5): prolog-båndet
 *   signature     #6857: løbets signatur-feature for netop denne etape (climb/summit_finish/
 *                 sector). Udeladt = uændret rute-strøm og output.
 * @returns {{distance_km: number, elevation_gain_m: number, climbs: any[], sprints: any[], sectors: any[], terrain: string, finale_type: string}}
 */
export function attachRouteS5(stage, race, isStageRace, { chooseFinish, shortItt = false, signature = null } = /** @type {any} */ ({})) {
  const target = stage.profile_type;
  const rng = makeRng(stableSeed(routeSeedKey(race, stage.stage_number)));
  const namer = makeRegionNamer(rng, regionOf(race?.name));
  const isGrandTour = isStageRace && race?.terrain_archetype === GRAND_TOUR_ARCHETYPE;
  const bandKey = s5BandKey(target);

  // Distance: samme bånd og samme forrangsregler som attachRoute (GT > klasse > terræn).
  // Den korte enkeltstart i en Grand Tour er ALTID prolog-båndet (spec §5: "én kort
  // enkeltstart tidligt"); ellers gælder v5's prolog-træk for etape 1.
  const isProlog = target === "itt" && isStageRace && (shortItt || (stage.stage_number === 1 && rng() < PROLOGUE_PROBABILITY));
  const classBand = !isStageRace && race?.race_class ? CLASS_DISTANCE_BANDS[race.race_class] : null;
  const prologueBand = isGrandTour ? GRAND_TOUR_PROLOGUE_DISTANCE_BAND : PROLOGUE_DISTANCE_BAND;
  const grandTourBand = isGrandTour ? GRAND_TOUR_DISTANCE_BANDS[bandKey] : null;
  const [lo, hi] = isProlog ? prologueBand : (classBand ?? grandTourBand ?? DISTANCE_BANDS[bandKey] ?? DISTANCE_BANDS.flat);
  let distance_km = isTimeTrialProfile(target) ? randInt(rng, lo, hi) : round5(randInt(rng, lo, hi));
  if (distance_km < lo) distance_km = lo;
  if (distance_km > hi) distance_km = hi;

  // Tidskørsler: v5's stigninger (en kuperet enkeltstart har 1-2 små stigninger) og ingen
  // terræn-matrix (spec §3: enkeltstart/holdtidskørsel står uden for matrixen).
  if (isTimeTrialProfile(target)) {
    const climbs = buildClimbs(rng, target, "solo_tt", distance_km, namer);
    const sprints = buildSprints(rng, target, "solo_tt", distance_km, isStageRace, climbs);
    return {
      distance_km, elevation_gain_m: elevationGainS5({ climbs, distanceKm: distance_km }),
      climbs, sprints, sectors: [], terrain: deriveTerrainType(climbs), finale_type: "solo_tt",
    };
  }

  const drawn = drawS5ClimbSet(rng, target);
  // #6857: signatur-stigningen udskifter klimakset (kaster hvis terrænet skifter).
  const sigClimb = signature && (signature.kind === "climb" || signature.kind === "summit_finish") ? signature : null;
  const set = sigClimb ? applySignature(drawn, sigClimb) : drawn;
  // Terrænet læses af SÆTTET før placeringen. Placeringen kan kun tilføje bjergtop-
  // tilfældet af mellembjerg-reglen, og afslutningen vælges inden for matrixen af netop
  // dette terræn, så det endelige B+ nedenfor er altid det samme (testen håndhæver det).
  const terrain = deriveTerrainType(set);
  const sigSummit = sigClimb?.summit_finish === true;
  let finale_type;
  if (!sigClimb) finale_type = chooseFinish(terrain);
  else if (!sigSummit) finale_type = chooseFinish(terrain, { summit: false });
  else {
    // Topmål: bjergtop hvor matrixen tillader det, ellers den stejle opad-afslutning.
    finale_type = summitFinishFor(terrain, sigClimb.avg_gradient);
    if (!finale_type) throw new Error(`signature climb "${sigClimb.name}" finishes on the line, but terrain ${terrain} has no uphill finish (#6857)`);
    if (finale_type === "long_climb") finale_type = chooseFinish(terrain, { summit: true });
  }
  assertFinishAllowed(terrain, finale_type);
  if (finale_type === "long_climb") {
    const summitCat = set.length ? set[set.length - 1].category : null;
    if (!(S5_SUMMIT_CATEGORIES[terrain] ?? []).includes(summitCat)) {
      throw new Error(`S5 matrix: summit finish on "${terrain}" requires category ${(S5_SUMMIT_CATEGORIES[terrain] ?? []).join("/")}, got "${summitCat}"`);
    }
  }
  if (finale_type === "descent") {
    const topCat = set.length ? set[set.length - 1].category : null;
    if (!(topCat in CAT_ORDER) || CAT_ORDER[topCat] > CAT_ORDER["3"]) {
      throw new Error(`S5 matrix: descent finish requires a last top of category 3 or harder, got "${topCat}"`);
    }
  }
  const climbs = sigClimb
    ? placeS5Climbs(rng, set, finale_type, distance_km, namer, { summitClimax: sigSummit })
    : placeS5Climbs(rng, set, finale_type, distance_km, namer);
  if (sigClimb) climbs[climbs.length - 1] = { ...climbs[climbs.length - 1], name: sigClimb.name };

  const rampSpec = S5_FINISH_RAMPS[finale_type];
  const finishRamp = rampSpec
    ? { ramp_km: randFloat(rng, rampSpec.length[0], rampSpec.length[1], 1), ramp_gradient: randFloat(rng, rampSpec.grad[0], rampSpec.grad[1], 1) }
    : null;
  const sprints = buildSprints(rng, target, finale_type, distance_km, isStageRace, climbs)
    .map((s) => (s.kind === "finish" && finishRamp ? { ...s, ...finishRamp } : s));
  const drawnSectors = buildSectors(rng, target, distance_km, namer);
  const sectors = signature?.kind === "sector" ? applySectorSignature(drawnSectors, signature, distance_km) : drawnSectors;
  return {
    distance_km,
    elevation_gain_m: elevationGainS5({ climbs, distanceKm: distance_km, finishRamp }),
    climbs, sprints, sectors,
    terrain: deriveTerrainType(climbs),
    finale_type,
  };
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
  // #4288: GT-baandet slaar terraen-baandet (samme foelge-orden som #4104's klasse-baand),
  // men KUN for etaper i et etapeloeb med grand_tour-arketypen. Valget koster INGEN
  // rng-traekning, saa alle andre loeb er bit-identiske med foer.
  const isGrandTour = isStageRace && race?.terrain_archetype === GRAND_TOUR_ARCHETYPE;
  // #4104: klasse-baandet vinder over terraen-baandet, men KUN for endagsloeb (et
  // monument er pr. definition et endagsloeb) og KUN naar race_class faktisk er sat.
  // Kalder-stier der bygger et delvist seedRace-objekt uden race_class falder derfor
  // uaendret gennem terraen-baandet i stedet for at kaste - samme defensive linje som
  // #3620's "undefined er ikke det samme som null"-laering.
  const classBand = !isStageRace && race?.race_class ? CLASS_DISTANCE_BANDS[race.race_class] : null;
  const prologueBand = isGrandTour ? GRAND_TOUR_PROLOGUE_DISTANCE_BAND : PROLOGUE_DISTANCE_BAND;
  const grandTourBand = isGrandTour ? GRAND_TOUR_DISTANCE_BANDS[pt] : null;
  const [lo, hi] = isProlog ? prologueBand : (classBand ?? grandTourBand ?? DISTANCE_BANDS[pt] ?? DISTANCE_BANDS.flat);
  let distance_km = isTimeTrialProfile(pt) ? randInt(rng, lo, hi) : round5(randInt(rng, lo, hi));
  if (distance_km < lo) distance_km = lo; // round5 må aldrig skyde under båndet
  if (distance_km > hi) distance_km = hi;

  const climbs = buildClimbs(rng, pt, stage.finale_type, distance_km, namer);
  const sprints = buildSprints(rng, pt, stage.finale_type, distance_km, isStageRace, climbs);
  const sectors = buildSectors(rng, pt, distance_km, namer);
  return { distance_km, elevation_gain_m: elevationGain(climbs, pt, distance_km), climbs, sprints, sectors };
}
