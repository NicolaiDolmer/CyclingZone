// Global Rank (#2453): pure JS mirror of the pointmodel behind global_rank_mv
// (database/2026-07-17-global-rank.sql). The ACTUAL leaderboard is computed in
// Postgres (matview, freshness-heartbeat pattern) — this file lets the decay
// arithmetic + hide-inactive/rookie logic be tested with node --test without a
// database. Change a formula here, change the matching SQL in the same PR.
//
// DESIGN LÅST (ejer-godkendt 17/7, issue #2453):
//   * Points come from race results, weighted by race prestige/tier (already
//     baked into season_standings.total_points via race_points/race_class —
//     no new parallel point source).
//   * Decay: ALL banked points are HALVED at every season rollover
//     (multiplication, not a rolling date window, not a hard expiry).
//     Self-limiting: a constant P points/season converges to 2P
//     (P + P/2 + P/4 + … ), never inflates without bound.
//   * Managers with no activity in the last 2 seasons are hidden from the
//     list — their points are preserved, and they rank correctly on comeback.

// rollover: old banked balance + the season that just completed's points,
// then halved. Matches apply_global_rank_season_rollover()'s single UPDATE.
export function applySeasonRollover(bankedPoints, seasonPoints) {
  const banked = Number(bankedPoints) || 0;
  const season = Number(seasonPoints) || 0;
  return Math.round((banked + season) * 0.5 * 100) / 100;
}

// live global points = banked (already-decayed prior seasons) + current
// season's live points (season_standings.total_points for the active season).
export function computeGlobalPoints(bankedPoints, currentSeasonPoints) {
  return (Number(bankedPoints) || 0) + (Number(currentSeasonPoints) || 0);
}

// A team is "active" if it has a season_standings row in one of the last 2
// seasons (current + previous). Inactive teams are hidden from the list, but
// their points are never touched by this check — only display visibility.
export function isActiveRecent(seasonIdsPlayed, lastTwoSeasonIds) {
  const played = new Set(seasonIdsPlayed || []);
  return (lastTwoSeasonIds || []).some(id => played.has(id));
}

// Ranks teams RANK()-style (ties share a rank, next rank skips) — matches
// Postgres RANK() OVER (PARTITION BY active_recent ORDER BY global_points DESC).
// Only active teams are ranked; inactive teams get globalRank: null (hidden).
export function rankTeams(teams) {
  const active = (teams || []).filter(t => t.activeRecent);
  const inactive = (teams || []).filter(t => !t.activeRecent);
  const sorted = [...active].sort((a, b) => b.globalPoints - a.globalPoints);
  let rank = 0;
  let lastScore = null;
  let seen = 0;
  const rankedActive = sorted.map(t => {
    seen += 1;
    if (t.globalPoints !== lastScore) { rank = seen; lastScore = t.globalPoints; }
    return { ...t, globalRank: rank };
  });
  const rankedInactive = inactive.map(t => ({ ...t, globalRank: null }));
  return [...rankedActive, ...rankedInactive];
}

// "Climbers of the season": places gained since the season-start snapshot.
// Positive = climbed (lower rank number now). Inactive/unranked teams (rank
// null) are excluded — can't measure movement without a current rank.
export function computeClimbers(rows, seasonStartRankByTeam) {
  return (rows || [])
    .filter(r => r.globalRank != null)
    .map(r => {
      const startRank = seasonStartRankByTeam.get(r.teamId);
      const placesGained = startRank == null ? null : startRank - r.globalRank;
      return { ...r, placesGained };
    })
    .filter(r => r.placesGained != null && r.placesGained > 0)
    .sort((a, b) => b.placesGained - a.placesGained);
}

// "Best new manager": rookies (first season played) ranked by global points.
export function computeBestNewManagers(rows) {
  return (rows || [])
    .filter(r => r.isRookie && r.globalRank != null)
    .sort((a, b) => b.globalPoints - a.globalPoints);
}

// Movement since last weekly snapshot — same shape as the old "since last
// refresh" idea, but anchored to a real weekly snapshot table now.
export function computeMovement(currentRank, previousRank) {
  if (currentRank == null) return null;
  if (previousRank == null) return null;
  return previousRank - currentRank;
}
