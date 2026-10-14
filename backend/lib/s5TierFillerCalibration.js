// backend/lib/s5TierFillerCalibration.js
// #6367 (S5-kalenderen overholder de låste regler, ejer 14/10 "Ret generatoren" — ingen
// regel løsnes): S5-modellens pr.-division-kalibrering af etapeløbenes filler-vægte.
//
// RODÅRSAGEN DENNE FIL RETTER. S5-modellen (#6359) bygger Grand Tours af ejerens faste
// kvoter (S5_GRAND_TOUR_QUOTAS, spec §5) i stedet for v5's grand_tour-arketype. Kvoterne
// er bjergtunge (rigtige Grand Tours er det), og alle tre GT'er ligger i Division 1. Resten
// af etapeløbenes filler-vægte (ARCHETYPE_PROFILES) er kalibreret 21/9 mod en v5-verden
// hvor GT'ens terræn var et træk — der var intet i S5-stien der kompenserede for at en
// tredjedel af D1's etaper nu er låst. Følgen i S5-tørkørslen (#6367, 14/10): D1's bjerg
// over §6's pr.-division-tolerance og kuperet under, sæson-aggregatet skubbet samme vej,
// og D1's højbjerg under §6b, fordi den bjergtunge GT tager bjergdagene fra filleren.
//
// Samtidig var §6b's pr.-division-kalibrering en kendt S5-opgave (CALENDAR_RULES §6b:
// "Genkalibreringen pr. division er en S5-opgave. Den er en søgning [...] ikke en
// regnestykke-rettelse"). tierUniformFillerTilt.js er en proportional førstetilnærmelse
// afledt af S3's løbsudvalg; ejeren fravalgte den for S4 (3/9), fordi den gjorde planen
// målt dårligere. Denne fil er den søgning, for S5-modellen.
//
// HVAD DEN GØR. En tilt-faktor pr. (division, profiltype) på kind:"stage"-arketypernes
// filler-vægte — kun filleren. Garantier, endagsløb (fast terræn pr. design) og
// grand_tour (S5's GT bygges af kvoten, ikke af filler) røres ikke. Profiltypen er aksen,
// ikke K-B-kategorien, fordi §6b måler højbjerg ADSKILT fra almindelig bjerg (samme grund
// som tierUniformFillerTilt.js).
//
// HVOR DEN GÆLDER. Kun profileModel "s5" (sæson 5 og frem, profileModelForSeason), på
// HVER skrivesti: tierCalendarMaterializer.js anvender den i dæknings-verifikationen,
// realisme-gen-trækket og insert'et, så tørkørsel og apply måler samme parcours. Sæson
// 1-4 er bit-identiske (de bruger v5 og aldrig denne tabel).
//
// HVORDAN TALLENE ER FUNDET. Koordinat-søgning gennem HELE tørkørslens kæde
// (backend/scripts/dev/calibrateS5TierFillers.mjs → seasonCalendarGatesOffline.mjs:
// materializer → gatePlan → scorecard → S5-benchmark-gaten) mod den committede
// katalog-fixture (prod-kataloget 14/10). Kriteriet er gatesne selv, i rækkefølge: ingen
// hård gate, ingen override-bar gate, derefter mindst afstand til §6/§6b-målene. Faktorerne
// er afrundet og holdt inden for [TILT_MIN, TILT_MAX]. Tallene pr. division, før/efter,
// står i den gitignorerede balance-internals/6367/ (hard rule 17); her kun retningen.
//
// Genkalibrér når kataloget, GT-kvoterne eller S5-vindue ændres: kør søgningen, og kør
// derefter den fulde tørkørsel (buildSeasonCalendar --season 5, aldrig --apply).
//
// Ren: ingen DB, ingen RNG, input muteres aldrig.

import { ARCHETYPE_PROFILES } from "./raceStageProfileGenerator.js";

// Samme gulv som de to øvrige tilt-mekanikker: en tilt må aldrig NULSTILLE et terræn.
export const MIN_WEIGHT = 1;
// Søgerummet. Uden for [0.25, 4] fjerner eller monopoliserer en faktor reelt en
// filler-plads (strukturel ændring af arketypen), ikke en kalibrering.
export const TILT_MIN = 0.25;
export const TILT_MAX = 4;

// Profiltyperne tilten virker på (filler-arrays' værdier). Alt andet er faktor 1.
export const S5_TILT_PROFILE_TYPES = Object.freeze(["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "cobbles"]);

// Arketyper der aldrig tiltes: S5's Grand Tour bygges af ejerens kvote (spec §5).
export const S5_TILT_SKIP_ARCHETYPES = Object.freeze(["grand_tour"]);

/** Neutral tabel: alle faktorer 1 → applyS5TierFillerTilt returnerer profilerne uændret på filler-niveau. */
export const NEUTRAL_S5_TIER_TILT = Object.freeze({});

/**
 * Den kalibrerede tabel. Retning (tal i balance-internals/6367/):
 *   D1  bjerg ned og højbjerg op (GT'en tager bjergdagene), kuperet/bølget op, enkeltstart op
 *   D2  enkeltstart og højbjerg op
 *   D3  tæt på neutral
 *   D4  enkeltstart ned
 * Udfyldes af søgningen; en manglende division/profiltype er faktor 1.
 */
export const S5_TIER_FILLER_TILT = Object.freeze({});

/** @param {number} f */
function clampFactor(f) {
  if (!Number.isFinite(f)) return 1;
  return Math.min(TILT_MAX, Math.max(TILT_MIN, f));
}

/**
 * Tilt ÉN filler-liste med én divisions faktorer.
 * @param {Array<{value: string, weight: number}>} filler
 * @param {Record<string, number>} [factors]
 */
export function tiltS5Filler(filler = [], factors = {}) {
  return filler.map((it) => {
    const f = factors[it.value];
    if (f == null || f === 1) return { value: it.value, weight: it.weight };
    return { value: it.value, weight: Math.max(MIN_WEIGHT, Math.round(it.weight * clampFactor(f))) };
  });
}

/**
 * ARCHETYPE_PROFILES tiltet for én division under S5-modellen. Ukendt division eller
 * ingen faktorer → profilerne returneres uændret (samme objekt), så en division uden
 * kalibrering er bit-identisk med den ukalibrerede S5-model.
 *
 * @param {{ tier: number, profiles?: Record<string, any>, tiltByTier?: Record<string, Record<string, number>> }} args
 */
export function applyS5TierFillerTilt({ tier, profiles = ARCHETYPE_PROFILES, tiltByTier = S5_TIER_FILLER_TILT } = /** @type {any} */ ({})) {
  const factors = tiltByTier?.[tier];
  if (!factors || !Object.values(factors).some((f) => f !== 1)) return profiles;
  const skip = new Set(S5_TILT_SKIP_ARCHETYPES);
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, cfg] of Object.entries(profiles)) {
    if (cfg?.kind !== "stage" || skip.has(name) || !Array.isArray(cfg.filler)) { out[name] = cfg; continue; }
    out[name] = { ...cfg, filler: tiltS5Filler(cfg.filler, factors) };
  }
  return out;
}
