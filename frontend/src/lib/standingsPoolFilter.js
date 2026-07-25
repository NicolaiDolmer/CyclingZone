// #2879 — Standings pulje-sub-fane: en DOM-<select> giver altid poolTab som
// string, mens rowPoolId(s) (team.league_division_id / league_divisions.id)
// er integer fra Supabase. Strict-equality (poolTab === rowPoolId(s)) fejlede
// derfor ALTID → "No data for Division X" selvom pulje-vælgeren korrekt talte
// holdene ("Division 3 — D (24)"). Regression fra #2864 (bølge 1: knapper med
// onClick={() => setPoolTab(p.id)} → integer bevaret — blev til en <Select>
// med onChange={(e) => setPoolTab(e.target.value)} → type tabt).
//
// matchesPoolTab centraliserer sammenligningen ét sted (samme mønster som
// racesByPool.js #1715: "Løs lighed: Supabase leverer id som number, UI-state
// kan være string"), så StandingsPage's filter, op-/nedrykningstæller osv. ikke
// kan drifte fra hinanden igen — uanset om poolTab er en string ("7") eller et
// tal (7).

export const POOL_ALL = "all"; // pulje-sub-fane: vis hele tieren samlet.

/**
 * Afgør om en standings-række hører til den valgte pulje-fane.
 * @param {number|string|null|undefined} rowPoolId - rækkens pulje-id
 * @param {number|string} poolTab - valgt pulje-fane (state; kan være string fra <select>)
 * @param {boolean} hasPoolSubtabs - false = tieren har kun én pulje, ingen filtrering
 * @returns {boolean}
 */
export function matchesPoolTab(rowPoolId, poolTab, hasPoolSubtabs) {
  if (!hasPoolSubtabs || poolTab === POOL_ALL) return true;
  // Løs lighed: Supabase leverer pulje-id som number, <select> giver altid string.
  return String(rowPoolId) === String(poolTab);
}
