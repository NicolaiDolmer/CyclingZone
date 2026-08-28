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
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

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

/**
 * #4295 (ejer-beslutning 27/8): et hold skal have MINDST `minEntries` (6) ryttere på
 * startlisten for at stille op. Ligger det under, starter det ikke — som et hold der
 * har afmeldt sig eller ryddet sin trup: det har simpelthen ingen ryttere i feltet.
 * Det er den eksisterende "starter ikke"-mekanik i motoren (et hold uden entries er
 * ikke i feltet), ikke en ny tilstand, så resultater/point/klassementer behøver intet
 * nyt begreb — holdet optræder bare ikke.
 *
 * Gulvet er FLADT og uafhængigt af feltstørrelsen pr. klasse (raceAutopick.SELECTION_SIZE):
 * 6 i alle løb, også dem hvor feltet er 7 eller 8.
 *
 * Delvist hold = hele holdet ud. Et hold med 4 ryttere skal ikke køre med 4 — det er
 * netop den mellemting beslutningen fjerner.
 *
 * Kaldes FØRST efter at sen-redningen (fillMissingTeamEntries) har haft sin chance for
 * at fylde op til gulvet, og KUN ved løbets start (loadEntrantsForRace's allowAutofill).
 * Et igangværende etapeløb må aldrig miste et hold der faktisk startede, fordi en rytter
 * bliver skadet undervejs.
 *
 * @param {{ entries: Array<{team_id:string, rider_id:string}>, minEntries?: number }} args
 * @returns {{ kept: object[], droppedTeamIds: string[] }}
 *   kept           = entries fra hold der har mindst minEntries ryttere
 *   droppedTeamIds = team_id for hold der ikke stiller op (stabil rækkefølge: første forekomst)
 */
export function filterTeamsBelowMinimumEntries({ entries = [], minEntries = MIN_RACE_ENTRIES }) {
  if (!entries.length || !Number.isFinite(minEntries) || minEntries <= 0) {
    return { kept: entries, droppedTeamIds: [] };
  }
  // Tæl UNIKKE ryttere pr. hold: en dublet-række må ikke kunne løfte et hold over gulvet.
  const ridersByTeam = new Map();
  for (const e of entries) {
    if (!ridersByTeam.has(e.team_id)) ridersByTeam.set(e.team_id, new Set());
    ridersByTeam.get(e.team_id).add(e.rider_id);
  }
  const droppedTeamIds = [...ridersByTeam.entries()]
    .filter(([, riderIds]) => riderIds.size < minEntries)
    .map(([teamId]) => teamId);
  if (!droppedTeamIds.length) return { kept: entries, droppedTeamIds: [] };
  const droppedSet = new Set(droppedTeamIds);
  return { kept: entries.filter((e) => !droppedSet.has(e.team_id)), droppedTeamIds };
}
