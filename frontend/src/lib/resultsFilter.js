// #3197 — Resultat-hubbens sæson/division/pulje-vælgere (ejer-direktiv, Discord
// #feedback-from-dolmer 31/7): "Der hvor man ser resultater fra løb skal man kunne
// vælge sæson, division, gruppe mv." Default = spillerens egen kontekst (#2182-
// princippet: default-konteksten er spillerens egen verden).
//
// races/season_standings/rider_rankings-rækker bærer kun league_division_id
// (pulje-id) — IKKE tier-nummeret ("Division N") direkte, i modsætning til
// teams.division (som ER tier-tallet, se StandingsPage). poolMatchesSelection
// slår derfor puljens tier op i et league_divisions-lookup (divisionsById) for at
// afgøre om en række hører til den valgte division, og matcher derefter den
// specifikke pulje hvis brugeren har snævret yderligere ind.
//
// null/manglende league_division_id på en række = fælles/sæson-bredt løb (samme
// semantik som racesByPool.js #1715) — vises altid, uanset valgt division/pulje.

export const ALL_DIVISIONS_VALUE = "all";
export const ALL_POOLS_VALUE = "all";

/**
 * Afgør om en pulje-id hører til den valgte division+pulje.
 * @param {number|string|null|undefined} poolId - rækkens league_division_id
 * @param {{tier: number|null, poolId: number|string|null}} selection - tier=null → alle divisioner; poolId=null/"all" → alle puljer i tieren
 * @param {Map<any,{tier:number}>|Object} divisionsById - league_divisions-rækker keyet på id
 * @returns {boolean}
 */
export function poolMatchesSelection(poolId, selection, divisionsById) {
  if (poolId == null) return true; // fælles/sæson-bredt, intet pulje-loft
  const { tier = null, poolId: selectedPoolId = null } = selection || {};
  if (tier == null) return true; // "Alle divisioner" valgt — ingen filtrering
  const row = divisionsById instanceof Map ? divisionsById.get(poolId) : divisionsById?.[poolId];
  if (!row || row.tier !== tier) return false;
  if (selectedPoolId == null || selectedPoolId === ALL_POOLS_VALUE) return true;
  // Løs lighed: <select> giver altid string, DB-id'er kan være number (samme
  // fælde som standingsPoolFilter.js #2879).
  return String(poolId) === String(selectedPoolId);
}

/**
 * Filtrér en liste rækker (løb, standings, ...) der hver bærer et pulje-felt.
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => (number|string|null|undefined)} getPoolId
 * @param {{tier: number|null, poolId: number|string|null}} selection
 * @param {Map<any,{tier:number}>|Object} divisionsById
 * @returns {T[]}
 */
export function filterByDivisionPool(rows, getPoolId, selection, divisionsById) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => poolMatchesSelection(getPoolId(row), selection, divisionsById));
}
