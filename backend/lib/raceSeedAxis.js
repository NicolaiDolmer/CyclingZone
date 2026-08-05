// backend/lib/raceSeedAxis.js
// #3347: sæson-aksen i parcours-seed'en — ÉT sted, delt af pass 1
// (raceStageProfileGenerator.js) og pass 2 (raceRouteGenerator.js).
//
// Hvorfor et eget modul: pass 2's rute-seed (`…:route:<etape>`) og pass 1's
// profil-seed skal ligge på SAMME sæson-akse. Gør de ikke det, ville et re-draw
// kun ændre terræn-typerne og ikke ruterne — og GT-båndet (total-km/stigninger/HC)
// måler netop rute-data, så et re-draw ville aldrig kunne rette et GT-brud.
// raceStageProfileGenerator importerer raceRouteGenerator, så aksen kan ikke bo i
// den ene af dem uden en import-cyklus.
//
// season_variant (heltal ≥ 0) er RE-DRAW-tælleren fra #3347: 0 = det kanoniske
// træk (bit-identisk med adfærden før #3347 — nøglen er uændret), n > 0 = det
// n'te deterministiske gen-træk. Se raceRouteRealismDraw.js for hvem der vælger n.
export const SEASON_RETRY_TOKEN = ":retry:";

/** Normalisér season_variant: kun heltal > 0 tæller; alt andet (null/NaN/negativ) = 0. */
export function seasonVariantOf(race) {
  const v = Number(race?.season_variant);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * Sæson-suffikset til en seed-nøgle.
 *   ingen season_id, variant 0  → ""                       (ad-hoc/test — uændret)
 *   season_id, variant 0        → "::<season_id>"          (uændret ift. før #3347)
 *   season_id, variant n>0      → "::<season_id>:retry:<n>"
 *   ingen season_id, variant n>0→ ":retry:<n>"             (varianten tabes ALDRIG tavst)
 */
export function seasonSeedSuffix(race) {
  const variant = seasonVariantOf(race);
  const season = race?.season_id ? `::${race.season_id}` : "";
  return variant > 0 ? `${season}${SEASON_RETRY_TOKEN}${variant}` : season;
}
