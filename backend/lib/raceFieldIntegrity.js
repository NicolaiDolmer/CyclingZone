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
 * #6740 (ejer-beslutning B 16/10): `exemptTeamIds` er hold der kun er under gulvet
 * fordi udtagne ryttere blev skadet efter udtagelsen (se injuryShortTeamIds). De
 * starter med de raske ryttere de har tilbage, mindst 1.
 * #6739 (ejer-beslutning A 24/10): også hold der kun er under gulvet fordi ryttere kører
 * et andet løb på startdagen (overlapShortTeamIds, mindst OVERLAP_MIN_START).
 *
 * @param {{ entries: Array<{team_id:string, rider_id:string}>, minEntries?: number,
 *   exemptTeamIds?: Set<string> }} args
 * @returns {{ kept: object[], droppedTeamIds: string[] }}
 *   kept           = entries fra hold der har mindst minEntries ryttere (eller er undtaget)
 *   droppedTeamIds = team_id for hold der ikke stiller op (stabil rækkefølge: første forekomst)
 */
export function filterTeamsBelowMinimumEntries({ entries = [], minEntries = MIN_RACE_ENTRIES, exemptTeamIds = new Set() }) {
  if (!entries.length || !Number.isFinite(minEntries) || minEntries <= 0) {
    return { kept: entries, droppedTeamIds: [] };
  }
  // Tæl UNIKKE ryttere pr. hold: en dublet-række må ikke kunne løfte et hold over gulvet.
  const ridersByTeam = uniqueRidersByTeam(entries);
  const droppedTeamIds = [...ridersByTeam.entries()]
    .filter(([teamId, riderIds]) => riderIds.size < minEntries && !exemptTeamIds.has(teamId))
    .map(([teamId]) => teamId);
  if (!droppedTeamIds.length) return { kept: entries, droppedTeamIds: [] };
  const droppedSet = new Set(droppedTeamIds);
  return { kept: entries.filter((e) => !droppedSet.has(e.team_id)), droppedTeamIds };
}

function uniqueRidersByTeam(entries) {
  const ridersByTeam = new Map();
  for (const e of entries) {
    if (!ridersByTeam.has(e.team_id)) ridersByTeam.set(e.team_id, new Set());
    ridersByTeam.get(e.team_id).add(e.rider_id);
  }
  return ridersByTeam;
}

/**
 * #6740 (ejer-beslutning B 16/10): hold der kun er under gulvet fordi udtagne ryttere
 * blev skadet efter udtagelsen. Holdet havde gulvet: `tilbage + skadede >= minEntries`.
 * Andre grunde (for få udtaget, spent days, ghosts, afmelding) tæller ikke som skade:
 * kalderen sender `entries` EFTER de filtre og `injuredEntries` = de skadede udtagne
 * som skadefilteret tog ud. Et hold med nul raske tilbage kan stadig være med her;
 * assistenten fylder op med frie ryttere, og gulvet kræver mindst 1 ved start.
 *
 * @param {{ entries: Array<{team_id, rider_id}>, injuredEntries: Array<{team_id, rider_id}>,
 *   minEntries?: number }} args
 * @returns {Set<string>} team_id
 */
export function injuryShortTeamIds({ entries = [], injuredEntries = [], minEntries = MIN_RACE_ENTRIES }) {
  const out = new Set();
  if (!injuredEntries.length) return out;
  const kept = uniqueRidersByTeam(entries);
  const injured = uniqueRidersByTeam(injuredEntries);
  for (const [teamId, injuredIds] of injured) {
    const keptIds = kept.get(teamId) ?? new Set();
    const fitLeft = keptIds.size;
    const injuredOnly = [...injuredIds].filter((id) => !keptIds.has(id)).length;
    if (fitLeft < minEntries && fitLeft + injuredOnly >= minEntries) out.add(teamId);
  }
  return out;
}

/**
 * #6739 (ejer-beslutning A 24/10, N = 4): mindste startfelt for et hold, der kun er under
 * gulvet fordi dets ryttere kører et andet løb på løbets startdag (overlap, fx sidste
 * etape af et andet etapeløb). Gulvet (MIN_RACE_ENTRIES) gælder uændret alle andre dage.
 */
export const OVERLAP_MIN_START = 4;

