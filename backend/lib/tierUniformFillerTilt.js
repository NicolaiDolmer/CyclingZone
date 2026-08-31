// backend/lib/tierUniformFillerTilt.js
// #4103 (ejer-beslutning 31/8, "valg A"): koble §6b's uniforme pr.-division-mål
// (TIER_UNIFORM_TARGET_FRACTIONS — itt 10 % · brosten 5 % · high_mountain 12 %,
// calendarCompositionTargets.js) ind i ARCHETYPE_PROFILES' filler-vægte, PR. TIER, så
// den NÆSTE kalender-generering (S4) rammer målene i alle fire divisioner i stedet for
// kun at måle dem bagefter — CALENDAR_RULES.md §6b's egen advarsel indtil nu: "Målene
// er en MÅLE-kontrakt, ikke en generator-kontrakt... generatoren rammer dem kun ved held."
//
// HVORFOR EN EGEN TILT-MEKANIK OG IKKE calendarCompositionCalibration.js' EKSISTERENDE:
// den fils NEUTRAL_TILT/tiltFiller opererer på §6's SEKS K-B-KATEGORIER (compositionCategory),
// hvor `mountain` og `high_mountain` er SAMME kategori ("mountain") — §6b's hele pointe er
// at måle high_mountain ADSKILT fra almindelig mountain (summit-tætheden, ikke den bredere
// bjerg-familie). En tilt på K-B's "mountain"-akse ville derfor tilte begge ens og aldrig
// kunne ramme high_mountain 12 % uden også at skubbe almindelig mountain. Denne fil tilter
// derfor direkte på PROFILE_TYPE (itt/itt_hilly, cobbles, high_mountain), ikke på
// compositionCategory — samme filler-arrays, en finere akse-inddeling.
//
// HVORFOR PR. TIER: §6b's hele grund til at eksistere er at ITT/brosten/high_mountain
// spredte sig VOLDSOMT på tværs af tiers (fx ITT 1,8 % i D4 mod 15,5 % i D3, målt 23/8) —
// én GLOBAL tilt (som K-B's) kan ikke rette det, fordi alle tiers deler samme
// ARCHETYPE_PROFILES-tabel og kun adskiller sig i HVILKE arketyper deres katalog-udvalg
// giver dem. calendarCompositionTargets.js's egen TIER_COMPOSITION_TOLERANCE_PP-docstring
// pegede allerede på dette som en "KENDT KALIBRERINGSOPGAVE" (pr.-tier filler-vægte).
// Denne fil er den opgave, afgrænset til §6b's tre kategorier.
//
// KALIBRERINGS-METODE (bevidst simplere end calibrateCalendarComposition.js's fulde
// pipeline-søgning): en PROPORTIONAL korrektion — tilt = mål% / målt% — fra den seneste
// LIVE pr.-division-måling (CALENDAR_RULES.md §6b, 30/8). Det er IKKE en fuld
// koordinat-descent mod S4's katalog, fordi S4's løbsudvalg ikke findes endnu (samme
// begrænsning som calibrateCalendarComposition.js's loadPlannedSeedRacesByTier-docstring
// beskriver for S3 dengang: "kalibrér mod den sæson du bygger"). Den proportionale
// korrektion er en dokumenteret FØRSTE tilnærmelse, ikke en påstand om at ramme ±2 pp
// præcist — når S4's katalog er selekteret, bør tilten EFTERPRØVES og evt. genkalibreres
// med samme værktøj som K-B (scripts/calibrateCalendarComposition.js), udvidet til at
// score §6b's akser. Det er en opfølgende opgave, ikke del af denne fils scope.
//
// OPT-IN, IKKE PROD-DEFAULT: se materializeTierCalendars({ useUniformTierTilt })
// (tierCalendarMaterializer.js) — default er FRA. S3 er allerede materialiseret og må
// ikke røres (hard rule: "S3 røres ikke"); et menneske skal eksplicit slå tilten til når
// S4 genereres, så den kalibrerede tilt kan reviewes FØR den påvirker en rigtig kalender.
//
// Ren funktion — ingen DB/RNG/mutation af input, samme princip som
// calendarCompositionCalibration.js.

import { ARCHETYPE_PROFILES } from "./raceStageProfileGenerator.js";
import { TIER_UNIFORM_TARGET_CATEGORIES, TIER_UNIFORM_TARGET_FRACTIONS } from "./calendarCompositionTargets.js";

// Samme gulv som calendarCompositionCalibration.js's MIN_WEIGHT: en tilt må aldrig
// NULSTILLE et terræn helt (det ville fjerne det fra arketypen, en strukturel ændring).
export const MIN_WEIGHT = 1;

// Tilt-loft/-gulv: uden for [0.35, 3] er vi reelt ved at fjerne eller monopolisere en
// filler-plads, samme ræsonnement som searchTilt's [0.1, 10]-bånd i
// calendarCompositionCalibration.js — sat snævrere her fordi denne tilt IKKE er
// søgt/verificeret mod en fuld pipeline (se docstring ovenfor), så et ekstremt tal er
// mere sandsynligt en regnefejl i inputtet end en ægte katalog-skævhed.
export const TILT_MIN = 0.35;
export const TILT_MAX = 3;

// profile_type → §6b-akse. KUN de tre kategorier #4103 dækker; alt andet (inkl.
// almindelig "mountain") er UBERØRT — netop forskellen til K-B's grovere kategori
// (se fil-docstringen). "itt_hilly" står ikke i ARCHETYPE_PROFILES' filler-arrays i dag
// (den opstår først via markSecondIttAsHilly efter filler-trækket, raceStageProfileGenerator.js)
// men er med her for robusthed hvis en fremtidig arketype nogensinde tilføjer den direkte.
const AXIS_BY_PROFILE_TYPE = Object.freeze({
  itt: "itt", itt_hilly: "itt",
  cobbles: "cobbles",
  high_mountain: "high_mountain",
});

