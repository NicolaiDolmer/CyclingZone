// Dominans/varians-metrikker for race-simulator-output (#2224, Race v3 S0).
//
// 100% REN lib: intet I/O, ingen imports fra raceSimulator/supabase — kun plain
// data ind/ud. Konsumerer simulateStage-output (backend/lib/raceSimulator.js):
//   ranked: [{ rider_id, team_id, rank, finalScore, stageGap,
//              components:{terrain,noise,form,fatigue,team,breakaway,finale} }]
// sorteret efter rank (1 = vinder). Bruges af dominans-harnesset til at måle om
// motoren er for forudsigelig (samme favorit/hold vinder for ofte) eller for
// flad (ingen sammenhæng mellem evne og resultat).

/**
 * Observér ét løbs dominans-signaler.
 *
 * Favorit = entrant med højeste components.terrain i HELE ranked (ikke kun
 * top 10); ved uafgjort vælges laveste rider_id (String-compare, deterministisk).
 * maxSameTeamTop10/distinctTeamsTop10 måles over ranked.slice(0, 10). Manglende
 * eller null team_id ⇒ rytteren tæller som sit eget (unikke) hold — null-ryttere
 * må ALDRIG klumpes sammen som ét fælles "nulhold".
 *
 * @param {object} args
 * @param {Array<{rider_id:string, team_id?:string|null, rank:number, components:{terrain:number}}>} args.ranked
 * @param {Map<string, string|null>} [args.teamByRider]  rider_id → team_id|null (fallback til ranked[i].team_id hvis udeladt)
 * @param {string} [args.terrain]  terrænprofil, videreføres uændret i output til brug i aggregering
 * @returns {{
 *   terrain: string|undefined, fieldSize: number, winnerId: string|null,
 *   favoriteId: string|null, favoriteRank: number|null, favoriteWon: boolean,
 *   favoritePodium: boolean, maxSameTeamTop10: number, distinctTeamsTop10: number
 * }}
 */
export function observeRace({ ranked = [], teamByRider, terrain } = {}) {
  const fieldSize = ranked.length;

  if (fieldSize === 0) {
    return {
      terrain,
      fieldSize: 0,
      winnerId: null,
      favoriteId: null,
      favoriteRank: null,
      favoriteWon: false,
      favoritePodium: false,
      maxSameTeamTop10: 0,
      distinctTeamsTop10: 0,
    };
  }

  const winner = ranked.find((r) => r.rank === 1) ?? ranked[0];

  // Favorit: højeste components.terrain i HELE ranked; tie → laveste rider_id.
  let favorite = null;
  for (const r of ranked) {
    const terrainScore = r.components?.terrain ?? -Infinity;
    if (favorite === null) {
      favorite = r;
      continue;
    }
    const favTerrain = favorite.components?.terrain ?? -Infinity;
    if (terrainScore > favTerrain) {
      favorite = r;
    } else if (
      terrainScore === favTerrain &&
      String(r.rider_id) < String(favorite.rider_id)
    ) {
      favorite = r;
    }
  }

  const teamOf = (r) => {
    const t = teamByRider ? teamByRider.get(r.rider_id) : r.team_id;
    return t ?? null;
  };

  const top10 = [...ranked].sort((a, b) => a.rank - b.rank).slice(0, 10);

  // Null/manglende team_id ⇒ rytteren er sit eget unikke hold — brug rider_id
  // som nøgle for at undgå at alle null-ryttere klumpes sammen.
  const teamCounts = new Map();
  for (const r of top10) {
    const team = teamOf(r);
    const key = team === null ? `__solo__:${r.rider_id}` : team;
    teamCounts.set(key, (teamCounts.get(key) || 0) + 1);
  }

  const maxSameTeamTop10 = teamCounts.size ? Math.max(...teamCounts.values()) : 0;
  const distinctTeamsTop10 = teamCounts.size;

  return {
    terrain,
    fieldSize,
    winnerId: winner ? winner.rider_id : null,
    favoriteId: favorite ? favorite.rider_id : null,
    favoriteRank: favorite ? favorite.rank : null,
    favoriteWon: !!(favorite && winner && favorite.rider_id === winner.rider_id),
    favoritePodium: !!(favorite && favorite.rank <= 3),
    maxSameTeamTop10,
    distinctTeamsTop10,
  };
}

/**
 * Aggregér en liste af observeRace()-observationer på tværs af løb.
 *
 * @param {Array<ReturnType<typeof observeRace>>} observations
 * @returns {{
 *   races: number, favoriteWinRate: number|null, favoritePodiumRate: number|null,
 *   share4PlusSameTeamTop10: number|null, avgMaxSameTeamTop10: number|null,
 *   avgDistinctTeamsTop10: number|null,
 *   perTerrain: Record<string, {races:number, favoriteWinRate: number|null}>
 * }}
 */
