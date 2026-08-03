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

// #3036: sentinel for "ingen række i denne klassifikation" i countback-leddene
// bestStageRank/bestGcRank. En rigtig placering er altid >= 1, så sentinellen
// taber ALTID mod en reel placering. Bevidst en stor endelig værdi (ikke
// Infinity) — Infinity - Infinity = NaN, som gør komparator-subtraktionen
// skrøbelig; MAX_SAFE_INTEGER - MAX_SAFE_INTEGER = 0 er sikkert og eksplicit.
export const NO_COUNTBACK_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Aggregerer countback-metrikker pr. hold fra rå race_results-rækker (#3036,
 * 61-61-lektionen fra S1→S2-komprimeringen, se pyramidCompression.test.js).
 * Ren funktion — DB-læsningen (paginerede rækker filtreret på sæson via
 * races.season_id) foregår i scripts/compressPyramid.js; denne funktion tager
 * allerede-hentede rækker og laver ÉN pass i JS (ingen pr.-hold-queries).
 *
 * Tæller bevidst IKKE 'stage'/'gc' rank=1 med i classificationWins — de er
 * allerede dækket af de eksisterende stage_wins/gc_wins-led i tiebreak-kæden
 * (samme definition som economyEngine.js' stats-opbygning: resultType==='stage'
 * && rank===1 hhv. 'gc' && rank===1). classificationWins dækker "øvrige
 * klassementer" (point/bjerg/ungdom/hold — slut- OG dag-typer).
 *
 * @param {Array<{team_id, result_type, rank}>} raceResults
 * @returns {Map<string, {classificationWins:number, stagePodiums:number,
 *   bestStageRank:number, bestGcRank:number}>} bestStageRank/bestGcRank er
 *   NO_COUNTBACK_RANK når holdet ingen rækker har for den type.
 */
export function buildCountbackByTeam(raceResults) {
  const byTeam = new Map();
  const entryFor = (teamId) => {
    let e = byTeam.get(teamId);
    if (!e) {
      e = { classificationWins: 0, stagePodiums: 0, bestStageRank: NO_COUNTBACK_RANK, bestGcRank: NO_COUNTBACK_RANK };
      byTeam.set(teamId, e);
    }
    return e;
  };
  for (const r of raceResults || []) {
    const teamId = r?.team_id;
    const rank = Number(r?.rank);
    if (teamId == null || !Number.isFinite(rank) || rank < 1) continue;
    const e = entryFor(teamId);
    if (r.result_type === "stage") {
      if (rank < e.bestStageRank) e.bestStageRank = rank;
      if (rank <= 3) e.stagePodiums += 1;
    } else if (r.result_type === "gc") {
      if (rank < e.bestGcRank) e.bestGcRank = rank;
    } else if (rank === 1) {
      e.classificationWins += 1;
    }
  }
  return byTeam;
}

/**
 * Global rangering af managerhold på tværs af alle puljer.
 *
 * @param {Array<{id, name, division, league_division_id}>} teams
 *        Managerhold — caller har allerede filtreret med den fulde
 *        menneske-diskriminator (is_ai=false, is_frozen=false,
 *        is_test_account=false, is_bank=false).
 * @param {Array<{team_id, total_points, gc_wins, stage_wins}>} standings
 *        season_standings-rækker for den afsluttede sæson.
 * @param {Map<string, {classificationWins, stagePodiums, bestStageRank, bestGcRank}>} [countback]
 *        OPTIONAL output fra buildCountbackByTeam, keyed by team_id. Udelades
 *        countback (caller leverer den ikke), falder funktionen tilbage til
 *        den GAMLE kæde (total_points → gc_wins → stage_wins → name → id) —
 *        alle countback-led bliver 0/sentinel for alle hold og annullerer
 *        derfor hinanden i komparatoren. Bagudkompatibelt og deterministisk.
 * @returns {Array} rangeret liste (rank 1 = bedst) med
 *        { teamId, name, rank, totalPoints, gcWins, stageWins,
 *          classificationWins, stagePodiums, bestStageRank, bestGcRank,
 *          fromTier, fromPoolId, missingStanding }.
 *
 * Tiebreak (deterministisk — samme input giver ALTID samme liste, så listen
 * ejeren godkender ved et sæsonskifte er præcis den der køres). Countback-
 * leddene blev indsat FØR navne-leddet efter 61-61-cutline-hændelsen 26/7
 * (#3036): S1→S2-komprimeringen afgjorde sidste D3-plads (Guds hånd vs HWT
 * Rockets, begge 61 point / 0 løbssejre / 0 etapesejre) reelt via NAVNE-
 * alfabetet. Manuel countback viste Guds hånd vandt entydigt sportsligt
 * (4 klassements-/dagssejre, 2 etape-podier, bedste GC 7. mod 0/0/11.).
 *   total_points DESC → gc_wins DESC → stage_wins DESC
 *     → classificationWins DESC → stagePodiums DESC
 *     → bestStageRank ASC → bestGcRank ASC
 *     → name ASC → id ASC.
 * Hold uden standings-række rangeres som 0 point (markeret missingStanding,
 * så dry-run-output kan flage dem eksplicit).
 */
export function rankTeamsGlobally({ teams, standings, countback }) {
  const byTeamId = new Map();
  for (const s of standings || []) {
    if (s?.team_id != null) byTeamId.set(s.team_id, s);
  }
  const rows = (teams || []).map((team) => {
    const s = byTeamId.get(team.id) || null;
    const cb = countback instanceof Map ? countback.get(team.id) : countback?.[team.id];
    return {
      teamId: team.id,
      name: team.name ?? "",
      totalPoints: Math.max(0, Number(s?.total_points) || 0),
      gcWins: Math.max(0, Number(s?.gc_wins) || 0),
      stageWins: Math.max(0, Number(s?.stage_wins) || 0),
      classificationWins: Math.max(0, Number(cb?.classificationWins) || 0),
      stagePodiums: Math.max(0, Number(cb?.stagePodiums) || 0),
      bestStageRank: Number.isFinite(cb?.bestStageRank) ? cb.bestStageRank : NO_COUNTBACK_RANK,
      bestGcRank: Number.isFinite(cb?.bestGcRank) ? cb.bestGcRank : NO_COUNTBACK_RANK,
      fromTier: team.division ?? null,
      fromPoolId: team.league_division_id ?? null,
      missingStanding: !s,
    };
  });
  rows.sort((a, b) =>
    (b.totalPoints - a.totalPoints)
    || (b.gcWins - a.gcWins)
    || (b.stageWins - a.stageWins)
    || (b.classificationWins - a.classificationWins)
    || (b.stagePodiums - a.stagePodiums)
    || (a.bestStageRank - b.bestStageRank)
    || (a.bestGcRank - b.bestGcRank)
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
  if (!P) throw new Error("snakeAssign: at least one pool required");
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
  if (d2Pools.length !== 2) throw new Error(`distributeCompression: expected 2 tier 2 pools, found ${d2Pools.length}`);
  if (d3Pools.length !== 4) throw new Error(`distributeCompression: expected 4 tier 3 pools, found ${d3Pools.length}`);
  if (d4Pools.length < 1) throw new Error("distributeCompression: no tier 4 pools for remainder distribution");
  if (d2Capacity % d2Pools.length !== 0) throw new Error(`d2Capacity ${d2Capacity} does not divide evenly across ${d2Pools.length} pools`);
  if (d3Capacity % d3Pools.length !== 0) throw new Error(`d3Capacity ${d3Capacity} does not divide evenly across ${d3Pools.length} pools`);

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
