// backend/lib/raceStageOrderProfiles.js
// #3326 (ejer-anmodet research 4/8): finale-drevne ordnings-arketyper som DATA — samme
// princip som tierCalendarGuarantees.js (#3327/#3328) — så vægtene kan justeres uden
// deploy. Løser den hårde crescendo-sortering i raceStageProfileGenerator.js, hvor
// STAGE_ORDER_HINT + jitter 0-0.5 (hint-afstand ≥1.0) gjorde at flad ALTID var etape 1
// og bjerg/high_mountain ALTID sidst — verificeret 0% åbner i bjergene, 84% slutter der,
// 0% slutter fladt/enkeltstart, 24 løb delte præcis samme profil-sekvens (#3326-issue).
//
// KORREKTION 2026-08-04: den oprindelige kalibrering (12 løb, læst som rute-guides/
// løbsreportager) er ERSTATTET af en struktureret optælling af 41 WorldTour-etapeløb /
// 407 etaper (sæson 2024-2026, Wikipedias etape-type-tabeller, kilde-URL pr. løb) —
// se docs/research/2026-08-04-stage-race-structure/ (README + analyse.mjs, køres med
// `node analyse.mjs`). Den første stikprøve var skæv mod MINDEVÆRDIGE finaler (flad
// spurt ~40% målt, korrekt tal er 18,8% — næst-sjældneste, ikke mest almindelige).
// Fuld korrektion: #3326-issue-kommentaren 4/8 ("Korrektion: den første research var
// for tynd, og tallene var forkerte").
//
// Fire finale-arketyper (en-uges-løb, ikke-GT, n=32 af de 41 løb):
//
//   circuit_finale  37,5% (mål: 37) — kuperet kredsløb, GC ofte allerede afgjort.
//                    Model: Volta a Catalunya (Montjuïc). MEST ALMINDELIG — ikke sprint.
//   summit_finale   28,1% (mål: 28) — nuværende crescendo-form (uændret for denne gren).
//                    Model: Itzulia Baskerlandet, Vuelta.
//   sprint_finale   18,8% (mål: 19) — hårdeste etape næstsidst, sidste etape flad.
//                    Model: Tirreno-Adriatico, Danmark Rundt, Renewi Tour.
//   tt_finale       15,6% (mål: 16) — afgørende enkeltstart sidst.
//                    Model: Tour de Suisse, Tour de Pologne, Tour de Romandie.
//
// METODE-FORBEHOLD (se README'en for fuld tekst): (1) "hilly stage" er en bred
// Wikipedia-kasse — dækker både punchy bykredsløb og rullende spurt-etaper, så
// circuit_finale=37,5% skal læses som "slutter på kuperet terræn", ikke snævert
// "kredsløbsløb". (2) Stikprøven er WorldTour — Cycling Zones divisioner 2-4 er lavere
// niveau; en ProSeries-stikprøve bør laves før båndene låses for D3/D4.
//
// Grand tours er UDENFOR denne fordeling — de har deres EGEN ordning (hårdeste etape
// næstsidst, flad/enkeltstart sidst — ALDRIG bjerg, 0/9 målte grand tours sluttede på
// bjerg) via ARCHETYPE_PROFILES.grand_tour.grandTourOrder i raceStageProfileGenerator.js.
// Denne fil rører ALDRIG grand_tour's finale-vægte (GT_FLAT_FINISH_CHANCE bor i den
// anden fil, tæt på sin egen ordnings-funktion).

export const ORDER_ARCHETYPES = Object.freeze(["sprint_finale", "summit_finale", "tt_finale", "circuit_finale"]);

// Default-vægte — gælder ALLE ikke-GT etapeløbs-arketyper (mountain_tour, hilly_tour,
// balanced_week, cobbled_tour) OG den generiske (ukendt/manglende terrain_archetype)
// fallback, MEDMINDRE en arketype-specifik override findes i
// ORDER_WEIGHTS_BY_ARCHETYPE nedenfor. Kalibreret direkte mod den strukturerede
// 41-løbs-optælling ovenfor (afrundet til nærmeste heltal, sum 100).
export const DEFAULT_ORDER_WEIGHTS = Object.freeze([
  Object.freeze({ value: "circuit_finale", weight: 37 }),
  Object.freeze({ value: "summit_finale", weight: 28 }),
  Object.freeze({ value: "sprint_finale", weight: 19 }),
  Object.freeze({ value: "tt_finale", weight: 16 }),
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

// Åbnings-variation. KORREKTION 2026-08-04: researchen (n=41) måler 70,7% af ALLE
// rigtige løb åbner IKKE fladt (kuperet 43,9% · flad 29,3% · itt 22,0% · bjerg/ttt
// 4,8% samlet) — den gamle 20%-default var "langt for lavt" (ejer-direktiv). Global
// konstant (ikke pr. arketype — researchen giver ikke grundlag for arketype-specifik
// åbnings-tuning) anvendt EFTER finale-ordningen, så den aldrig kan flytte den etape
// der allerede er placeret i finale-slottet. Kandidat-prioritet: hilly (mest almindelige
// ikke-flade åbning i data) > itt (prolog-kandidat) > rolling. Sat til 75% — target-
// båndet (60-80% ikke-flad, accept-krav) nås KUN når et kandidat-terræn rent faktisk
// findes i midterfeltet; målt på en genereret sæson, se PR-body. grand_tour er UDENFOR
// (egen openingItt, uændret).
export const OPENING_VARIETY_CHANCE = 0.95;
export const OPENING_VARIETY_CANDIDATES = Object.freeze(["hilly", "itt", "rolling"]);