export function aggregateObservations(observations = []) {
  const races = observations.length;

  if (races === 0) {
    return {
      races: 0,
      favoriteWinRate: null,
      favoritePodiumRate: null,
      share4PlusSameTeamTop10: null,
      avgMaxSameTeamTop10: null,
      avgDistinctTeamsTop10: null,
      perTerrain: {},
    };
  }

  let wins = 0;
  let podiums = 0;
  let share4Plus = 0;
  let sumMaxSameTeam = 0;
  let sumDistinctTeams = 0;

  const perTerrain = {};

  for (const obs of observations) {
    if (obs.favoriteWon) wins++;
    if (obs.favoritePodium) podiums++;
    if (obs.maxSameTeamTop10 >= 4) share4Plus++;
    sumMaxSameTeam += obs.maxSameTeamTop10;
    sumDistinctTeams += obs.distinctTeamsTop10;

    const key = obs.terrain;
    if (!perTerrain[key]) perTerrain[key] = { races: 0, wins: 0 };
    perTerrain[key].races++;
    if (obs.favoriteWon) perTerrain[key].wins++;
  }

  const perTerrainOut = {};
  for (const [terrain, agg] of Object.entries(perTerrain)) {
    perTerrainOut[terrain] = {
      races: agg.races,
      favoriteWinRate: agg.races > 0 ? agg.wins / agg.races : null,
    };
  }

  return {
    races,
    favoriteWinRate: wins / races,
    favoritePodiumRate: podiums / races,
    share4PlusSameTeamTop10: share4Plus / races,
    avgMaxSameTeamTop10: sumMaxSameTeam / races,
    avgDistinctTeamsTop10: sumDistinctTeams / races,
    perTerrain: perTerrainOut,
  };
}

/**
 * Win-rate-fordeling over ryttere med tilstrækkeligt mange starter.
 *
 * @param {object} args
 * @param {Map<string, number>} args.winsByRider
 * @param {Map<string, number>} args.startsByRider
 * @param {number} [args.minStarts=5]
 * @returns {{
 *   riders: number, maxWinRate: number|null, p95WinRate: number|null,
 *   histogram: Array<{from:number, to:number, count:number}>
 * }}
 */
export function winRateStats({ winsByRider, startsByRider, minStarts = 5 } = {}) {
  const rates = [];
  for (const [riderId, starts] of startsByRider.entries()) {
    if (starts < minStarts) continue;
    const wins = winsByRider.get(riderId) || 0;
    rates.push(wins / starts);
  }

  const histogram = [];
  for (let i = 0; i < 10; i++) {
    histogram.push({ from: i / 10, to: (i + 1) / 10, count: 0 });
  }

  if (rates.length === 0) {
    return { riders: 0, maxWinRate: null, p95WinRate: null, histogram };
  }

  for (const rate of rates) {
    const idx = rate >= 1 ? 9 : Math.min(9, Math.floor(rate * 10));
    histogram[idx].count++;
  }

  const sorted = [...rates].sort((a, b) => a - b);
  const len = sorted.length;
  const p95 = sorted[Math.min(len - 1, Math.floor(0.95 * len))];

  return {
    riders: len,
    maxWinRate: sorted[len - 1],
    p95WinRate: p95,
    histogram,
  };
}

/**
 * Gini-koefficient over sejr-counts for ALLE ryttere med ≥1 start (0 sejre
 * tæller med). Standard-formel på sorteret array:
 *   G = (2·Σ(i+1)·x_i)/(n·Σx_i) − (n+1)/n
 *
 * @param {object} args
 * @param {Map<string, number>} args.winsByRider
 * @param {Map<string, number>} args.startsByRider
 * @returns {number|null}  null hvis n=0 eller Σx=0
 */
export function giniOverWins({ winsByRider, startsByRider } = {}) {
  const wins = [];
  for (const riderId of startsByRider.keys()) {
    const starts = startsByRider.get(riderId) || 0;
    if (starts < 1) continue;
    wins.push(winsByRider.get(riderId) || 0);
  }

  const n = wins.length;
  if (n === 0) return null;

  const sumX = wins.reduce((a, b) => a + b, 0);
  if (sumX === 0) return null;

  const sorted = [...wins].sort((a, b) => a - b);
  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += (i + 1) * sorted[i];
  }

  return (2 * weightedSum) / (n * sumX) - (n + 1) / n;
}

