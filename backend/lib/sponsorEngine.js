import { MAX_BOARD_MODIFIER, SPONSOR_INCOME_BASE, SPONSOR_INCOME_BY_DIVISION } from "./economyConstants.js";

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
  activeContract = null,
} = {}) {
  // #1663: en aktiv kontrakt definerer den (låste) garanterede base. Den vinder over
  // den gamle division-flade-base. Per-løbsdag betales separat (sponsorRaceDayIncome).
  if (activeContract && Number.isFinite(Number(activeContract.guaranteed_base))) {
    const base = Number(activeContract.guaranteed_base);
    return {
      mode: "contract",
      season_number: seasonNumber,
      base,
      variable: 0,
      gross_sponsor: base,
      capped: false,
      per_race_day_rate: Number(activeContract.per_race_day_rate) || 0,
      // #2948: forecast-UI'et navngiver kontrakten (sponsorDetail.contract).
      sponsor_name: activeContract.sponsor_name ?? null,
      explanation: `Kontrakt-garanteret base ${base}.`,
    };
  }

  const legacySponsor = team?.sponsor_income ?? SPONSOR_INCOME_BASE;
  // Division-skaleret base (E2 + #1439 + #1441 A6): sponsor skalerer med den division
  // holdet konkurrerer i (D1 600k / D2 400k / D3 340k) — IKKE en flad, auto-eskalerende
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

// ─── Faktisk sæson-start-payout (#2753) ───────────────────────────────────────
//
// Gross-tallet fra computeSponsorForSeason er IKKE det holdet får udbetalt: lag 1
// (board budget_modifier) og lag 5 (sponsor-pullout) stacker multiplikativt oveni,
// og resultatet cappes af kontraktens loft. Beregningen boede kun i
// economyEngine.processSeasonStart, mens transition-previewet viste den rå gross
// base - ejeren planlagde derfor sæsonskifte på et tal der ikke holdt (#2753).
// Nu ejer denne fil regnestykket, og begge stier kalder det samme.

/**
 * Lag 1 board-modifier: gennemsnittet af budget_modifier over holdets
 * FÆRDIGFORHANDLEDE bestyrelsesplaner. Ingen completed plan → neutral 1.0.
 *
 * @param {Array<{negotiation_status?: string, budget_modifier?: number}>} boardProfiles
 * @returns {number}
 */
export function computeBoardBaseModifier(boardProfiles = []) {
  const activeBoards = (boardProfiles || []).filter(
    (board) => board?.negotiation_status === "completed"
  );
  if (activeBoards.length === 0) return 1.0;
  return (
    activeBoards.reduce((sum, board) => sum + (board.budget_modifier ?? 1.0), 0) /
    activeBoards.length
  );
}

/**
 * Den faktiske sponsor-udbetaling ved sæson-start.
 *
 *   modifier = board-modifier × pullout-faktor   (board test-mode → 1.0)
 *   ceiling  = round(kontraktens guaranteed_base ?? gross × MAX_BOARD_MODIFIER)
 *   payout   = min(round(gross × modifier), ceiling)
 *
 * Loftet (#1663) capper board-modifier-bypass, ikke legitim renown-skalering.
 *
 * @param {object} args
 * @param {number} args.grossSponsor       computeSponsorForSeason().gross_sponsor
 * @param {object|null} args.activeContract  kontrakten der er/bliver aktiv i sæsonen
 * @param {number} args.baseModifier       lag 1 (computeBoardBaseModifier)
 * @param {number} args.pulloutFactor      lag 5 (severity / 1000), 1.0 = ingen pullout
 * @param {boolean} args.boardTestMode     #805 - neutraliserer board-økonomien
 * @returns {{gross_sponsor:number, base_modifier:number, pullout_factor:number,
 *            modifier:number, ceiling:number, payout:number, capped_by_ceiling:boolean}}
 */
export function resolveSponsorPayout({
  grossSponsor = 0,
  activeContract = null,
  baseModifier = 1.0,
  pulloutFactor = 1.0,
  boardTestMode = false,
} = {}) {
  const gross = Number(grossSponsor) || 0;
  const resolvedBaseModifier = Number.isFinite(Number(baseModifier)) ? Number(baseModifier) : 1.0;
  const resolvedPulloutFactor = Number.isFinite(Number(pulloutFactor)) ? Number(pulloutFactor) : 1.0;
  // Lag 5 stacker MULTIPLIKATIVT med lag 1 (budget_modifier).
  const modifier = boardTestMode ? 1.0 : resolvedBaseModifier * resolvedPulloutFactor;
  const ceilingBase = activeContract?.guaranteed_base ?? gross;
  const ceiling = Math.round(Number(ceilingBase) * MAX_BOARD_MODIFIER);
  const modified = Math.round(gross * modifier);
  const payout = Math.min(modified, ceiling);

  return {
    gross_sponsor: gross,
    base_modifier: resolvedBaseModifier,
    pullout_factor: resolvedPulloutFactor,
    modifier,
    ceiling,
    payout,
    capped_by_ceiling: modified > ceiling,
  };
}
