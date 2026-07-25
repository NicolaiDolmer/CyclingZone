// #2851 · Pyramide-komprimering S1→S2 (ejer-låst model 23/7, byg-beslutning 25/7).
//
// Mellem sæson 1 og 2 komprimeres pyramiden så D2 fyldes med ægte hold NU i
// stedet for over ~6 sæsoner: global rangering af alle managerhold på S1
// season_standings.total_points på tværs af alle puljer → rank 1-48 → D2
// (2 puljer, snake), 49-144 → D3 (4 puljer, snake), 145+ → D4 (kun pulje A/B,
// snake, så resterne får medspillere). D1 røres ikke. Motorens op/nedrykning
// springes over via season_end_skip_division_movement (seasonEndMovementFlag.js)
// og genoptages S2→S3.
//
// Dette modul er RENE funktioner (ingen I/O) — ejer-gate-krav 25/7: "ren
// fordelings-funktion unit-testet". Al DB-læsning/skrivning bor i
// scripts/compressPyramid.js.

/**
 * Global rangering af managerhold på tværs af alle puljer.
 *
 * @param {Array<{id, name, division, league_division_id}>} teams
 *        Managerhold — caller har allerede filtreret med den fulde
 *        menneske-diskriminator (is_ai=false, is_frozen=false,
 *        is_test_account=false, is_bank=false).
 * @param {Array<{team_id, total_points, gc_wins, stage_wins}>} standings
 *        season_standings-rækker for den afsluttede sæson.
 * @returns {Array} rangeret liste (rank 1 = bedst) med
 *        { teamId, name, rank, totalPoints, gcWins, stageWins,
 *          fromTier, fromPoolId, missingStanding }.
 *
 * Tiebreak (deterministisk — samme input giver ALTID samme liste, så listen
 * ejeren godkender søndag ~19:30 er præcis den der køres):
 *   total_points DESC → gc_wins DESC → stage_wins DESC → name ASC → id ASC.
 * Hold uden standings-række rangeres som 0 point (markeret missingStanding,
 * så dry-run-output kan flage dem eksplicit).
 */
