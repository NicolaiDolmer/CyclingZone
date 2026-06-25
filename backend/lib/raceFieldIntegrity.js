// backend/lib/raceFieldIntegrity.js
// Felt-integritet for race-motoren. Rene funktioner — ingen DB.
//
// #1844 (engine-frys): et etapeløbs felt MÅ ikke ændre sig mellem etaper. Motoren
//   re-deriverer feltet hver etape (loadEntrantsForRace) og buildRaceResults simulerer
//   HELE løbet etape 1→N med det aktuelle felt → en rytter der kommer ind midt i løbet
//   blev retroaktivt simuleret gennem alle etaper og kunne vinde GC (Boucles Mayennaises).
//   freezeEntrantsToStartField låser feltet til etape-1-snapshot'et.
// #1845 (runtime-binding): runtime auto-fill (fillMissingTeamEntries) manglede den dag-
//   granulære cross-race binding → fyldte et nyt løb med en igangværende konkurrents
//   ryttere (142 dobbeltbookinger 25/6). excludeBoundRiders genbruger raceBinding-kernen.

import { findRiderBindingConflicts } from "./raceBinding.js";

/**
 * Lås et etapeløbs felt til start-feltet (etape-1-snapshot). Ryttere der IKKE var med
 * fra start ekskluderes fra simuleringen; start-ryttere der er forsvundet rapporteres.
 *
 * @param {Array<{rider_id:string}>} entrants  aktuelt indlæste entrants
 * @param {string[]|null} startFieldRiderIds    rider_ids fra etape-1-snapshot (race_simulation_runs)
 * @returns {{ frozen: object[], added: string[], missing: string[] }}
 *   frozen  = entrants der hører til start-feltet (det der simuleres)
 *   added   = rider_ids til stede nu men IKKE i start-feltet (mid-race-intrudere, ekskluderet)
 *   missing = rider_ids fra start-feltet der ikke længere er til stede (forsvundet/slettet)
 *
 * Null/tom snapshot → ingen frysning (etape 1, eller legacy-løb uden snapshot).
 */
export function freezeEntrantsToStartField(entrants = [], startFieldRiderIds = null) {
  if (!startFieldRiderIds || !startFieldRiderIds.length) {
    return { frozen: entrants, added: [], missing: [] };
  }
  const startSet = new Set(startFieldRiderIds);
  const presentSet = new Set(entrants.map((e) => e.rider_id));
  const frozen = entrants.filter((e) => startSet.has(e.rider_id));
  const added = entrants.filter((e) => !startSet.has(e.rider_id)).map((e) => e.rider_id);
  const missing = [...startFieldRiderIds].filter((id) => !presentSet.has(id));
  return { frozen, added, missing };
}

/**
 * Fjern ryttere der allerede er bundet i et tidsoverlappende løb (samme CET-dag), så
 * runtime auto-fill ikke dobbeltbooker. Genbruger den rene binding-kerne.
 *
 * @param {{ riders: Array<{rider_id:string}>, thisWindow: {start,end}|null, otherRaces: Array<{window,riderIds}> }} args
 * @returns {object[]} riders der IKKE er bundet andetsteds (uændret hvis intet vindue/binding)
 */
export function excludeBoundRiders({ riders = [], thisWindow = null, otherRaces = [] }) {
  if (!thisWindow || !otherRaces.length) return riders;
  const bound = new Set(
    findRiderBindingConflicts({ riderIds: riders.map((r) => r.rider_id), thisWindow, otherRaces })
  );
  if (!bound.size) return riders;
  return riders.filter((r) => !bound.has(r.rider_id));
}

/**
 * #1846: et hold kan kun være i et løbs felt hvis det tilhører løbets EGEN division.
 * Op/nedrykning ændrer teams.league_division_id, men efterlod stale race_entries i den
 * gamle divisions endnu-ikke-afviklede løb (Clássica da Figueira: 64 cross-division-rækker)
 * → holdets ryttere "kørte" et løb de ikke var i + forurenede binding for deres rigtige løb.
 * Defensiv guard på afviklings-stien: drop entries fra hold der IKKE er i løbets division.
 *
 * Konservativ: løb uden division (raceDivisionId == null) filtreres ikke; et hold hvis
 * division er UKENDT (ikke i map'et, fx fejlet opslag) beholdes — vi fjerner kun entries
 * vi POSITIVT ved er fra en anden division.
 *
 * @param {{ entries: Array<{team_id:string}>, teamDivisionById: Map<string,number|null>, raceDivisionId: number|null }} args
 * @returns {object[]} entries fra hold i løbets division (+ ukendte)
 */
export function filterEntriesToRaceDivision({ entries = [], teamDivisionById = new Map(), raceDivisionId = null }) {
  if (raceDivisionId == null) return entries;
  return entries.filter((e) => {
    if (!teamDivisionById.has(e.team_id)) return true; // ukendt division → behold (konservativt)
    return teamDivisionById.get(e.team_id) === raceDivisionId;
  });
}
