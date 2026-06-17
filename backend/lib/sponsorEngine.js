import { SPONSOR_INCOME_BASE, SPONSOR_INCOME_BY_DIVISION } from "./economyConstants.js";

export const FIRST_VARIABLE_SPONSOR_SEASON = 2;
// Sæson 2+ sponsor: division-skaleret base (samme SPONSOR_INCOME_BY_DIVISION som
// sæson-1/intro) + en performance-baseret pulje (VARIABLE_SPONSOR_POOL) ovenpå.
// Board-modifier + pullout-faktor anvendes på gross_sponsor i economyEngine.
// Den tidligere flade base på 2,5M (band-aid fra open-beta lønkrisen, ejer 8/6)
// er fjernet 2026-06-17 (#1439): rod-årsagen blev løst af E2 (#1438), så den var
// ren inflation. Ingen auto-eskalering; intet hold modtager 2,5M. Det fulde
// økonomi-redesign (gold sinks, rigtige sponsorer) spores i epic #1441.
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
  base = 0,
  lastSeasonPoints = 0,
  lastSeasonRank = null,
  divisionPoints = [],
  divisionSize = null,
} = {}) {
  const resolvedBase = Number.isFinite(Number(base)) ? Number(base) : 0;
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
    base: resolvedBase,
    variable,
    total: resolvedBase + variable,
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
  // Division-skaleret base (E2 + #1439): sponsor skalerer med den division holdet
  // konkurrerer i (D1 600k / D2 400k / D3 260k) — IKKE en flad, auto-eskalerende
  // base. Division-kortet er AUTORITATIVT: relaunch-reset tvinger alle hold til
  // div 3 med stored sponsor_income=240k, så den stale kolonneværdi må ikke vinde.
  // team.division er primær; ved sæson 2+ uden current division bruges sidste
  // sæsons division; ukendt division → stored/legacy-gulv.
  const baseDivision = team?.division ?? lastSeasonStanding?.division ?? null;
  const divisionBase = SPONSOR_INCOME_BY_DIVISION[baseDivision] ?? legacySponsor;

  if (!Number.isInteger(seasonNumber) || seasonNumber < FIRST_VARIABLE_SPONSOR_SEASON) {
    return {
      mode: "intro",
      season_number: seasonNumber,
      base: divisionBase,
      variable: 0,
      gross_sponsor: divisionBase,
      capped: false,
      explanation: "Sæson 1/introsæson: division-skaleret sponsor.",
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
    base: divisionBase,
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
