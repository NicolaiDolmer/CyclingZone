// backend/lib/scoutBandAge.js
// Alder til scout-loftbaand/projektion (#6700). Soeson-alder via SSOT'en
// (riderSeasonAge.js), ikke kalenderaar minus foedselsaar - ellers divergerer
// projektionen fra resten af spillet fra soeson 2 (jf. #3071).
import { ageForSeason } from "./riderSeasonAge.js";

/**
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number} seasonNumber  aktiv soesons nummer
 * @returns {number|null}  null naar alder ikke kan beregnes (aldrig et gaet)
 */
export function scoutBandAge(birthdate, seasonNumber) {
  return ageForSeason(birthdate, seasonNumber);
}
