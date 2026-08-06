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
import { seasonSeedSuffix } from "./raceSeedAxis.js";
import { orderWeightsFor, OPENING_VARIETY_CHANCE, OPENING_VARIETY_CANDIDATES } from "./raceStageOrderProfiles.js";

// v1: #1102-launch (seedet på race.id). v2 (2026-06-28): seedet på løbets virkelige
// identitet (external_id) via seedIdentityFor. v3 (2026-06-28): arketype-drevet
// terrænfordeling (ARCHETYPE_PROFILES) + sæson-akse i seed'en (variation pr. sæson).
// Bump'et stempler regenererede rækker, så de kan skelnes fra ældre (intet
// runtime-guard afhænger af tallet — kun et persisteret stempel).
// v4 (2026-07-21, #2769): pass 2 (attachRoute) beriger hver etape med en rute
// (distance/climbs/sprints/sektorer) via en dedikeret rng-strøm. Pass 1 bit-identisk.
// v5 (2026-08-04, #3326, ejer-anmodet research): erstattede den globale
// STAGE_ORDER_HINT-crescendo-sortering (0% åbnede i bjergene, 84% sluttede der, 24 løb
// delte samme profil-sekvens) med finale-drevne ordnings-arketyper
// (raceStageOrderProfiles.js) for ALLE ikke-GT etapeløb + generisk fallback.
// KORREKTION 2026-08-04 (samme dag, FØR merge — ejeren afviste 12-løbs-kalibreringen):
// udvidet til 41 løb/407 etaper (struktureret Wikipedia-optælling, se
// docs/research/2026-08-04-stage-race-structure/) viste at ALLE fire finale-vægte var
// forkerte, OG at grand_tour's oprindelige "behold crescendo uændret"-plan var forkert
// — 0/9 rigtige grand tours sluttede på bjerg i tre sæsoner. grand_tour har derfor nu
// sin EGEN ordning (ARCHETYPE_PROFILES.grand_tour.grandTourOrder — erstatter det
// tidligere legacyOrder-flag/den rene crescendo-sti, som er fjernet): hårdeste etape
// næstsidst, flad/enkeltstart sidst. Pass 1-output for ALLE etapeløb (inkl. GT) ÆNDRES
// bevidst af denne korrektion — pass1-golden.json-fixturen er regenereret. Determinisme
// bevaret: samme seed + samme types-multisæt → samme rækkefølge.
export const GENERATOR_VERSION = 5;

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
  // openingItt (#2771): GT'er åbner med enkeltstart (etape 1) — Sub-3's prolog-træk
  // i attachRoute gør den 5-8 km i ~60 % af tilfældene. Multisettet af etapetyper
  // er uændret (kun rækkefølgen), så tier-/realisme-bånd påvirkes ikke.
  // grandTourOrder (#3326, korrigeret 2026-08-04): GT er UDENFOR den finale-drevne
  // ORDER_ARCHETYPES-fordeling (ejer-bekræftet — GT'ens 21 etaper må ikke ændres), men
  // bruger IKKE længere den rene STAGE_ORDER_HINT-crescendo (hårdeste terræn sidst).
  // 41-løbs-researchen viste 0/9 rigtige grand tours (2024-2026) sluttede på bjerg —
  // flad (77,8%) eller enkeltstart (22,2%) dominerer, og hårdeste etape lå næstsidst i
  // 88,9% af tilfældene. Se orderAndBuildGrandTour/toGrandTourFinale nedenfor.
  grand_tour:     { kind: "stage", grandTourOrder: true, openingItt: true, guarantees: ["flat", "flat", "flat", "itt", "mountain", "high_mountain", "high_mountain"], filler: [{ value: "flat", weight: 22 }, { value: "rolling", weight: 19 }, { value: "hilly", weight: 22 }, { value: "mountain", weight: 16 }, { value: "high_mountain", weight: 11 }, { value: "itt", weight: 12 }] },
  mountain_tour:  { kind: "stage", guarantees: ["flat", "mountain", "mountain"], filler: [{ value: "flat", weight: 14 }, { value: "rolling", weight: 22 }, { value: "hilly", weight: 22 }, { value: "mountain", weight: 27 }, { value: "high_mountain", weight: 13 }, { value: "itt", weight: 6 }] },
  hilly_tour:     { kind: "stage", guarantees: ["flat", "hilly", "hilly"], filler: [{ value: "flat", weight: 15 }, { value: "rolling", weight: 35 }, { value: "hilly", weight: 54 }, { value: "mountain", weight: 11 }, { value: "high_mountain", weight: 3 }, { value: "itt", weight: 8 }] },
  sprinters_week: { kind: "stage", guarantees: ["flat", "mountain"], filler: [{ value: "flat", weight: 43 }, { value: "rolling", weight: 35 }, { value: "hilly", weight: 19 }, { value: "mountain", weight: 8 }, { value: "itt", weight: 6 }] },
  // #3295: itt tilføjet som GARANTI (var kun filler-vægt 10). balanced_week er
  // kalenderens største arketype (19 katalog-løb / 88 løbsdage i S2's udvalg), og den
  // manglende enkeltstart dér er hovedårsagen til at ITT lå på 6,6 % mod K-B's mål.
  // Alternativet — at skrue filler-vægten op til ~37 — ville gøre TT-LOFTET (#2029) til
  // den reelle begrænsning i stedet for vægten, hvilket er skrøbeligt: hæver nogen
  // loftet senere, eksploderer ITT-andelen uden at nogen har rørt en vægt. En garanti
  // siger derimod præcis hvad den gør: ÉN enkeltstart pr. balanceret uge-etapeløb.
  // Realisme: Paris-Nice, Tirreno-Adriatico, Tour de Romandie og Critérium du Dauphiné
  // har alle en enkeltstart i normalår — det er kendetegnende for formatet, ikke en
  // undtagelse. Loftet (max(garanterede, 2)) er uændret, så et løb kan stadig højst få 2.
  balanced_week:  { kind: "stage", guarantees: ["flat", "mountain", "itt"], filler: [{ value: "flat", weight: 26 }, { value: "rolling", weight: 32 }, { value: "hilly", weight: 29 }, { value: "mountain", weight: 14 }, { value: "high_mountain", weight: 3 }, { value: "itt", weight: 10 }] },
  // Ørken/sprinter-tur med faste bjergankomster: garanteret 1 TT + 2 bjerg, resten
  // flad/rullende (fx UAE Tour). Filler kun flad/rullende → "resten er flade".
  sprinter_tour_summits: { kind: "stage", guarantees: ["flat", "itt", "mountain", "mountain"], filler: [{ value: "flat", weight: 66 }, { value: "rolling", weight: 35 }] },

  // #2769 (Sub-1): fritstående enkeltstart-endagsløb (#2177 — 0 fritstående ITT i dag).
  itt_classic: { kind: "single", weights: [{ value: "itt", weight: 1 }] },

  // #2769: etapeløb med GARANTERET high_mountain-summit (hæver tier 3/4 summit-finishes,
  // sænker M-Down-andelen — mountain_tour garanterer kun mellembjerg/descent). high_mountain
  // sidst via STAGE_ORDER_HINT (7) → dronningeetape/top-finish. En itt-garanti giver samtidig
  // en enkeltstart i løbet.
  summit_tour: { kind: "stage", guarantees: ["flat", "mountain", "high_mountain", "high_mountain"], filler: [{ value: "flat", weight: 12 }, { value: "rolling", weight: 19 }, { value: "hilly", weight: 19 }, { value: "mountain", weight: 16 }, { value: "high_mountain", weight: 21 }, { value: "itt", weight: 8 }] },

  // #2769: etapeløb med GARANTERET brosten-etape (#2527/#2755 — 0 brosten i etapeløb i dag).
  cobbled_tour: { kind: "stage", guarantees: ["flat", "cobbles", "mountain"], filler: [{ value: "flat", weight: 26 }, { value: "rolling", weight: 32 }, { value: "cobbles", weight: 16 }, { value: "hilly", weight: 26 }, { value: "mountain", weight: 10 }, { value: "itt", weight: 6 }] },
});