/**
 * Målt andel (%, IKKE fraktion) af itt/cobbles/high_mountain pr. tier, live sæson 3,
 * 30/8 2026 — CALENDAR_RULES.md §6b's tabel. Kilden til den proportionale
 * første-kalibrering nedenfor. Opdatér denne konstant (og re-afled
 * TIER_UNIFORM_TILT_BY_TIER) når en ny måling foreligger — den er data, ikke et
 * engangs-facit.
 */
export const MEASURED_TIER_BASELINE_20260830 = Object.freeze({
  1: Object.freeze({ itt: 9.7, cobbles: 3.9, high_mountain: 7.7 }),
  2: Object.freeze({ itt: 14.5, cobbles: 4.8, high_mountain: 5.6 }),
  3: Object.freeze({ itt: 5.9, cobbles: 7.1, high_mountain: 10.6 }),
  4: Object.freeze({ itt: 9.7, cobbles: 4.8, high_mountain: 16.1 }),
});

/**
 * Tilt-faktor for ÉN akse: mål% / målt%, gulvsat/loftsat til [min, max]. Kant-tilfælde:
 *   · målt% = 0 (intet at skalere fra) → max (løft så langt op tilladt).
 *   · mål% = 0 → min (træk så langt ned tilladt) — forekommer ikke for #4103's tre
 *     kategorier i dag, men holder funktionen total.
 */
export function tiltFactorFor(measuredPct, targetPct, { min = TILT_MIN, max = TILT_MAX } = {}) {
  if (!(targetPct > 0)) return min;
  if (!(measuredPct > 0)) return max;
  return Math.min(max, Math.max(min, targetPct / measuredPct));
}

/**
 * Afled en pr.-tier tilt-tabel { tier: { itt, cobbles, high_mountain } } fra en målt
 * baseline (samme facon som MEASURED_TIER_BASELINE_20260830) og §6b's målfraktioner.
 * Ren funktion af sine argumenter — ingen skjult afhængighed af konstanterne ovenfor,
 * så en fremtidig re-kalibrering (ny måling, evt. andet mål) kan kalde den direkte.
 */
export function deriveUniformTierTilt(measuredPctByTier, targetFractions = TIER_UNIFORM_TARGET_FRACTIONS, opts = {}) {
  const out = {};
  for (const [tierKey, measured] of Object.entries(measuredPctByTier ?? {})) {
    const tier = Number(tierKey);
    if (!Number.isFinite(tier)) continue;
    const tilt = {};
    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      const targetPct = (targetFractions[cat] ?? 0) * 100;
      tilt[cat] = tiltFactorFor(measured?.[cat] ?? 0, targetPct, opts);
    }
    out[tier] = Object.freeze(tilt);
  }
  return Object.freeze(out);
}

// ÉN gang beregnet ved modul-load — samme mønster som andre kalibrerede konstanter i
// denne kodebase (fx raceStageProfileGenerator.js's ARCHETYPE_PROFILES-vægte selv).
export const TIER_UNIFORM_TILT_BY_TIER = deriveUniformTierTilt(MEASURED_TIER_BASELINE_20260830);

/**
 * Anvend en §6b-tilt på ÉT arketype-filler-array. Kun profile_types i
 * AXIS_BY_PROFILE_TYPE skaleres; alt andet (flad, kuperet, almindelig bjerg …) er
 * uberørt (factor 1) — se fil-docstringens forskel til K-B's grovere kategori-tilt.
 */
export function tiltFillerForUniformTargets(filler = [], tilt = {}) {
  return filler.map((it) => {
    const axis = AXIS_BY_PROFILE_TYPE[it.value];
    const factor = axis && tilt[axis] != null ? tilt[axis] : 1;
    return { value: it.value, weight: Math.max(MIN_WEIGHT, Math.round(it.weight * factor)) };
  });
}

/**
 * Byg en hel ARCHETYPE_PROFILES-tabel tilted for ÉN tier. Samme kontrakt som
 * calendarCompositionCalibration.js's applyCompositionTilt (ny tabel, input muteres
 * aldrig, kind:"single"/guarantees/skipArchetypes uberørt) — se den fils docstring for
 * hvorfor endagsløb og garantier bevidst ikke røres.
 *
 * Ukendt tier (ikke i tiltByTier) → profiles returneres UÆNDRET (fail-open til
 * eksisterende adfærd i stedet for at kaste — en fremtidig tier 5 skal ikke crashe
 * generatoren, bare stå uden §6b-kalibrering indtil en baseline måles for den).
 *
 * @param {{tier:number, profiles?:object, tiltByTier?:object, skipArchetypes?:string[]}} args
 */
export function applyUniformTierTilt({
  tier, profiles = ARCHETYPE_PROFILES, tiltByTier = TIER_UNIFORM_TILT_BY_TIER, skipArchetypes = [],
} = {}) {
  const tilt = tiltByTier?.[tier];
  if (!tilt) return profiles;
  const skip = new Set(skipArchetypes);
  const out = {};
  for (const [name, cfg] of Object.entries(profiles)) {
    if (cfg?.kind !== "stage" || skip.has(name) || !Array.isArray(cfg.filler)) {
      out[name] = cfg;
      continue;
    }
    out[name] = { ...cfg, filler: tiltFillerForUniformTargets(cfg.filler, tilt) };
  }
  return out;
}

export { ARCHETYPE_PROFILES };
