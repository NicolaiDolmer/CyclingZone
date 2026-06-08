import { SPONSOR_INCOME_BASE } from "./economyConstants.js";

export const FIRST_VARIABLE_SPONSOR_SEASON = 2;
// Sæson 2+ sponsor-base (ejer-beslutning 2026-06-08: hævet 200k → 2,5M). Den
// performance-baserede pulje (VARIABLE_SPONSOR_POOL) lægges oveni, og board-
// modifier + pullout-faktor anvendes på gross_sponsor i economyEngine.
export const VARIABLE_SPONSOR_BASE = 2_500_000;
export const VARIABLE_SPONSOR_POOL = 150_000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildSponsorStandingsContext(standings = []) {
  const standingByTeamId = new Map();
  const divisionStandingsByDivision = new Map();

  for (const standing of standings || []) {
    if (!standing?.team_id) continue;
    standingByTeamId.set(standing.team_id, standing);
    const division = standing.division ?? null;
    if (division === null) continue;
    if (!divisionStandingsByDivision.has(division)) {
      divisionStandingsByDivision.set(division, []);
    }
    divisionStandingsByDivision.get(division).push(standing);
  }

  return { standingByTeamId, divisionStandingsByDivision };
}

export function computeVariableSponsor({
  lastSeasonPoints = 0,
  lastSeasonRank = null,
  divisionPoints = [],
  divisionSize = null,
} = {}) {
  const points = Math.max(0, Number(lastSeasonPoints) || 0);
  const size = Number.isInteger(divisionSize) && divisionSize > 0
    ? divisionSize
    : divisionPoints.length;
  const medianPoints = median(divisionPoints.map((value) => Math.max(0, Number(value) || 0)));
  const pointsFactor = medianPoints > 0
    ? points / medianPoints
    : points > 0
      ? 1
      : 0;
  const rank = Number.isInteger(lastSeasonRank) ? lastSeasonRank : null;
  const rankNormalized = rank === null
    ? 1
    : size > 1
      ? clamp((rank - 1) / (size - 1), 0, 1)
      : 0;
  const rankFactor = clamp(1 - rankNormalized, 0, 1);
  const performanceScore = pointsFactor * rankFactor;
  const variable = Math.round(clamp(performanceScore * VARIABLE_SPONSOR_POOL, 0, VARIABLE_SPONSOR_POOL));

  return {
    base: VARIABLE_SPONSOR_BASE,
    variable,
    total: VARIABLE_SPONSOR_BASE + variable,
    variable_pool: VARIABLE_SPONSOR_POOL,
    performance_score: performanceScore,
    rank_factor: rankFactor,
    points_factor: pointsFactor,
    median_points: medianPoints,
    division_size: size,
  };
}

export function computeSponsorForSeason({
  seasonNumber = null,
  team = {},
  lastSeasonStanding = null,
  divisionStandings = [],
} = {}) {
  const legacySponsor = team?.sponsor_income ?? SPONSOR_INCOME_BASE;

  if (!Number.isInteger(seasonNumber) || seasonNumber < FIRST_VARIABLE_SPONSOR_SEASON) {
    return {
      mode: "intro",
      season_number: seasonNumber,
      base: legacySponsor,
      variable: 0,
      gross_sponsor: legacySponsor,
      capped: false,
      explanation: "Sæson 1/introsæson: fast sponsor.",
    };
  }

  if (!lastSeasonStanding) {
    return {
      mode: "fallback",
      season_number: seasonNumber,
      base: legacySponsor,
      variable: 0,
      gross_sponsor: legacySponsor,
      capped: false,
      explanation: "Mangler forrige sæsons standings: bruger legacy sponsor.",
    };
  }

  const divisionPoints = (divisionStandings || []).map((standing) => standing.total_points || 0);
  const computed = computeVariableSponsor({
    lastSeasonPoints: lastSeasonStanding.total_points || 0,
    lastSeasonRank: lastSeasonStanding.rank_in_division ?? null,
    divisionPoints,
    divisionSize: divisionStandings?.length || null,
  });

  return {
    mode: "variable",
    season_number: seasonNumber,
    base: computed.base,
    variable: computed.variable,
    gross_sponsor: computed.total,
    capped: computed.variable >= VARIABLE_SPONSOR_POOL,
    // #666: EN fallback string; consumers may render via sponsor.explanation.variable
    // i18n-key med params { base, variable } for fuld locale-rendering.
    explanation: `Base ${computed.base} + variable ${computed.variable} based on last season's points/rank.`,
    explanationCode: "sponsor.explanation.variable",
    explanationParams: { base: computed.base, variable: computed.variable },
    last_season_points: lastSeasonStanding.total_points || 0,
    last_season_rank: lastSeasonStanding.rank_in_division ?? null,
    last_season_division: lastSeasonStanding.division ?? null,
    division_size: computed.division_size,
    median_points: computed.median_points,
    performance_score: computed.performance_score,
    rank_factor: computed.rank_factor,
    points_factor: computed.points_factor,
  };
}
