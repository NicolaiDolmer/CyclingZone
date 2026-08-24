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
 * #3901 · S2→S3-variant af rankTeamsGlobally: rangerer efter den SYNLIGE
 * globale rangliste (global_rank_mv, cyclingzone.org/standings?tab=global)
 * i stedet for den afsluttede sæsons season_standings.total_points. Ejer-
 * beslutning 18/8 (KS3, #3901): "Rangliste = den synlige globale rangliste
 * ... så dry-run matcher det spillerne ser."
 *
 * global_rank_mv er allerede den kanoniske menneske-diskriminator
 * (is_ai/is_bank/is_frozen/is_test_account, #2792) og rangerer med Postgres
 * RANK() på global_points DESC — INGEN tiebreak ud over det (ties deler rang).
 * Til pulje-FORDELING skal hvert hold have en unik plads, så vi lægger #3036-
 * countback-kæden (samme led som rankTeamsGlobally) OVENPÅ global_points som
 * en deterministisk sekundær sortering — den ÆNDRER ikke hvad spillerne ser
 * (global_rank/visibleGlobalRank bevares uændret i output), den afgør kun
 * rækkefølgen NÅR to hold reelt er lige på global_points.
 *
 * @param {Array<{id, name, division, league_division_id}>} teams  Managerhold
 *        (caller filtrerer med den fulde menneske-diskriminator).
 * @param {Array<{team_id, global_points, global_rank, active_recent}>} globalRankRows
 *        Rækker fra global_rank_mv (samme forespørgsel som useGlobalRank.js).
 * @param {Map|Object} [countback]  Se rankTeamsGlobally.
 * @returns {Array} Samme rank-form som rankTeamsGlobally, plus:
 *        { globalPoints, visibleGlobalRank, activeRecent, missingGlobalRank }.
 *        Hold uden global_rank_mv-række (ikke muligt i dag — mv dækker alle
 *        menneskehold, aktive eller ej — men fail-safe) rangeres som 0 point,
 *        nederst, flaget missingGlobalRank, ligesom missingStanding ovenfor.
 *        Inaktive hold (active_recent=false, skjult i UI'et) BEHOLDES i
 *        fordelingen — komprimeringen skal placere ALLE managerhold et sted i
 *        pyramiden; UI'ets "skjul inaktive" er kun en visnings-filtrering.
 */
export function rankTeamsByGlobalRank({ teams, globalRankRows, countback }) {
  const byTeamId = new Map();
  for (const g of globalRankRows || []) {
    if (g?.team_id != null) byTeamId.set(g.team_id, g);
  }
  const rows = (teams || []).map((team) => {
    const g = byTeamId.get(team.id) || null;
    const cb = countback instanceof Map ? countback.get(team.id) : countback?.[team.id];
    return {
      teamId: team.id,
      name: team.name ?? "",
      globalPoints: Math.max(0, Number(g?.global_points) || 0),
      visibleGlobalRank: Number.isFinite(g?.global_rank) ? g.global_rank : null,
      activeRecent: !!g?.active_recent,
      classificationWins: Math.max(0, Number(cb?.classificationWins) || 0),
      stagePodiums: Math.max(0, Number(cb?.stagePodiums) || 0),
      bestStageRank: Number.isFinite(cb?.bestStageRank) ? cb.bestStageRank : NO_COUNTBACK_RANK,
      bestGcRank: Number.isFinite(cb?.bestGcRank) ? cb.bestGcRank : NO_COUNTBACK_RANK,
      fromTier: team.division ?? null,
      fromPoolId: team.league_division_id ?? null,
      missingGlobalRank: !g,
    };
  });
  rows.sort((a, b) =>
    (b.globalPoints - a.globalPoints)
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
 *   rank 1..d1Capacity            → den ENE tier 1-pulje (KUN når d1Capacity
 *                                   > 0 — se #3901 nedenfor; default 0 = D1
 *                                   røres IKKE, S1→S2-scriptets historiske
 *                                   adfærd er 100% uændret).
 *   næste d2Capacity              → tier 2-puljer (snake)
 *   næste d3Capacity              → tier 3-puljer (snake)
 *   resten                        → ALLE tier 4-puljer (pool_index-orden,
 *                                   snake). #4172 (ejer-krav 24/8): S3 blev
 *                                   startet med defaulten 2, så alle 48 D4-hold
 *                                   landede i pulje A+B mens C-H stod tomme med
 *                                   156 uafviklelige løb. Defaulten er nu
 *                                   ANTALLET af D4-puljer. `d4PoolCount` kan
 *                                   stadig sættes eksplicit (fx 2 for at
 *                                   reproducere S1→S2's historiske fordeling).
 *
 * #3901 (S2→S3, ejer-låst 18/8): d1Capacity=24 inkluderer Division 1 i
 * komprimeringen for FØRSTE gang — top 24 (nu rangeret via
 * rankTeamsByGlobalRank, se ovenfor) flytter til D1's ene pulje; de
 * AI-hold der sad der viger (reconcileAiTeamsForPool efterregulerer til
 * POOL_TARGET_SIZE, uændret mekanik). d1Capacity default 0 bevarer S1→S2-
 * scriptets (compressPyramid.js) eksisterende, testede adfærd bit-for-bit.
 *
 * @param {Array} rankedTeams  output fra rankTeamsGlobally ELLER
 *        rankTeamsByGlobalRank (rank-orden).
 * @param {Array<{id, tier, pool_index}>} pools  league_divisions-rækker.
 * @param {number} [d1Capacity=0]  >0 aktiverer D1-segmentet (#3901).
 * @param {number} [d4PoolCount]  antal tier 4-puljer resten fordeles over.
 *        Udelades den, bruges ALLE tier 4-puljer (#4172).
 * @returns {{ assignments, byPool }} assignments =
 *   { teamId, name, rank, totalPoints, fromTier, fromPoolId, toTier, toPoolId,
 *     movement: 'promoted'|'relegated'|'unchanged'|'pool-move' }.
 *
 * Kaster ved strukturbrud (forkert antal tier 1/2/3-puljer, kapacitet der
 * ikke går op i puljerne) — fordelingen må aldrig gætte sig gennem en skæv
 * pyramide.
 */
export function distributeCompression(rankedTeams, pools, {
  d1Capacity = 0,
  d2Capacity = 48,
  d3Capacity = 96,
  d4PoolCount = null,
} = {}) {
  const byTier = new Map();
  for (const p of pools || []) {
    if (!byTier.has(p.tier)) byTier.set(p.tier, []);
    byTier.get(p.tier).push(p);
  }
  for (const list of byTier.values()) list.sort((a, b) => a.pool_index - b.pool_index);

  const d1Pools = byTier.get(1) || [];
  const d2Pools = byTier.get(2) || [];
  const d3Pools = byTier.get(3) || [];
  // #4172: default = ALLE D4-puljer. Et eksplicit tal skærer stadig fra toppen.
  const allD4Pools = byTier.get(4) || [];
  const d4Pools = d4PoolCount == null ? allD4Pools : allD4Pools.slice(0, d4PoolCount);
  if (d1Capacity > 0 && d1Pools.length !== 1) throw new Error(`distributeCompression: expected 1 tier 1 pool when d1Capacity is set, found ${d1Pools.length}`);
  if (d2Pools.length !== 2) throw new Error(`distributeCompression: expected 2 tier 2 pools, found ${d2Pools.length}`);
  if (d3Pools.length !== 4) throw new Error(`distributeCompression: expected 4 tier 3 pools, found ${d3Pools.length}`);
  if (d4Pools.length < 1) throw new Error("distributeCompression: no tier 4 pools for remainder distribution");
  if (d2Capacity % d2Pools.length !== 0) throw new Error(`d2Capacity ${d2Capacity} does not divide evenly across ${d2Pools.length} pools`);
  if (d3Capacity % d3Pools.length !== 0) throw new Error(`d3Capacity ${d3Capacity} does not divide evenly across ${d3Pools.length} pools`);

  const ranked = [...(rankedTeams || [])];
  const d2Start = d1Capacity > 0 ? d1Capacity : 0;
  const segments = [];
  if (d1Capacity > 0) segments.push({ teams: ranked.slice(0, d1Capacity), pools: d1Pools, tier: 1 });
  segments.push({ teams: ranked.slice(d2Start, d2Start + d2Capacity), pools: d2Pools, tier: 2 });
  segments.push({ teams: ranked.slice(d2Start + d2Capacity, d2Start + d2Capacity + d3Capacity), pools: d3Pools, tier: 3 });
  segments.push({ teams: ranked.slice(d2Start + d2Capacity + d3Capacity), pools: d4Pools, tier: 4 });

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