/**
 * Placerings-delta for hjælperyttere mellem to kørsler af samme løb (med og
 * uden roller). Kun ryttere med rolle 'helper' i roleByRider medregnes; ryttere
 * der kun findes i den ene kørsel springes over.
 *
 * @param {object} args
 * @param {Array<{rider_id:string, rank:number}>} args.rankedRoles    kørsel MED roller
 * @param {Array<{rider_id:string, rank:number}>} args.rankedNeutral  kørsel UDEN roller
 * @param {Map<string, 'captain'|'sprint_captain'|'helper'|'hunter'>} args.roleByRider
 * @returns {number[]}  delta = rankRoles − rankNeutral (positiv = tabte pladser)
 */
export function helperPlacementDeltas({ rankedRoles = [], rankedNeutral = [], roleByRider } = {}) {
  const rankRolesById = new Map(rankedRoles.map((r) => [r.rider_id, r.rank]));
  const rankNeutralById = new Map(rankedNeutral.map((r) => [r.rider_id, r.rank]));

  const deltas = [];
  for (const [riderId, role] of roleByRider.entries()) {
    if (role !== "helper") continue;
    if (!rankRolesById.has(riderId) || !rankNeutralById.has(riderId)) continue;
    deltas.push(rankRolesById.get(riderId) - rankNeutralById.get(riderId));
  }
  return deltas;
}

/**
 * Median af et talarray. Sorterings-uafhængig (sorterer internt, ændrer ikke input).
 *
 * @param {number[]} xs
 * @returns {number|null}  null hvis tom
 */
export function median(xs = []) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Kvantil (nearest-rank, floor-indeks) af et talarray. Samme konvention som
 * harnessets percentile()-helper. Sorterer internt, ændrer ikke input.
 *
 * @param {number[]} xs
 * @param {number} p  ∈ [0,1]
 * @returns {number|null}  null hvis tom
 */
export function quantile(xs = [], p) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * S1 counterfactual hjælper-tab (#2352): parret placering-delta for TOP-hjælpere
 * mellem to kørsler af SAMME løb med SAMME seed — roller som tildelt vs. alle
 * ryttere uden arbejds-forpligtelse (all-free_role / rolle-strippet: bit-
 * identiske counterfactuals, da hverken free_role eller manglende rolle betaler
 * work-cost eller bidrager til helperSupport, og work_cost/team konsumerer
 * ingen rng — same-seed-parringen er derfor ren).
 *
 * LINSE-RATIONALE (afløser fuld-felt-medianen som S1's bindende metrik): i et
 * realistisk pulje-felt er næsten ALLE ryttere hjælpere, så fuld-felt-medianen
 * er ~0 uanset work-cost-styrke (alle får samme straf → indbyrdes rækkefølge
 * uændret). Ejerens "A — MARKANT"-bånd (10-30 tabte pladser) handler om
 * hjælpere der ELLERS ville køre med i toppen — derfor filtreres til ryttere
 * med role=helper OG terrain-score i feltets top-N (default 15).
 *
 * Fortegns-konvention (samme som helperPlacementDeltas): delta = rankRoles −
 * rankCounterfactual, POSITIV = tabte pladser pga. hjælperarbejdet.
 *
 * @param {object} args
 * @param {Array<{rider_id:string, rank:number, components:{terrain:number}}>} args.rankedRoles
 *   kørsel MED roller (v3) — components.terrain bruges til top-N-filteret
 * @param {Array<{rider_id:string, rank:number}>} args.rankedCounterfactual
 *   kørsel med samme entrants+seed uden arbejds-roller
 * @param {Map<string, string>} args.roleByRider  rider_id → race_role
 * @param {number} [args.topTerrainN=15]  kun hjælpere blandt feltets top-N på terrain
 * @returns {number[]}
 */
export function helperCounterfactualDeltas({ rankedRoles = [], rankedCounterfactual = [], roleByRider, topTerrainN = 15 } = {}) {
  if (!roleByRider || rankedRoles.length === 0) return [];

  // Top-N på terrain (deterministisk tiebreak på rider_id, som motoren selv).
  const byTerrain = [...rankedRoles].sort((a, b) =>
    ((b.components?.terrain ?? -Infinity) - (a.components?.terrain ?? -Infinity)) ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  );
  const topIds = new Set(byTerrain.slice(0, topTerrainN).map((r) => r.rider_id));

  const rolesRankById = new Map(rankedRoles.map((r) => [r.rider_id, r.rank]));
  const cfRankById = new Map(rankedCounterfactual.map((r) => [r.rider_id, r.rank]));

  const deltas = [];
  for (const [riderId, role] of roleByRider.entries()) {
    if (role !== "helper") continue;
    if (!topIds.has(riderId)) continue;
    if (!rolesRankById.has(riderId) || !cfRankById.has(riderId)) continue;
    deltas.push(rolesRankById.get(riderId) - cfRankById.get(riderId));
  }
  return deltas;
}