// #3295 KALIBRERING (2026-08-06) — hvordan filler-vægtene ovenfor blev fundet.
//
// Ejer-beslutning 6/8: S3's kalender skal ramme K-B — flad 24 · kuperet 30 · bjerg 28 ·
// ITT 8 · brosten 6 · TTT 4 (% af løbsdage), ±2 pp pr. type. TTT-motoren mangler (#3463),
// så den aktive profil er interim: flad 24 · kuperet 32 · bjerg 28 · ITT 10 · brosten 6.
//
// Vægtene er IKKE gættet. De er de gamle vægte ganget med en kalibreret tilt og afrundet:
//
//     flad ×0,85   ·   kuperet (rolling+hilly+classic) ×1,6   ·   bjerg ×0,8
//
// Tilt'en blev fundet med `node scripts/calibrateCalendarComposition.js --season 2`, som
// kører den fulde generator-pipeline på sæsonens faktiske løbssæt for hver kandidat og
// scorer den mod BÅDE K-B-profilen OG realisme-båndene (#2755/#2769/#3347). Begge, fordi
// de trækker mod hinanden: K-B vil have bjerg ned, mens tier 3's bånd kræver mindst 8
// summit-finaler. Et tilt der rammer K-B ved at udsulte bjergene ville flytte problemet,
// ikke løse det — realisme-brud straffes derfor så hårdt at søgningen ikke kan handle
// det ene for det andet. Verificér med:
//     node scripts/calendarCompositionScorecard.js --season 2
//
// Resultat, målt over 392 løbsdage (fire tiers, én repræsentativ pulje hver):
//
//   FØR:  flad 27,3 · kuperet 28,8 · bjerg 32,9 · ITT  6,6 · brosten 4,3   (L1 16,4 pp, 4 uden for ±2)
//   EFTER: flad 25,0 · kuperet 31,9 · bjerg 27,8 · ITT 11,0 · brosten 4,3   (L1  3,9 pp, 0 uden for ±2)
//
// ITT-løftet kommer fra balanced_week's nye `itt`-GARANTI, ikke fra vægten (se noten
// dér). Brosten står stille fordi den næsten udelukkende kommer fra ENDAGSLØB
// (cobbled_classic), hvis terræn er fast pr. design — den kan kun flyttes af kataloget.
//
// HVAD VÆGTENE IKKE KAN LØSE (målt, ikke antaget): tier-spredningen. Tier 4 lander på
// 35,7 % bjerg og 5,4 % ITT, fordi 5 af dens 12 etapeløb er summit_tour — Class1 rummer
// kun 5 summit_tour + 2 balanced_week + 1 cobbled_tour som etapeløb, så tier-udvalget har
// intet andet at vælge. Tier 2's brosten (1,8 %) har samme årsag. Det er et KATALOG-
// problem, ikke et vægt-problem, og løses ikke her.


