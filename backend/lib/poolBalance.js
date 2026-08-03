// Pulje-styrke-balance (#2557 / #2574) — måling af hvor skævt stærke hold er
// fordelt over puljerne i ÉN tier, plus en snake-reseed-PLAN der udligner det.
//
// 100% REN lib: intet I/O, ingen supabase-imports — kun plain data ind/ud (samme
// kontrakt som raceDominanceMetrics.js / balanceDriftMetrics.js / pyramidCompression.js).
// Al DB-læsning bor i scripts/auditPoolBalance.js.
//
// BAGGRUND (docs/audits/2026-08-03-team-dominance-2557.md): pulje-tildelingen i
// economyEngine.processDivisionEnd er styrke-BLIND — destinationspuljen er en ren
// funktion af pool_index-træet (oprykning) hhv. round-robin (nedrykning). Derfor
// kan én tier ende med puljer hvis MEDIANER er identiske mens TOPPEN er vidt
// forskellig. Målt 3/8 i tier 3: samlet puljestyrke 636-689 (næsten ens), men
// stærkeste hold 43,6 / 53,0 / 45,2 / 57,8. De tre puljer med de høje toppe stod
// for 72% af alle share4PlusSameTeamTop10-brud i spillet.
//
// Nøgle-indsigten bag `dominanceMargin`: share4PlusSameTeamTop10 brydes præcis når
// ét holds 4.-bedste rytter er stærkere end puljens 10.-bedste RIVAL — så kan
// motorens støj ikke længere skabe variation i top 10. Marginen er derfor den
// direkte strukturelle prædiktor, ikke gennemsnitsstyrken.
//
// INGEN af funktionerne her muterer noget. `planTierReseed` returnerer en PLAN;
// at udføre den er en separat, ejer-gated beslutning (se auditPoolBalance.js).

import { snakeAssign } from "./pyramidCompression.js";

/** Antal ryttere der tæller i et holds styrke-mål. Et hold stiller 6-8 ryttere
 *  pr. etape (raceAutopick), så toppen af truppen er det der afgør top-10. */
export const TEAM_STRENGTH_TOP_N = 5;

/** Et holds 4.-bedste rytter mod puljens 10.-bedste rival — se modul-headeren. */
export const DOMINANCE_STACK_DEPTH = 4;
export const DOMINANCE_RIVAL_RANK = 10;

/**
 * Median af et talarray. Sorterer internt, ændrer ikke input.
 * @param {number[]} xs
 * @returns {number|null} null hvis tom
 */
export function median(xs = []) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Et holds styrke = gennemsnit af dets `topN` bedste rytter-peaks.
 *
 * @param {number[]} riderPeaks  pr. rytter: max over discipliner (flat/climbing/
 *   sprint/time_trial/punch/cobblestone) fra rider_derived_abilities.
 * @param {{topN?:number}} [opts]
 * @returns {number} 0 for en tom trup (et hold uden ryttere er ikke stærkt)
 */
