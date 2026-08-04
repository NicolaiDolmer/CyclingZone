// backend/lib/raceStageOrderProfiles.js
// #3326 (ejer-anmodet research 4/8): finale-drevne ordnings-arketyper som DATA — samme
// princip som tierCalendarGuarantees.js (#3327/#3328) — så vægtene kan justeres uden
// deploy. Løser den hårde crescendo-sortering i raceStageProfileGenerator.js, hvor
// STAGE_ORDER_HINT + jitter 0-0.5 (hint-afstand ≥1.0) gjorde at flad ALTID var etape 1
// og bjerg/high_mountain ALTID sidst — verificeret 0% åbner i bjergene, 84% slutter der,
// 0% slutter fladt/enkeltstart, 24 løb delte præcis samme profil-sekvens (#3326-issue).
//
// Researchen (#3326-issue-kommentar, 12 rigtige WorldTour-etapeløb, ejer-forankret —
// METODE-FORBEHOLD: ikke et systematisk udtræk fra en struktureret database, tallene er
// retningsgivende. Bør udvides mod en struktureret kilde, fx ProCyclingStats' etape-typer
// over 3-5 sæsoner, FØR båndene låses — se PR-body) fandt fire finale-arketyper:
//
//   sprint_finale   ~40% — hårdeste etape næstsidst/tredjesidst, sidste etape flad.
//                    Model: Tirreno-Adriatico, Danmark Rundt, Renewi Tour.
//   summit_finale   ~25% — nuværende crescendo-form (uændret for denne gren).
//                    Model: Itzulia Baskerlandet, Vuelta.
//   tt_finale       ~25% — afgørende enkeltstart sidst.
//                    Model: Tour de Suisse, Tour de Pologne, Tour de Romandie.
//   circuit_finale  ~10% — kuperet kredsløb, GC typisk allerede afgjort.
//                    Model: Volta a Catalunya (Montjuïc).
//
// Grand tours er UDENFOR denne fordeling — de beholder deres egen (ejer-bekræftede,
// 21-etapers) form via ARCHETYPE_PROFILES.grand_tour.legacyOrder i
// raceStageProfileGenerator.js. Denne fil rører ALDRIG grand_tour.

export const ORDER_ARCHETYPES = Object.freeze(["sprint_finale", "summit_finale", "tt_finale", "circuit_finale"]);

// Default-vægte — gælder ALLE ikke-GT etapeløbs-arketyper (mountain_tour, hilly_tour,
// balanced_week, cobbled_tour) OG den generiske (ukendt/manglende terrain_archetype)
// fallback, MEDMINDRE en arketype-specifik override findes i
// ORDER_WEIGHTS_BY_ARCHETYPE nedenfor. Kalibreret direkte mod research-tabellen.
export const DEFAULT_ORDER_WEIGHTS = Object.freeze([
  Object.freeze({ value: "sprint_finale", weight: 40 }),
  Object.freeze({ value: "summit_finale", weight: 25 }),
  Object.freeze({ value: "tt_finale", weight: 25 }),
  Object.freeze({ value: "circuit_finale", weight: 10 }),
]);

// Arketype-specifikke overrides — kun hvor terrænet reelt begrunder en anden fordeling
// end default'en. Løb der ikke er nævnt her (mountain_tour, hilly_tour, balanced_week,
// cobbled_tour) bruger DEFAULT_ORDER_WEIGHTS uændret.
export const ORDER_WEIGHTS_BY_ARCHETYPE = Object.freeze({
  // summit_tour garanterer 2× high_mountain (§ARCHETYPE_PROFILES) — dens navn OG
  // formål er top-finish-tung. Behold en højere summit-vægt end default, men lad den
  // stadig variere (ikke 100% crescendo, som førhen).
  summit_tour: Object.freeze([
    Object.freeze({ value: "sprint_finale", weight: 20 }),
    Object.freeze({ value: "summit_finale", weight: 50 }),
    Object.freeze({ value: "tt_finale", weight: 20 }),
    Object.freeze({ value: "circuit_finale", weight: 10 }),
  ]),
  // sprinter_tour_summits (UAE Tour-modellen): filler er KUN flad/rullende (intet
  // kuperet i multisettet nogensinde) — en kuperet kredsløbs-finale er tematisk uren
  // for et sprinter-tour, så circuit_finale er udeladt (0-vægt); de øvrige tre
  // omfordeles med sprint tungere (sprinter-tour-karakteren).
  sprinter_tour_summits: Object.freeze([
    Object.freeze({ value: "sprint_finale", weight: 50 }),
    Object.freeze({ value: "summit_finale", weight: 20 }),
    Object.freeze({ value: "tt_finale", weight: 30 }),
  ]),
});

// Opslag: terrain_archetype → ordnings-vægte (eller default ved ukendt/manglende/GT).
export function orderWeightsFor(terrainArchetype) {
  return ORDER_WEIGHTS_BY_ARCHETYPE[terrainArchetype] ?? DEFAULT_ORDER_WEIGHTS;
}

// Åbnings-variation (spec: "åbningen skal have en reel chance for prolog/ITT og
// kuperet, ikke kun flad"). Global konstant (ikke pr. arketype — researchen giver ikke
// grundlag for arketype-specifik åbnings-tuning) anvendt EFTER finale-ordningen, så den
// aldrig kan flytte den etape der allerede er placeret i finale-slottet. Kandidat-
// prioritet: itt (prolog-kandidat) > hilly > rolling. Sat til 20% for komfortabel margin
// over accept-kravet (≥10% ikke-flad åbning) — grand_tour er UDENFOR (egen openingItt).
export const OPENING_VARIETY_CHANCE = 0.20;
export const OPENING_VARIETY_CANDIDATES = Object.freeze(["itt", "hilly", "rolling"]);
