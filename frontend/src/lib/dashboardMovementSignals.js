// vk-movement-signals — bevægelses-signaler på dashboardets i dag
// "frosne" tal: divisionsplacering + holdpoint siden sidste AFSLUTTEDE
// løbsdag i egen pulje. Rene funktioner (ingen React/Supabase) — unit-testet
// med `node --test`, samme mønster som lib/dashboardDivStandings.js.
//
// Datakilde-verifikation (før bygning, jf. opgavens krav): season_standings
// giver kun det AKTUELLE total_points/rank_in_division — ingen historik pr.
// løbsdag. team_race_points_mv (backend/lib/refreshRankingMatviews.js) giver
// derimod hold-point PR. LØB, allerede genbrugt af StandingsPage.jsx's
// progressions-graf. Ved at trække sidste løbsdags race_points fra det
// nuværende total_points kan vi rekonstruere stillingen SOM DEN VAR før sidste
// løbsdag — uden en dedikeret snapshot-tabel. games.races.game_day_start (ikke
// UUID-id'et — races.id er tilfældig UUID, IKKE kronologisk, verificeret mod
// prod 18/8) er den kronologiske markør; "løbsdag" kan dække FLERE løb samme
// game_day_start.
//
// Trupværdi-delta (nævnt i opgaven) er IKKE bygget: riders.market_value har
// ingen historik-tabel i schema-snapshot.json (kun et punkt-i-tiden-felt) —
// rapporteret som manglende datakilde, ikke opfundet.

/**
 * Finder den seneste AFSLUTTEDE løbsdag i puljen (højeste game_day_start
 * blandt completed-løb) + hvilke race_id'er der hørte til den dag (en dag kan
 * dække flere løb).
 *
 * @param {Array<{id: string, status: string, game_day_start: number|null}>} poolRaces
 * @returns {{ day: number, raceIds: string[] } | null}
 */
export function findLastCompletedRaceDay(poolRaces) {
  const completed = (poolRaces || []).filter(
    (r) => r?.status === "completed" && r?.id != null && r?.game_day_start != null
  );
  if (!completed.length) return null;
  const lastDay = Math.max(...completed.map((r) => Number(r.game_day_start)));
  const raceIds = completed
    .filter((r) => Number(r.game_day_start) === lastDay)
    .map((r) => r.id);
  return { day: lastDay, raceIds };
}

/**
 * Aggregerer team_race_points_mv-rækker (team_id, race_points) til ét
 * points-tal pr. hold — summeret over ét eller flere race_id'er (samme
 * løbsdag kan rumme flere løb).
 *
 * @param {Array<{team_id: string, race_points: number}>} rows
 * @returns {Record<string, number>}
 */
export function sumPointsByTeam(rows) {
  const out = {};
  for (const row of rows || []) {
    if (!row?.team_id) continue;
    out[row.team_id] = (out[row.team_id] || 0) + (Number(row.race_points) || 0);
  }
  return out;
}

/**
 * Beregner divisionsplacerings-bevægelse + holdpoint siden sidste løbsdag for
 * EGET hold.
 *
 * @param {Array<{team_id: string, total_points: number}>} divStandingsAll -
 *   samme sorterede (total_points DESC) array som computeMyDivisionStandings
 *   returnerer (dashboardDivStandings.js).
 * @param {string|null} myTeamId
 * @param {Record<string, number>} pointsByTeam - fra sumPointsByTeam()
 * @returns {{ rankMovement: number|null, pointsDelta: number|null }}
 *   rankMovement > 0 = klatret (positiv retning), < 0 = faldet. null = intet
 *   at vise (ingen løbsdag endnu, eget hold ikke i listen, e.l.).
 */
export function computeDivisionMovement({ divStandingsAll, myTeamId, pointsByTeam }) {
  if (!myTeamId || !divStandingsAll?.length) return { rankMovement: null, pointsDelta: null };

  const pointsDelta = pointsByTeam?.[myTeamId] ?? null;
  if (pointsDelta == null) return { rankMovement: null, pointsDelta: null };

  const currentRank = divStandingsAll.findIndex((s) => s.team_id === myTeamId);
  if (currentRank < 0) return { rankMovement: null, pointsDelta };

  const priorSorted = divStandingsAll
    .map((s) => ({
      team_id: s.team_id,
      priorPoints: (Number(s.total_points) || 0) - (pointsByTeam?.[s.team_id] || 0),
    }))
    .sort((a, b) => b.priorPoints - a.priorPoints);
  const priorRank = priorSorted.findIndex((s) => s.team_id === myTeamId);
  if (priorRank < 0) return { rankMovement: null, pointsDelta };

  // Lavere index = bedre placering → klatret = priorRank var HØJERE (dårligere).
  const rankMovement = priorRank - currentRank;
  return { rankMovement, pointsDelta };
}
