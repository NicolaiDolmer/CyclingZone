// #2182 — Dashboardets "My division standings"-modul skal defaulte til
// spillerens egen division OG pulje, ikke hele tieren (en tier kan have op til
// 8 puljer, se database/2026-06-21-league-divisions-pyramid.sql). Samme
// princip som #3197: "default-konteksten er spillerens egen verden".
//
// Ren funktion (ingen React/Supabase-afhængigheder) så filter-logikken kan
// unit-testes med `node --test`, i stedet for kun at leve inline i
// DashboardPage.jsx's render-krop. Genbruger StandingsPage's matchesPoolTab
// (lib/standingsPoolFilter.js #2879) i stedet for en tredje parallel
// pulje-match-implementering.
import { matchesPoolTab } from "./standingsPoolFilter.js";

function rowPoolId(s) {
  return s.team?.league_division_id ?? s.league_division_id ?? null;
}

/**
 * @param {Array} standings - flettet standings-liste (fra mergeStandings), hvert
 *   element bærer et `team`-objekt (inkl. is_ai, division, league_division_id).
 * @param {{ id?: string, division?: number, league_division_id?: number|null }|null} team
 *   - spillerens eget hold.
 * @param {Array<{ id: number, tier: number, pool_index: number, label: string }>} pools
 *   - alle puljer (league_divisions), reference-data.
 * @returns {{
 *   hasPoolSubtabs: boolean,
 *   ownPoolRow: object|null,
 *   divStandingsAll: Array,
 *   divStandingsTop: Array,
 *   divStandings: Array,
 *   myStandingIndex: number,
 * }}
 */
export function computeMyDivisionStandings(standings, team, pools) {
  const safeStandings = standings || [];
  const safePools = pools || [];
  const myDivision = team?.division;
  const myPoolId = team?.league_division_id ?? null;

  // Kant-tilfælde (#2182 acceptance): helt nyt hold uden league_division_id
  // endnu → hasPoolSubtabs falder tilbage til false (ingen pulje-filtrering,
  // hele tieren som før #2182), så modulet aldrig render'er tomt for den sag.
  const tierPools = safePools.filter(p => p.tier === myDivision);
  const hasPoolSubtabs = tierPools.length > 1 && myPoolId != null;
  const ownPoolRow = hasPoolSubtabs ? (tierPools.find(p => p.id === myPoolId) || null) : null;

  const divStandingsAll = safeStandings
    .filter(s => !s.team?.is_ai && s.team?.division === myDivision)
    .filter(s => matchesPoolTab(rowPoolId(s), myPoolId, hasPoolSubtabs))
    .sort((a, b) => b.total_points - a.total_points);

  const myStandingIndex = divStandingsAll.findIndex(s => s.team_id === team?.id);
  // #2328 — egen placering skal altid være synlig, også uden for top-5. Top-5
  // vises som hidtil; er manageren ikke i top-5, tilføjes hans egen række sidst
  // (med den ægte placerings-nummer bevaret via myStandingIndex).
  const divStandingsTop = divStandingsAll.slice(0, 5).map((s, i) => ({ ...s, _rank: i + 1 }));
  const divStandings = myStandingIndex >= 0 && myStandingIndex >= 5
    ? [...divStandingsTop, { ...divStandingsAll[myStandingIndex], _rank: myStandingIndex + 1, _isOwnRowBreak: true }]
    : divStandingsTop;

  return { hasPoolSubtabs, ownPoolRow, divStandingsAll, divStandingsTop, divStandings, myStandingIndex };
}
