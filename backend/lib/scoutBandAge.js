// backend/lib/scoutBandAge.js
// Alder til scout-loftbaand/projektion (#6700). Soeson-alder via SSOT'en
// (riderSeasonAge.js), ikke kalenderaar minus foedselsaar - ellers divergerer
// projektionen fra resten af spillet fra soeson 2 (jf. #3071).
//
// Saesonpausen: efter season-end findes der INGEN 'active' saeson
// (seasonTransition.js, resolveTransitionSourceSeason). Et rent 'active'-opslag
// med `?? 1` som fallback ville give ALLE ryttere saeson-1-alder i pausen.
// Referencesaesonen vaelges derfor efter samme ejer-beslutning (25/8, #4223) som
// frontendens alders-flader (frontend/src/lib/seasonReference.js,
// pickReferenceSeason): active -> naermeste upcoming -> seneste completed.
// Saa viser projektionen samme alder som resten af rytterprofilen, ogsaa i pausen.
// Kan intet afgoeres, er svaret null (projektionen degraderer aerligt) - aldrig 1.
import { ageForSeason } from "./riderSeasonAge.js";

/**
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} seasonNumber  referencesaesonens nummer
 * @returns {number|null}  null naar alder ikke kan beregnes (aldrig et gaet)
 */
export function scoutBandAge(birthdate, seasonNumber) {
  return ageForSeason(birthdate, seasonNumber);
}

const AGE_REFERENCE_ORDER = ["active", "upcoming", "completed"];

/**
 * Alders-referencesaesonen ud fra saeson-raekker. Ren funktion, samme
 * praeference-raekkefoelge som frontendens pickReferenceSeason. Saeson 0
 * (bogfoerings-saesonen, #2763) er aldrig reference.
 *
 * @param {Array<{number:number, status:string}>|null|undefined} rows
 * @returns {number|null}
 */
export function pickAgeReferenceSeasonNumber(rows) {
  if (!Array.isArray(rows)) return null;
  const valid = rows.filter((r) => Number.isInteger(r?.number) && r.number > 0);
  for (const status of AGE_REFERENCE_ORDER) {
    const hits = valid.filter((r) => r.status === status).map((r) => r.number);
    if (hits.length) return status === "upcoming" ? Math.min(...hits) : Math.max(...hits);
  }
  return null;
}

/**
 * Slaa alders-referencesaesonen op. Kun .select(), aldrig en skrivning.
 *
 * @param {object} supabase
 * @returns {Promise<number|null>}  null naar ingen brugbar saeson findes
 */
export async function resolveScoutBandSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons")
    .select("number, status")
    .gt("number", 0);
  if (error) throw new Error(`scout-band season lookup: ${error.message}`);
  return pickAgeReferenceSeasonNumber(data);
}
