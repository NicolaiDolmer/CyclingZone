// #1715 — Kalender-UI: vis kun spillerens egen puljes løb.
//
// races-tabellen kan binde hvert løb til en specifik liga-pulje via
// races.league_division_id (se database/2026-06-22-races-league-division.sql).
// NULL = fælles/sæson-bredt løb (legacy + bagudkompatibelt). Kalenderen hentede
// før ALLE puljers løb i én liste, så samme løb optrådte som dubletter.
//
// racesForPool filtrerer den rå liste til:
//   - løb i spillerens egen pulje (league_division_id === myPoolId), OG
//   - fælles løb uden pulje (league_division_id == null).
//
// Hvis spilleren ikke har en pulje (myPoolId er null/undefined) falder vi tilbage
// til hele listen — vi skjuler aldrig alt for en spiller uden pulje-tilknytning.

/**
 * Filtrér løb til spillerens egen pulje + fælles (NULL) løb.
 * @param {Array<{league_division_id?: number|null}>} races - rå løb-liste
 * @param {number|string|null|undefined} myPoolId - spillerens league_division_id
 * @returns {Array} filtreret liste (samme rækkefølge som input)
 */
export function racesForPool(races, myPoolId) {
  if (!Array.isArray(races)) return [];
  // Ingen pulje-tilknytning → vis alt (skjul aldrig hele kalenderen).
  if (myPoolId == null) return races;
  return races.filter((r) => {
    const poolId = r?.league_division_id;
    if (poolId == null) return true; // fælles/sæson-bredt løb
    // Løs lighed: Supabase leverer id som number, UI-state kan være string.
    return String(poolId) === String(myPoolId);
  });
}