// Opslag: terrain_archetype → config (eller null ved ukendt/manglende → generisk).
// `profiles` gør tabellen injicerbar (default = produktionens ARCHETYPE_PROFILES), så en
// kalibrerings-harness kan måle KANDIDAT-vægte uden at ændre produktionskoden — samme
// princip som `generateProfiles`-parameteren i raceRouteRealismDraw.js. Kun analyse-
// stier sender noget andet ind; alle prod-kald bruger default'en.
export function archetypeFor(race, profiles = ARCHETYPE_PROFILES) {
  return profiles[race?.terrain_archetype] ?? null;
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

// Fuld seed-nøgle = løb-identitet + sæson (+ #3347's re-draw-variant). Alle grupper i
// en sæson deler nøglen (konsistens); en ny sæson giver en ny nøgle (variation pr.
// sæson, jf. spec §5.1). Uden season_id seedes på identitet alene (bagudkompatibel —
// tests/ad-hoc). season_variant 0/fraværende → nøglen er BIT-IDENTISK med før #3347.
function seedKeyFor(race) {
  const id = String(seedIdentityFor(race));
  return `${id}${seasonSeedSuffix(race)}`;
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

// Deterministisk crescendo-scaffold: sprint tidligt, bjerg sent (den oprindelige
// #1102-sortering). Bruges dels af den legacy (GT-only) sti nedenfor, dels som
// UDGANGSPUNKT for de finale-drevne ordnings-arketyper (#3326) — de tager denne
// scaffold og flytter ÉN etape (finale-slottet), resten forbliver crescendo-agtig.
function sortByHint(rng, types) {
  return types
    .map((t) => ({ t, key: STAGE_ORDER_HINT[t] + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
}

// GT-sti — kun grand_tour (ARCHETYPE_PROFILES.grand_tour.grandTourOrder) kalder denne.
// openingType-parameteren er GT'ens åbnings-ITT-træk (#2771, uændret). Ordningen af
// RESTEN er finale-drevet (toGrandTourFinale nedenfor), korrigeret 2026-08-04 — se
// GT_FLAT_FINISH_CHANCE for research-baggrunden.
function orderAndBuildGrandTour(rng, types, stages, race, openingType = null) {
  types.length = stages; // defensiv trim
  // openingType (#2771): træk ÉN forekomst ud af sorteringen og sæt den som etape 1
  // (GT-åbnings-ITT). null → ingen åbnings-ITT-udtrækning.
  let opening = null;
  if (openingType) {
    const idx = types.indexOf(openingType);
    if (idx >= 0) {
      types.splice(idx, 1);
      opening = openingType;
    }
  }
  const scaffold = sortByHint(rng, types); // crescendo-scaffold: sidste = hårdeste terræn
  let ordered = toGrandTourFinale(rng, scaffold);
  if (opening) ordered = [opening, ...ordered];
  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1, race, true));
}

// GT-finale (#3326-korrektion 2026-08-04): flyt hårdeste terræn (crescendo-scaffoldens
// sidste element) til NÆSTSIDST, og sæt en flad/rullende etape (~78%) eller en EKSTRA
// enkeltstart ud over åbnings-ITT'en (~22%, kun hvis filleren gav én) som finale.
// Model: TdF/Giro (flad, ceremoniel slutdag) hhv. Vuelta-lignende enkeltstart-slut.
// research: 0/9 rigtige grand tours (2024-2026) sluttede på bjerg; hårdeste etape lå
// næstsidst i 88,9% af tilfældene — se raceStageOrderProfiles.js-docstringen.
const GT_FLAT_FINISH_CHANCE = 0.78;
function toGrandTourFinale(rng, scaffold) {
  const arr = scaffold.slice();
  const roll = rng(); // altid forbrugt — stabilt rng-forbrug uanset gren
  if (arr.length < 2) return arr;
  const hardest = arr.pop(); // crescendo-scaffold: sidste tilbageværende = hårdeste terræn
  const ittIdx = arr.indexOf("itt"); // ekstra ITT ud over åbnings-ITT'en, hvis filler gav én
  let finale;
  if (ittIdx !== -1 && roll >= GT_FLAT_FINISH_CHANCE) {
    finale = arr.splice(ittIdx, 1)[0];
  } else {
    const flatIdx = arr.findIndex((t) => FLAT_FAMILY.has(t));
    finale = flatIdx !== -1 ? arr.splice(flatIdx, 1)[0] : arr.pop(); // defensivt — flad er altid garanteret for GT
  }
  arr.push(hardest); // hårdeste → næstsidst (88,9% i researchen)
  arr.push(finale); // flad/enkeltstart → sidst (aldrig bjerg)
  return arr;
}

// ── #3326: finale-drevne ordnings-arketyper (ikke-GT etapeløb + generisk fallback) ──
// Vægtene bor i raceStageOrderProfiles.js (data, tunbar uden deploy). Se den fils
// docstring for research-baggrunden. GT bruger ALDRIG denne sti (grandTourOrder ovenfor).

const MOUNTAIN_FAMILY = new Set(["mountain", "high_mountain"]);
const CIRCUIT_FAMILY = new Set(["hilly", "classic"]); // IKKE "rolling" — den er sprint_finale-territorium, holder finale-typerne ikke-overlappende for målbarhed
const FLAT_FAMILY = new Set(["flat", "rolling"]);

function isFeasibleOrderArchetype(name, types) {
  if (name === "tt_finale") return types.some(isTimeTrial);
  if (name === "circuit_finale") return types.some((t) => CIRCUIT_FAMILY.has(t));
  if (name === "sprint_finale") return types.some((t) => FLAT_FAMILY.has(t));
  return types.some((t) => MOUNTAIN_FAMILY.has(t)); // summit_finale + ukendt navn
}

// Konverter ÉN filler-slot (index >= protectedCount, aldrig en garanti) til targetType,
// så den ØNSKEDE finale-arketype bliver mulig uden at røre garanti-regionen. Prioriteret
// ofre-rækkefølge: flat → rolling → hilly/cobbles/classic. Ofrer ALDRIG mountain/
// high_mountain/itt — heller ikke som sidste udvej. #3326-regression fanget under
// sæson-måling: en tidligere "sidste udvej ofrer HVAD SOM HELST"-variant kunne (for
// filler-fattige arketyper som summit_tour, ofte kun 1 filler-plads) klobbe den ENESTE
// filler-plads selvom den var mountain/high_mountain, hvilket sænkede tier 3's summit-
// andel under realisme-båndet (#2755, verificeret 40/200→13/200 fail-rate-forskel på
// syntetiske sæsoner). Bjerge er IKKE fungible, flad/rullende/kuperet er. Returnerer
// false hvis der ikke findes en SIKKER filler-plads (ingen filler-plads overhovedet,
// ELLER alle filler-pladser er mountain/high_mountain/itt) — den kaldende
// resolveOrderArchetype falder da tilbage til et andet feasible ordnings-valg fremfor
// at ofre bjerg-terræn.
const FORCE_SACRIFICE_PRIORITY = Object.freeze(["flat", "rolling", "hilly", "cobbles", "classic"]);
function forceFillerType(types, protectedCount, targetType) {
  if (types.length <= protectedCount) return false;
  for (const pref of FORCE_SACRIFICE_PRIORITY) {
    for (let i = types.length - 1; i >= protectedCount; i--) {
      if (types[i] === pref) { types[i] = targetType; return true; }
    }
  }
  return false; // alle filler-pladser er mountain/high_mountain/itt — ofr dem aldrig
}

// Sikkerhedsnet når den trukne arketype hverken er feasible ELLER kan forceres (ingen
// filler-plads): vælg det bedste FEASIBLE alternativ fra samme vægt-tabel; findes intet,
// falder vi tilbage til summit_finale (altid feasible — alle stage-arketyper garanterer
// mindst ét bjerg-terræn).
function fallbackOrderArchetype(rng, types, weights, exclude) {
  const remaining = weights.filter((w) => w.value !== exclude && isFeasibleOrderArchetype(w.value, types));
  if (!remaining.length) return "summit_finale";
  return weightedPick(rng, remaining);
}

// Træk ÉN ordnings-arketype (vægtet) + gør den feasible (forcer filler om nødvendigt).
// Kan MUTERE `types` (forceFillerType) — det er tilsigtet: types er det midlertidige
// arbejds-array bygget af den kaldende builder, ikke et delt/frosset objekt.
function resolveOrderArchetype(rng, types, protectedCount, weights) {
  const picked = weightedPick(rng, weights);
  if (picked === "tt_finale" && !isFeasibleOrderArchetype("tt_finale", types)) {
    if (forceFillerType(types, protectedCount, "itt")) return picked;
    return fallbackOrderArchetype(rng, types, weights, picked);
  }
  if (picked === "circuit_finale" && !isFeasibleOrderArchetype("circuit_finale", types)) {
    if (forceFillerType(types, protectedCount, "hilly")) return picked;
    return fallbackOrderArchetype(rng, types, weights, picked);
  }
  return picked;
}

// sprint_finale: flyt ÉN flad/rullende etape til sidste plads (spec: "sidste etape
// flad"). Den hårdeste etape (crescendo-scaffoldens sidste før transform) placeres
// NÆSTSIDST langt de fleste gange (SPRINT_FINALE_EARLY_DECIDER_CHANCE).
//
// #3326-KORREKTION 2026-08-04: researchen (n=32) måler "hårdeste etape 3+ dage før
// finalen" til KUN 3,1% — den oprindelige 50/50 næstsidst/tredjesidst-default var
// forkert opstillet (tredjesidst "sker praktisk taget aldrig", ejer-direktiv 4/8, der
// bad om "næstsidste vs. sidste dag"). DOKUMENTERET FORTOLKNING: en LITERAL "hårdeste
// etape PÅ sidste dag" er strukturelt umulig INDEN I sprint_finale — arketypens egen
// definition ER at sidste etape er flad (det er hele grunden til at trække sprint_finale
// frem for summit_finale). Researchens "sidste dag"-andel (40,6% af ALLE ikke-GT-løb)
// realiseres derfor på ARKETYPE-niveau af summit_finale (hvor finalen SELV er den
// hårdeste etape), ikke inden i sprint_finale. Denne konstant erstatter den gamle
// tredjesidst-mulighed (50%) med researchens faktiske "tidligere end næstsidst"-andel
// (3,1%) i stedet for en selvmodsigende "hårdeste etape er flad"-gren. PROXY-FORBEHOLD:
// "hårdeste etape" måler etapeTYPE, ikke hvilken etape der reelt afgjorde klassementet
// — se docs/research/2026-08-04-stage-race-structure/README.md forbehold #1.
export const SPRINT_FINALE_EARLY_DECIDER_CHANCE = 0.03;
function toSprintFinale(rng, scaffold) {
  const n = scaffold.length;
  const rollEarly = rng() < SPRINT_FINALE_EARLY_DECIDER_CHANCE; // altid forbrugt — stabilt rng-forbrug uanset n
  if (n < 2) return scaffold.slice();
  const arr = scaffold.slice();
  // Foretræk en flad/rullende INSTANS der ikke allerede er åbneren (i>0), for variation;
  // fald tilbage til den første forekomst hvis den er den eneste.
  let flatIdx = arr.findIndex((t, i) => i > 0 && FLAT_FAMILY.has(t));
  if (flatIdx === -1) flatIdx = arr.findIndex((t) => FLAT_FAMILY.has(t));
  if (flatIdx === -1) return arr; // defensivt — flad er altid garanteret et sted
  const finale = arr.splice(flatIdx, 1)[0];
  if (!arr.length) { arr.push(finale); return arr; } // n var 1 (kan ikke ske for etapeløb, men totalt)
  const hardest = arr.pop(); // scaffold er crescendo — sidste tilbageværende er hårdest
  const wantEarly = rollEarly && arr.length >= 1;
  const insertAt = wantEarly ? arr.length - 1 : arr.length;
  arr.splice(Math.max(0, insertAt), 0, hardest);
  arr.push(finale);
  return arr;
}

// tt_finale: flyt den (garanterede/forcerede) enkeltstart til sidste plads. Resten
// forbliver crescendo — hvad end der var hårdest før (typisk bjerg) lander derved lige
// FØR enkeltstarten, som Tour de Suisse/Pologne/Romandie-modellen i researchen.
function toTtFinale(rng, scaffold) {
  const arr = scaffold.slice();
  const idx = arr.lastIndexOf("itt");
  if (idx === -1) return arr; // defensivt — resolveOrderArchetype har allerede sikret feasibility
  const [itt] = arr.splice(idx, 1);
  arr.push(itt);
  return arr;
}

// circuit_finale: flyt en kuperet (hilly/classic) etape til sidste plads. GC er
// "typisk allerede afgjort" fordi den hårdeste etape (var sidst i scaffolden) nu
// rykker frem — automatisk, uden ekstra logik.
function toCircuitFinale(rng, scaffold) {
  const arr = scaffold.slice();
  let idx = -1;
  for (let i = arr.length - 1; i >= 0; i--) { if (CIRCUIT_FAMILY.has(arr[i])) { idx = i; break; } }
  if (idx === -1) return arr; // defensivt — resolveOrderArchetype har allerede sikret feasibility
  const [val] = arr.splice(idx, 1);
  arr.push(val);
  return arr;
}

const ORDER_TRANSFORMS = Object.freeze({
  summit_finale: (rng, scaffold) => scaffold, // uændret crescendo — bjerg/high_mountain er allerede sidst
  sprint_finale: toSprintFinale,
  tt_finale: toTtFinale,
  circuit_finale: toCircuitFinale,
});

// Eksporteret for golden-tests: kør scaffold + transform for en EKSPLICIT ordnings-
// arketype (uden vægtet valg/forcing — testeren leverer et types-multisæt der allerede
// understøtter den ønskede arketype).
export function applyOrderArchetype(rng, types, orderArchetype) {
  const scaffold = sortByHint(rng, types);
  const transform = ORDER_TRANSFORMS[orderArchetype] ?? ORDER_TRANSFORMS.summit_finale;
  return transform(rng, scaffold);
}

// Åbnings-variation (spec: reel chance for ikke-flad åbning). Søger EFTER finale-
// ordningen, i det åbne midterfelt (index 1..length-2) — rører ALDRIG index 0's
// nuværende indhold ind i finale-slottet (length-1), så den aldrig kannibaliserer en
// allerede placeret finale (fx tt_finales enkeltstart).
export function applyOpeningVariety(rng, ordered) {
  const roll = rng(); // altid forbrugt — stabilt rng-forbrug
  if (ordered.length < 3 || roll >= OPENING_VARIETY_CHANCE) return ordered;
  for (const cand of OPENING_VARIETY_CANDIDATES) {
    for (let i = 1; i < ordered.length - 1; i++) {
      if (ordered[i] === cand) {
        const arr = ordered.slice();
        [arr[0], arr[i]] = [arr[i], arr[0]];
        return arr;
      }
    }
  }
  return ordered;
}

// Finale-drevet ordning + map til etaper. Bruges af ALLE ikke-GT etapeløbs-arketyper +
// generisk fallback (terrainArchetype=null → DEFAULT_ORDER_WEIGHTS).
function orderAndBuildFinaleDriven(rng, types, stages, race, terrainArchetype, protectedCount) {
  types.length = stages; // defensiv trim (parity med orderAndBuildGrandTour)
  const weights = orderWeightsFor(terrainArchetype);
  const orderArchetype = resolveOrderArchetype(rng, types, protectedCount, weights);
  let ordered = applyOrderArchetype(rng, types, orderArchetype);
  ordered = applyOpeningVariety(rng, ordered);
  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1, race, true));
}

// Generisk: garanterer ≥1 flad + ≥1 bjerg; kort TT muligt ved N≥5. STAGE_FILLER_WEIGHTS
// har ingen TT, så generisk kan ikke akkumulere TT fra filler ud over det indledende
// 70%-træk; TT-loftet håndhæves alligevel defensivt (guaranteed TT ⊆ de 2 første pladser).
// #3326: rækkefølgen er nu finale-drevet (DEFAULT_ORDER_WEIGHTS), ikke længere ren
// crescendo — konsistent med de kendte arketyper i stedet for en to-tier legacy-adfærd.
function buildStageRaceGeneric(rng, stages, race) {
  const types = ["flat", "mountain"];
  if (stages >= 5 && rng() < 0.7) types.push("itt");
  const protectedCount = types.length; // flad+bjerg(+evt. itt) = garantier
  while (types.length < stages) types.push(weightedPick(rng, STAGE_FILLER_WEIGHTS));
  capTimeTrials(rng, types, protectedCount, STAGE_FILLER_WEIGHTS);
  return orderAndBuildFinaleDriven(rng, types, stages, race, null, protectedCount);
}

// Arketype-drevet: garantier (force-include, trimmet til stages) + filler-vægte.
// TT-loftet (#2029) håndhæves EFTER filler er lagt på: filler-tilføjede TT ud over
// loftet re-rulles til ikke-TT-terræn, mens arketypens garanterede TT bevares.
// #3326: grandTourOrder (kun grand_tour) bruger sin egen finale-drevne GT-ordning
// (orderAndBuildGrandTour); alle andre arketyper går gennem den generelle
// ORDER_ARCHETYPES-fordeling.
function buildStageRaceArchetype(rng, stages, cfg, race) {
  const types = cfg.guarantees.slice(0, stages);
  const protectedCount = types.length; // guarantees = beskyttet region
  while (types.length < stages) types.push(weightedPick(rng, cfg.filler));
  capTimeTrials(rng, types, protectedCount, cfg.filler);
  if (cfg.grandTourOrder) return orderAndBuildGrandTour(rng, types, stages, race, cfg.openingItt ? "itt" : null);
  return orderAndBuildFinaleDriven(rng, types, stages, race, race?.terrain_archetype, protectedCount);
}

// Etapeløb: arketype-sti hvis kendt arketype, ellers generisk.
function buildStageRace(rng, stages, cfg, race) {
  return cfg?.kind === "stage" ? buildStageRaceArchetype(rng, stages, cfg, race) : buildStageRaceGeneric(rng, stages, race);
}

/**
 * Generér stage-profiler for ét løb (rør ingen DB).
 * @param {{id:string, race_type?:string, stages?:number, external_id?:string, pool_race_id?:string, season_id?:string, season_variant?:number}} race
 *   Seedes på external_id ?? pool_race_id ?? id (se seedIdentityFor) — så alle kopier
 *   af samme rigtige løb (en divisions parallelle puljer) får IDENTISK parcours.
 *   season_variant (#3347, default 0) er tier-trækkets re-draw-tæller: 0 giver præcis
 *   samme output som før #3347; n > 0 er det n'te deterministiske gen-træk. Vælges af
 *   resolveSeasonDrawVariants (raceRouteRealismDraw.js) — sæt den ALDRIG ad-hoc.
 * @param {{seed?:number, archetypeProfiles?:object}} [opts]
 *   seed              override-seed (default: stableSeed(seedIdentityFor(race)))
 *   archetypeProfiles override af ARCHETYPE_PROFILES — KUN til kalibrerings-/analyse-
 *                     harnesses (#3295). Prod-stierne sender den aldrig.
 * @returns {Array<{stage_number:number, profile_type:string, finale_type:(string|null), demand_vector:object}>}
 */
export function generateRaceStageProfiles(race, { seed, archetypeProfiles = ARCHETYPE_PROFILES } = {}) {
  if (!race?.id) throw new Error("race.id kræves");
  const isStageRace = race.race_type === "stage_race";
  const stages = isStageRace ? Math.max(2, Number(race.stages) || 2) : 1;
  const cfg = archetypeFor(race, archetypeProfiles);
  const rng = makeRng(Number.isInteger(seed) ? seed >>> 0 : stableSeed(seedKeyFor(race)));
  return isStageRace ? buildStageRace(rng, stages, cfg, race) : buildSingle(rng, cfg, race);
}
