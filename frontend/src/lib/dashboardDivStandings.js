// #2182 — Dashboardets "My division standings"-modul skal defaulte til
// spillerens egen division OG pulje, ikke hele tieren (en tier kan have op til
// 8 puljer, se database/2026-06-21-league-divisions-pyramid.sql). Samme
// princip som #3197: "default-konteksten er spillerens egen verden".
//
// #3506 — rangberegningen (divStandingsAll) bruger nu SAMME scope som
// Standings-siden: AI-hold tælles med (bevidst valg i #1718), ikke kun
// division+pulje-filteret. Før #3506 blev AI-hold fjernet FØR placeringen
// blev udregnet, hvilket gav et andet placeringstal end målsiden for samme
// hold (prod-eksempel: #2 på dashboardet vs. #16 på Standings, Division 8
// S2 med 18 AI-hold + 6 menneskehold). myStandingIndex/_rank er nu det
// kanoniske, Standings-konsistente tal. myManagerRank er et separat,
// sekundært tal (placering blandt kun menneske-holdene i samme division/
// pulje) til den lille tillægslinje ("#2 blandt managere") på egen række.
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
 *   myManagerRank: number|null,
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

  // #3506 — samme scope som Standings-siden (division/pulje-filtreret, men
  // AI-hold MED, jf. #1718). Dette er det kanoniske, målside-konsistente
  // placeringstal (myStandingIndex → _rank).
  const divStandingsAll = safeStandings
    .filter(s => s.team?.division === myDivision)
    .filter(s => matchesPoolTab(rowPoolId(s), myPoolId, hasPoolSubtabs))
    .sort((a, b) => b.total_points - a.total_points);

  const myStandingIndex = divStandingsAll.findIndex(s => s.team_id === team?.id);

  // #3506 — sekundært tal: placering blandt KUN menneske-holdene i samme
  // division/pulje (den gamle beregning, bevaret som tillægsinfo). null hvis
  // eget hold ikke findes i det menneske-scopede felt (fx AI-testkonto).
  const managerStandings = divStandingsAll.filter(s => !s.team?.is_ai);
  const myManagerIndex = managerStandings.findIndex(s => s.team_id === team?.id);
  const myManagerRank = myManagerIndex >= 0 ? myManagerIndex + 1 : null;

  // #2328 — egen placering skal altid være synlig, også uden for top-5. Top-5
  // vises som hidtil; er manageren ikke i top-5, tilføjes hans egen række sidst
  // (med den ægte placerings-nummer bevaret via myStandingIndex).
  const divStandingsTop = divStandingsAll.slice(0, 5).map((s, i) => ({ ...s, _rank: i + 1 }));
  const divStandings = myStandingIndex >= 0 && myStandingIndex >= 5
    ? [...divStandingsTop, { ...divStandingsAll[myStandingIndex], _rank: myStandingIndex + 1, _isOwnRowBreak: true }]
    : divStandingsTop;

  return { hasPoolSubtabs, ownPoolRow, divStandingsAll, divStandingsTop, divStandings, myStandingIndex, myManagerRank };
}