export function teamStrength(riderPeaks = [], { topN = TEAM_STRENGTH_TOP_N } = {}) {
  if (riderPeaks.length === 0) return 0;
  const top = [...riderPeaks].sort((a, b) => b - a).slice(0, topN);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/**
 * Styrke-nøgletal pr. pulje for ÉN tier.
 *
 * @param {Array<{teamId:string, poolId:number, strength:number}>} teams
 * @returns {Array<{poolId:number, teamCount:number, total:number, mean:number,
 *   medianStrength:number, top:number, topRatio:number}>} sorteret på poolId.
 *   topRatio = top / median (1 = fladt, 2 = det bedste hold er dobbelt så stærkt
 *   som puljens median). null-median ⇒ topRatio 0.
 */
export function poolStrengthStats(teams = []) {
  const byPool = new Map();
  for (const t of teams) {
    if (t?.poolId == null) continue; // hold uden pulje hører ikke til en tier
    if (!byPool.has(t.poolId)) byPool.set(t.poolId, []);
    byPool.get(t.poolId).push(Number(t.strength) || 0);
  }

  const out = [];
  for (const [poolId, strengths] of byPool) {
    const total = strengths.reduce((a, b) => a + b, 0);
    const med = median(strengths);
    const top = strengths.length ? Math.max(...strengths) : 0;
    out.push({
      poolId,
      teamCount: strengths.length,
      total,
      mean: strengths.length ? total / strengths.length : 0,
      medianStrength: med ?? 0,
      top,
      topRatio: med ? top / med : 0,
    });
  }
  return out.sort((a, b) => a.poolId - b.poolId);
}

/**
 * Den strukturelle dominans-margin pr. pulje: hvor meget stærkere det mest
 * stakkede holds `DOMINANCE_STACK_DEPTH`.-bedste rytter er end puljens
 * `DOMINANCE_RIVAL_RANK`.-bedste rytter fra ET ANDET hold.
 *
 * Positiv margin ⇒ holdet kan fylde top 10 uanset dagsform/støj. Empirisk 3/8:
 * margin +14/+11 gav share4Plus 0,571/0,357; margin ≤0 gav 0,000.
 *
 * @param {Array<{teamId:string, poolId:number, riderPeaks:number[]}>} teams
 * @returns {Array<{poolId:number, teamId:string|null, margin:number,
 *   stackDepthPeak:number, rivalPeak:number}>} én række pr. pulje (værste hold),
 *   sorteret på margin faldende.
 */
export function poolDominanceMargins(teams = [], {
  stackDepth = DOMINANCE_STACK_DEPTH,
  rivalRank = DOMINANCE_RIVAL_RANK,
} = {}) {
  const byPool = new Map();
  for (const t of teams) {
    if (t?.poolId == null) continue;
    if (!byPool.has(t.poolId)) byPool.set(t.poolId, []);
    byPool.get(t.poolId).push(t);
  }

  const out = [];
  for (const [poolId, poolTeams] of byPool) {
    let best = { poolId, teamId: null, margin: -Infinity, stackDepthPeak: 0, rivalPeak: 0 };
    for (const team of poolTeams) {
      const own = [...(team.riderPeaks || [])].sort((a, b) => b - a);
      if (own.length < stackDepth) continue; // kan ikke stakke 4 hvis truppen er mindre
      const rivals = poolTeams
        .filter((o) => o.teamId !== team.teamId)
        .flatMap((o) => o.riderPeaks || [])
        .sort((a, b) => b - a);
      if (rivals.length < rivalRank) continue; // for lille pulje til at måle meningsfuldt
      const margin = own[stackDepth - 1] - rivals[rivalRank - 1];
      if (margin > best.margin) {
        best = {
          poolId,
          teamId: team.teamId,
          margin,
          stackDepthPeak: own[stackDepth - 1],
          rivalPeak: rivals[rivalRank - 1],
        };
      }
    }
    if (Number.isFinite(best.margin)) out.push(best);
  }
  return out.sort((a, b) => b.margin - a.margin);
}

/**
 * Ét tal for hvor skæv en tier er: den STØRSTE dominans-margin blandt tierens
 * puljer. Vi bruger maksimum (ikke gennemsnit) fordi én runaway-pulje er præcis
 * det problem metrikken skal fange — et gennemsnit ville fortynde den væk, som
 * det aggregerede drift-scorecard gjorde i 3 uger (#2557).
 *
 * @param {Array<{teamId:string, poolId:number, riderPeaks:number[]}>} teams
 * @returns {{index:number, worstPoolId:number|null, worstTeamId:string|null,
 *   margins:ReturnType<typeof poolDominanceMargins>}}
 */
export function tierImbalanceIndex(teams = [], opts = {}) {
  const margins = poolDominanceMargins(teams, opts);
  const worst = margins[0] ?? null;
  return {
    index: worst ? worst.margin : 0,
    worstPoolId: worst ? worst.poolId : null,
    worstTeamId: worst ? worst.teamId : null,
    margins,
  };
}

/**
 * Snake-reseed-PLAN for én tier: fordel tierens hold styrke-sorteret
 * (stærkeste først) boustrofedon over tierens puljer, så ingen pulje støvsuger
 * top-seeds. Genbruger den allerede-testede `snakeAssign` fra
 * pyramidCompression.js — samme fordelings-regel som S1→S2-komprimeringen brugte,
 * bare anvendt inden for ÉN tier i stedet for over hele pyramiden.
 *
 * Deterministisk: lige styrker brydes på teamId (String-compare), så to kørsler
 * på samme data giver samme plan.
 *
 * MUTERER INTET — returnerer kun hvilke hold der VILLE flytte.
 *
 * @param {object} args
 * @param {Array<{teamId:string, poolId:number, strength:number, riderPeaks?:number[]}>} args.teams
 * @param {number[]} args.poolIds  tierens puljer (rækkefølgen bestemmer snake-retningen)
 * @returns {{moves:Array<{teamId:string, fromPoolId:number, toPoolId:number}>,
 *   assignments:Array<{teamId:string, fromPoolId:number, toPoolId:number}>,
 *   before:ReturnType<typeof poolStrengthStats>, after:ReturnType<typeof poolStrengthStats>}}
 */
export function planTierReseed({ teams = [], poolIds = [] } = {}) {
  if (poolIds.length === 0) throw new Error("planTierReseed: at least one pool required");

  const ordered = [...teams].sort(
    (a, b) => (Number(b.strength) || 0) - (Number(a.strength) || 0)
      || String(a.teamId).localeCompare(String(b.teamId), "en"),
  );

  const assignments = snakeAssign(ordered, poolIds).map(({ item, pool }) => ({
    teamId: item.teamId,
    fromPoolId: item.poolId ?? null,
    toPoolId: pool,
  }));

  const strengthById = new Map(teams.map((t) => [t.teamId, Number(t.strength) || 0]));
  const peaksById = new Map(teams.map((t) => [t.teamId, t.riderPeaks || []]));

  return {
    moves: assignments.filter((a) => a.fromPoolId !== a.toPoolId),
    assignments,
    before: poolStrengthStats(teams),
    after: poolStrengthStats(
      assignments.map((a) => ({
        teamId: a.teamId,
        poolId: a.toPoolId,
        strength: strengthById.get(a.teamId) ?? 0,
        riderPeaks: peaksById.get(a.teamId) ?? [],
      })),
    ),
  };
}

/**
 * Tærskel-varianten (anbefalingen i docs/audits/2026-08-03-team-dominance-2557.md):
 * re-seed KUN en tier hvis dens skævheds-indeks overstiger `threshold`, så
 * velfungerende puljers identitet ikke nulstilles hvert år uden grund.
 *
 * Default-tærsklen 10 er sat MELLEM de målte regimer 3/8 (margin ≤7 ⇒ share4Plus
 * 0,000; margin ≥11 ⇒ 0,357-0,571) — den er IKKE harness-verificeret endnu og
 * skal simuleres før den bruges til noget (simulér-før-ship, fast politik).
 *
 * @param {object} args
 * @param {Array<{teamId:string, poolId:number, strength:number, riderPeaks?:number[]}>} args.teams
 * @param {number[]} args.poolIds
 * @param {number} [args.threshold]
 * @returns {{needsReseed:boolean, imbalance:ReturnType<typeof tierImbalanceIndex>,
 *   plan:ReturnType<typeof planTierReseed>|null, threshold:number}}
 */
export const DEFAULT_RESEED_THRESHOLD = 10;

export function evaluateTierBalance({ teams = [], poolIds = [], threshold = DEFAULT_RESEED_THRESHOLD } = {}) {
  const imbalance = tierImbalanceIndex(teams);
  const needsReseed = imbalance.index > threshold;
  return {
    needsReseed,
    imbalance,
    threshold,
    plan: needsReseed && poolIds.length ? planTierReseed({ teams, poolIds }) : null,
  };
}
