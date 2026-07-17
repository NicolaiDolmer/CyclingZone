// Global rank (#2453): pointformlen bag global_rank_mv (database/2026-07-17-
// global-rank.sql). Den FAKTISKE beregning kører i Postgres (matview, ikke
// live) — denne fil er en 1:1 JS-mirror af SQL'ens CASE-udtryk, så
// vægtningen (division + sæson) og "nye manager"-normaliseringen kan
// testes med node --test uden en database. Ændrer du en konstant her,
// SKAL den matchende konstant i .sql-filen ændres i samme PR.
//
// BESLUTNING (ejer godkender/justerer ved merge, se PR-body + issue #2453):
//   * DIVISION_WEIGHTS: Div 1 tæller mest (4x), Div 4 mindst (1x) — en gammel
//     Div-4-sejr skal ikke veje som en Div-1-sejr.
//   * SEASON_WEIGHTS: kun de seneste 2 sæsoner tælles. recency=1 (nuværende)
//     vejer dobbelt af recency=2 (forrige). Ældre sæsoner falder helt af.
//   * Nye managere: global_score er et GENNEMSNIT pr. sæson deltaget
//     (weighted_points_sum / seasons_played), ikke en rå sum — en ny manager
//     med kun 1 sæson måles på sit per-sæson-snit, ikke straffet for færre
//     sæsoner, men heller ikke favoriseret ved at "stakke" flere sæsoner.

export const DIVISION_WEIGHTS = { 1: 4, 2: 3, 3: 2, 4: 1 };

// Nøgle = recency_rank (1 = mest aktuelle sæson, 2 = forrige). Kun disse to
// tælles (matcher SQL'ens `WHERE rs.recency_rank <= 2`).
export const SEASON_WEIGHTS = { 1: 1.0, 2: 0.5 };
export const SEASON_WINDOW = 2;

function divisionWeight(division) {
  return DIVISION_WEIGHTS[division] ?? 1;
}

function seasonWeight(recencyRank) {
  return SEASON_WEIGHTS[recencyRank] ?? 0;
}

// rows: [{ division, totalPoints, recencyRank }] — én række pr. (sæson, hold)
// hvor holdet har en season_standings-række. recencyRank 1 = nuværende sæson.
// Rækker med recencyRank > SEASON_WINDOW bidrager 0 (matcher SQL CASE ELSE 0),
// men tælles ikke med i seasons_played heller (matcher `WHERE rs.recency_rank <= 2`
// i SQL'ens weighted-CTE — kaldere bør allerede have filtreret dem ud).
export function computeGlobalScore(rows) {
  const inWindow = (rows || []).filter(r => r.recencyRank <= SEASON_WINDOW);
  if (inWindow.length === 0) {
    return { weightedPointsSum: 0, seasonsPlayed: 0, globalScore: 0 };
  }
  const weightedPointsSum = inWindow.reduce(
    (sum, r) => sum + r.totalPoints * divisionWeight(r.division) * seasonWeight(r.recencyRank),
    0,
  );
  const seasonsPlayed = inWindow.length;
  const globalScore = Math.round((weightedPointsSum / seasonsPlayed) * 100) / 100;
  return { weightedPointsSum, seasonsPlayed, globalScore };
}

// Rangerer en liste af { teamId, rows } efter global_score DESC (RANK()-stil:
// lige score = samme rang, næste rang springer over de lige-placerede — matcher
// Postgres' RANK() window-funktion, IKKE ROW_NUMBER()).
export function rankTeams(teams) {
  const scored = (teams || []).map(t => ({ teamId: t.teamId, ...computeGlobalScore(t.rows) }));
  scored.sort((a, b) => b.globalScore - a.globalScore);
  let rank = 0;
  let lastScore = null;
  let seen = 0;
  return scored.map(s => {
    seen += 1;
    if (s.globalScore !== lastScore) { rank = seen; lastScore = s.globalScore; }
    return { ...s, globalRank: rank };
  });
}
