// #5641 · A1 (delissue af #4592, ejer-beslutning 24/9): sammenlægning D4 → D3
// ved sæsonskiftet S3→S4.
//
// Ejer-beslutning 24/9 kl. ca. 10:20 (#4592-kommentar): "Ved skiftet S3→S4
// rykker alle nuværende D4-managers op i D3, fordelt efter point (snake, som
// komprimeringen S1→S2); D3 får ca. 17 managers pr. pulje." D4 selv går fra 8
// til 4 puljer og fyldes med AI fra dag ét (spor A2, IKKE denne fil).
//
// RENT MODUL — ingen I/O (samme disciplin som pyramidCompression.js, ejer-
// gate-krav 25/7: "ren fordelings-funktion unit-testet"). DB-læsning/-skrivning
// bor i scripts/mergeD4IntoD3S4.js.
//
// Genbruger rankTeamsGlobally (samme S3-point-rangering som S1→S2-
// komprimeringen brugte for S1) og snakeAssign fra pyramidCompression.js.
// IKKE distributeCompression: den fylder altid D2 med et fast tal fra toppen
// af HELE feltet og kan ikke nøjes med at flytte D3+D4 ind i D3 alene.
//
// Input-filter (udført HER, ikke i scriptet, så filtreringen er dækket af
// samme unit-tests som fordelingen):
//   !is_ai && !is_bank && !is_frozen && !is_test_account && parked_at == null
//   && division i (3, 4)
// `parked_at`-leddet er NYT ift. de to eksisterende komprimerings-scripts
// (compressPyramid.js:109, compressPyramidS3.js:287-om mangler begge det) —
// uden det ville et parkeret hold blive hentet tilbage ind i D3 af denne
// sammenlægning, selvom det kun må hentes tilbage via comeback-flowet (spor A4).

import { rankTeamsGlobally, snakeAssign } from "./pyramidCompression.js";

/** 4 D3-puljer × POOL_TARGET_SIZE (economyConstants.js) = det absolutte loft
 *  for hvor mange menneskehold sammenlægningen kan modtage. */
export const MAX_MERGE_MANAGERS = 96;

/**
 * Er holdet i sammenlægningens målgruppe (D3+D4, ikke AI/bank/frosset/test,
 * ikke parkeret)? Eksporteret separat så scriptets prognose-output og
 * unit-tests deler PRÆCIS samme dom som selve planlægningen.
 *
 * @param {{is_ai?:boolean, is_bank?:boolean, is_frozen?:boolean,
 *   is_test_account?:boolean, parked_at?:string|null, division?:number|null}} team
 * @returns {boolean}
 */
export function isD4MergeEligible(team) {
  if (!team) return false;
  if (team.is_ai === true || team.is_bank === true) return false;
  if (team.is_frozen === true || team.is_test_account === true) return false;
  if (team.parked_at != null) return false;
  return team.division === 3 || team.division === 4;
}

/**
 * Planlæg sammenlægningen af D3+D4's tilbageværende managerhold ind i D3's
 * fire puljer, snake-fordelt efter S3-point (rankTeamsGlobally).
 *
 * IDEMPOTENT: et hold der allerede står i sin beregnede mål-pulje får
 * `movement: "unchanged"` — scriptets apply-trin springer disse over (ingen
 * UPDATE), så en gentaget kørsel på samme frosne snapshot giver 0 writes.
 *
 * @param {Object} args
 * @param {Array<{id, name, division, league_division_id, is_ai?, is_bank?,
 *   is_frozen?, is_test_account?, parked_at?}>} args.teams  ALLE hold —
 *   filtreres internt til D3+D4-managerhold (se isD4MergeEligible). Sender
 *   kalderen kun allerede-filtrerede rækker, er dette et no-op-filter.
 * @param {Array<{team_id, total_points, gc_wins, stage_wins}>} args.standings
 *   season_standings for den AFSLUTTEDE S3-sæson.
 * @param {Map|Object} [args.countback]  #3036-countback, se rankTeamsGlobally.
 * @param {Array<{id, tier, pool_index}>} args.d3Pools  De FIRE D3-puljer
 *   (tier 3). Kastes hvis der ikke er præcis 4.
 * @returns {{ assignments: Array<{teamId, name, rank, totalPoints, fromTier,
 *   fromPoolId, toPoolId, movement: "promoted"|"pool-move"|"unchanged"}>,
 *   byPool: Map<string, number> }}
 * @throws {Error} 'd3Pools skal have præcis 4 puljer' | 'for mange managerhold'
 */
export function planD4Merge({ teams, standings, countback, d3Pools }) {
  const pools = [...(d3Pools || [])].sort((a, b) => a.pool_index - b.pool_index);
  if (pools.length !== 4) {
    throw new Error(`planD4Merge: forventede 4 D3-puljer, fandt ${pools.length}`);
  }

  const eligible = (teams || []).filter(isD4MergeEligible);
  if (eligible.length > MAX_MERGE_MANAGERS) {
    throw new Error(
      `planD4Merge: ${eligible.length} managerhold > ${MAX_MERGE_MANAGERS} (4 D3-puljer × 24) — afviser, undersøg datagrundlaget før sammenlægning.`,
    );
  }

  const ranked = rankTeamsGlobally({ teams: eligible, standings, countback });

  const assignments = snakeAssign(ranked, pools).map(({ item, pool }) => {
    const movement = item.fromPoolId === pool.id
      ? "unchanged"
      : (item.fromTier === 4 ? "promoted" : "pool-move");
    return {
      teamId: item.teamId,
      name: item.name,
      rank: item.rank,
      totalPoints: item.totalPoints,
      fromTier: item.fromTier,
      fromPoolId: item.fromPoolId,
      toPoolId: pool.id,
      movement,
    };
  });

  const byPool = new Map();
  for (const a of assignments) byPool.set(a.toPoolId, (byPool.get(a.toPoolId) || 0) + 1);

  return { assignments, byPool };
}