/**
 * #6739: ren regel. Holdet starter med `starters` ryttere, hvis det har mindst
 * `overlapMin`, og det kun er under gulvet fordi ryttere kører et andet løb samme
 * løbsdag. `injured` (skadede udtagne, regel B) tæller med som tabt af en undtaget
 * grund, men kun når mindst én rytter er optaget af overlap: uden overlap gælder
 * regel B alene.
 *
 * @param {{ starters?: number, overlap?: number, injured?: number, minEntries?: number, overlapMin?: number }} args
 * @returns {boolean}
 */
export function overlapStartsShort({ starters = 0, overlap = 0, injured = 0, minEntries = MIN_RACE_ENTRIES, overlapMin = OVERLAP_MIN_START } = {}) {
  const s = Math.max(0, Number(starters) || 0);
  const o = Math.max(0, Number(overlap) || 0);
  const i = Math.max(0, Number(injured) || 0);
  return o > 0 && s >= overlapMin && s < minEntries && s + o + i >= minEntries;
}

/**
 * #6739: hvilke af `riders` er optaget af et andet løb på løbets STARTDAG? Enten har de
 * allerede kørt et andet løb samme løbsdag (`spentRiderIds`, raceSpentDays), eller de
 * står i et andet løb, hvis vindue rummer startdagen (`thisWindow.start`). En binding
 * senere i et etapeløb er managerens eget valg, ikke kalenderens fælde, og tæller ikke.
 *
 * @param {{ riders: Array<{rider_id:string}>, spentRiderIds?: Set<string>,
 *   thisWindow?: {start:number}|null, otherRaces?: Array<{window, riderIds}> }} args
 * @returns {Set<string>} rider_id
 */
export function startDayOverlapRiderIds({ riders = [], spentRiderIds = new Set(), thisWindow = null, otherRaces = [] }) {
  const ids = riders.map((r) => r.rider_id);
  const out = new Set(ids.filter((id) => spentRiderIds.has(id)));
  if (thisWindow && Number.isFinite(thisWindow.start) && otherRaces.length) {
    const startDay = { start: thisWindow.start, end: thisWindow.start, days: [thisWindow.start] };
    for (const id of findRiderBindingConflicts({ riderIds: ids, thisWindow: startDay, otherRaces })) out.add(id);
  }
  return out;
}

/**
 * #6739: tilføj ryttere til et Map<team_id, Set<rider_id>> (overlap-regnskabet, der
 * bygges op i loadEntrantsForRace og fillMissingTeamEntries).
 */
export function addRidersByTeam(map, teamId, riderIds) {
  if (!teamId) return map;
  if (!map.has(teamId)) map.set(teamId, new Set());
  for (const id of riderIds) map.get(teamId).add(id);
  return map;
}

/**
 * #6739: tal til overlapStartsShort for ét hold. Starterne trækkes fra overlap- og
 * skadesættene, så en rytter aldrig tæller to gange.
 */
export function overlapCountsForTeam({ teamId, starterIds = new Set(), overlapRidersByTeam = new Map(), injuredEntries = [] }) {
  const overlapIds = [...(overlapRidersByTeam.get(teamId) ?? [])].filter((id) => !starterIds.has(id));
  const overlapSet = new Set(overlapIds);
  const injured = new Set(injuredEntries.filter((e) => e.team_id === teamId && !starterIds.has(e.rider_id) && !overlapSet.has(e.rider_id))
    .map((e) => e.rider_id));
  return { starters: starterIds.size, overlap: overlapSet.size, injured: injured.size };
}

/** #6739: overlapStartsShort for ét hold, givet holdets startere. */
export function teamStartsShortOnOverlap({ teamId, starterIds = new Set(), overlapRidersByTeam = new Map(), injuredEntries = [] }) {
  return overlapStartsShort(overlapCountsForTeam({ teamId, starterIds, overlapRidersByTeam, injuredEntries }));
}

/**
 * #6739: hold i `entries` (startfeltet efter assistentens opfyldning) der starter under
 * gulvet efter overlap-reglen. Kalderen undtager dem fra filterTeamsBelowMinimumEntries.
 *
 * @returns {Set<string>} team_id
 */
export function overlapShortTeamIds({ entries = [], overlapRidersByTeam = new Map(), injuredEntries = [], minEntries = MIN_RACE_ENTRIES, overlapMin = OVERLAP_MIN_START }) {
  const out = new Set();
  if (!overlapRidersByTeam.size) return out;
  for (const [teamId, starterIds] of uniqueRidersByTeam(entries)) {
    const counts = overlapCountsForTeam({ teamId, starterIds, overlapRidersByTeam, injuredEntries });
    if (overlapStartsShort({ ...counts, minEntries, overlapMin })) out.add(teamId);
  }
  return out;
}