export function rankTeamsGlobally({ teams, standings }) {
  const byTeamId = new Map();
  for (const s of standings || []) {
    if (s?.team_id != null) byTeamId.set(s.team_id, s);
  }
  const rows = (teams || []).map((team) => {
    const s = byTeamId.get(team.id) || null;
    return {
      teamId: team.id,
      name: team.name ?? "",
      totalPoints: Math.max(0, Number(s?.total_points) || 0),
      gcWins: Math.max(0, Number(s?.gc_wins) || 0),
      stageWins: Math.max(0, Number(s?.stage_wins) || 0),
      fromTier: team.division ?? null,
      fromPoolId: team.league_division_id ?? null,
      missingStanding: !s,
    };
  });
  rows.sort((a, b) =>
    (b.totalPoints - a.totalPoints)
    || (b.gcWins - a.gcWins)
    || (b.stageWins - a.stageWins)
    || String(a.name).localeCompare(String(b.name), "en")
    || String(a.teamId).localeCompare(String(b.teamId), "en"),
  );
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Snake-fordeling af en ordnet liste over P puljer (boustrofedon):
 * række 0 → A,B,..,P · række 1 → P,..,B,A · osv. Balancerer styrke, så pulje A
 * ikke støvsuger alle top-seeds.
 */
export function snakeAssign(orderedItems, pools) {
  const P = pools.length;
  if (!P) throw new Error("snakeAssign: mindst én pulje kræves");
  return orderedItems.map((item, i) => {
    const row = Math.floor(i / P);
    const col = i % P;
    const poolIdx = row % 2 === 0 ? col : P - 1 - col;
    return { item, pool: pools[poolIdx] };
  });
}

/**
 * Fordel den globale rangering på pyramiden (ejer-låst model):
 *   rank 1..d2Capacity            → tier 2-puljer (snake)
 *   næste d3Capacity              → tier 3-puljer (snake)
 *   resten                        → de FØRSTE d4PoolCount tier 4-puljer
 *                                   (pool_index-orden, snake) — samles i A/B
 *                                   så de får medspillere; øvrige D4-puljer
 *                                   forbliver AI/nye signups.
 *
 * @param {Array} rankedTeams  output fra rankTeamsGlobally (rank-orden).
 * @param {Array<{id, tier, pool_index}>} pools  league_divisions-rækker.
 * @returns {{ assignments, byPool }} assignments =
 *   { teamId, name, rank, totalPoints, fromTier, fromPoolId, toTier, toPoolId,
 *     movement: 'promoted'|'relegated'|'unchanged'|'pool-move' }.
 *
 * Kaster ved strukturbrud (forkert antal tier 2/3-puljer, kapacitet der ikke
 * går op i puljerne) — fordelingen må aldrig gætte sig gennem en skæv pyramide.
 */
export function distributeCompression(rankedTeams, pools, {
  d2Capacity = 48,
  d3Capacity = 96,
  d4PoolCount = 2,
} = {}) {
  const byTier = new Map();
  for (const p of pools || []) {
    if (!byTier.has(p.tier)) byTier.set(p.tier, []);
    byTier.get(p.tier).push(p);
  }
  for (const list of byTier.values()) list.sort((a, b) => a.pool_index - b.pool_index);

  const d2Pools = byTier.get(2) || [];
  const d3Pools = byTier.get(3) || [];
  const d4Pools = (byTier.get(4) || []).slice(0, d4PoolCount);
  if (d2Pools.length !== 2) throw new Error(`distributeCompression: forventede 2 tier 2-puljer, fandt ${d2Pools.length}`);
  if (d3Pools.length !== 4) throw new Error(`distributeCompression: forventede 4 tier 3-puljer, fandt ${d3Pools.length}`);
  if (d4Pools.length < 1) throw new Error("distributeCompression: ingen tier 4-puljer til rest-fordeling");
  if (d2Capacity % d2Pools.length !== 0) throw new Error(`d2Capacity ${d2Capacity} deler ikke ${d2Pools.length} puljer ligeligt`);
  if (d3Capacity % d3Pools.length !== 0) throw new Error(`d3Capacity ${d3Capacity} deler ikke ${d3Pools.length} puljer ligeligt`);

  const ranked = [...(rankedTeams || [])];
  const segments = [
    { teams: ranked.slice(0, d2Capacity), pools: d2Pools, tier: 2 },
    { teams: ranked.slice(d2Capacity, d2Capacity + d3Capacity), pools: d3Pools, tier: 3 },
    { teams: ranked.slice(d2Capacity + d3Capacity), pools: d4Pools, tier: 4 },
  ];

  const assignments = [];
  const byPool = new Map();
  for (const seg of segments) {
    for (const { item, pool } of snakeAssign(seg.teams, seg.pools)) {
      const movement = item.fromTier == null || item.fromTier === seg.tier
        ? (item.fromPoolId === pool.id ? "unchanged" : "pool-move")
        : (seg.tier < item.fromTier ? "promoted" : "relegated");
      assignments.push({ ...item, toTier: seg.tier, toPoolId: pool.id, movement });
      byPool.set(pool.id, (byPool.get(pool.id) || 0) + 1);
    }
  }
  return { assignments, byPool };
}

/**
 * Netto-bevægelses-opsummering til ejer-listen + notifikationer (KUN netto-
 * ændringer i tier udløser besked — pool-move inden for samme tier gør ikke).
 */
export function summarizeMovements(assignments) {
  const promoted = assignments.filter((a) => a.movement === "promoted");
  const relegated = assignments.filter((a) => a.movement === "relegated");
  const poolMoves = assignments.filter((a) => a.movement === "pool-move");
  const unchanged = assignments.filter((a) => a.movement === "unchanged");
  return { promoted, relegated, poolMoves, unchanged };
}
