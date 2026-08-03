import { test } from "node:test";
import assert from "node:assert/strict";

import {
  median,
  teamStrength,
  poolStrengthStats,
  poolDominanceMargins,
  tierImbalanceIndex,
  planTierReseed,
  evaluateTierBalance,
  DEFAULT_RESEED_THRESHOLD,
  TEAM_STRENGTH_TOP_N,
} from "./poolBalance.js";

// ── median / teamStrength ────────────────────────────────────────────────────

test("median: null for tom, midterste for ulige, gennemsnit for lige", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("median: muterer ikke input", () => {
  const xs = [3, 1, 2];
  median(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});

test("teamStrength: gennemsnit af de topN bedste ryttere", () => {
  // top 5 af [90,80,70,60,50,10,10] = 90,80,70,60,50 → 70
  assert.equal(teamStrength([50, 10, 90, 60, 10, 80, 70]), 70);
});

test("teamStrength: tom trup = 0, kortere trup end topN bruger det den har", () => {
  assert.equal(teamStrength([]), 0);
  assert.equal(teamStrength([40, 20]), 30);
});

test("teamStrength: topN kan overstyres", () => {
  assert.equal(teamStrength([100, 50, 0], { topN: 1 }), 100);
  assert.equal(TEAM_STRENGTH_TOP_N, 5);
});

// ── poolStrengthStats ────────────────────────────────────────────────────────

test("poolStrengthStats: aggregerer pr. pulje og beregner topRatio", () => {
  const stats = poolStrengthStats([
    { teamId: "a", poolId: 1, strength: 60 },
    { teamId: "b", poolId: 1, strength: 30 },
    { teamId: "c", poolId: 1, strength: 30 },
    { teamId: "d", poolId: 2, strength: 40 },
    { teamId: "e", poolId: 2, strength: 40 },
  ]);
  assert.equal(stats.length, 2);
  const [p1, p2] = stats;
  assert.equal(p1.poolId, 1);
  assert.equal(p1.teamCount, 3);
  assert.equal(p1.total, 120);
  assert.equal(p1.medianStrength, 30);
  assert.equal(p1.top, 60);
  assert.equal(p1.topRatio, 2); // runaway-pulje
  assert.equal(p2.topRatio, 1); // fladt
});

test("poolStrengthStats: hold uden pulje ignoreres", () => {
  const stats = poolStrengthStats([
    { teamId: "a", poolId: null, strength: 99 },
    { teamId: "b", poolId: 1, strength: 10 },
  ]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].poolId, 1);
});

test("poolStrengthStats: tom input giver tom liste", () => {
  assert.deepEqual(poolStrengthStats([]), []);
});

// ── poolDominanceMargins ─────────────────────────────────────────────────────

// Hjælper: en pulje med `n` middelmådige hold à 6 ryttere på styrke `peak`.
function filler(poolId, n, peak, prefix = "f") {
  return Array.from({ length: n }, (_, i) => ({
    teamId: `${prefix}${poolId}-${i}`,
    poolId,
    riderPeaks: Array(6).fill(peak),
  }));
}

test("poolDominanceMargins: positiv margin når ét hold stakker over rivalerne", () => {
  const teams = [
    // 4.-bedste = 52, rivalernes 10.-bedste = 38 → margin +14 (Wander Riders-casen)
    { teamId: "stacker", poolId: 7, riderPeaks: [60, 56, 54, 52, 40, 30] },
    ...filler(7, 5, 38),
  ];
  const margins = poolDominanceMargins(teams);
  assert.equal(margins.length, 1);
  assert.equal(margins[0].poolId, 7);
  assert.equal(margins[0].teamId, "stacker");
  assert.equal(margins[0].margin, 14);
  assert.equal(margins[0].stackDepthPeak, 52);
  assert.equal(margins[0].rivalPeak, 38);
});

test("poolDominanceMargins: negativ margin i en flad pulje", () => {
  const margins = poolDominanceMargins(filler(2, 6, 50));
  assert.equal(margins.length, 1);
  assert.equal(margins[0].margin, 0); // alle lige stærke
});

test("poolDominanceMargins: hold med færre end stackDepth ryttere kan ikke stakke", () => {
  const teams = [
    { teamId: "tiny", poolId: 3, riderPeaks: [99, 99, 99] }, // kun 3 ryttere
    ...filler(3, 5, 10),
  ];
  const margins = poolDominanceMargins(teams);
  // 'tiny' springes over; fillerne er alle lige → margin 0, ikke 89
  assert.equal(margins[0].margin, 0);
  assert.notEqual(margins[0].teamId, "tiny");
});

test("poolDominanceMargins: for lille pulje (færre end rivalRank rivaler) måles ikke", () => {
  const teams = [
    { teamId: "a", poolId: 4, riderPeaks: [50, 50, 50, 50, 50, 50] },
    { teamId: "b", poolId: 4, riderPeaks: [10, 10, 10] }, // kun 3 rival-ryttere
  ];
  assert.deepEqual(poolDominanceMargins(teams), []);
});

test("poolDominanceMargins: rangerer puljer efter værste margin", () => {
  const teams = [
    { teamId: "mild", poolId: 1, riderPeaks: [40, 40, 40, 40, 20, 20] },
    ...filler(1, 5, 36, "m"),
    { teamId: "severe", poolId: 2, riderPeaks: [60, 58, 56, 54, 20, 20] },
    ...filler(2, 5, 34, "s"),
  ];
  const margins = poolDominanceMargins(teams);
  assert.equal(margins[0].poolId, 2); // margin 54-34 = 20
  assert.equal(margins[0].margin, 20);
  assert.equal(margins[1].poolId, 1); // margin 40-36 = 4
  assert.equal(margins[1].margin, 4);
});

// ── tierImbalanceIndex ───────────────────────────────────────────────────────

test("tierImbalanceIndex: bruger MAKSIMUM, så én runaway-pulje ikke fortyndes væk", () => {
  const teams = [
    { teamId: "severe", poolId: 2, riderPeaks: [60, 58, 56, 54, 20, 20] },
    ...filler(2, 5, 34, "s"),
    ...filler(3, 6, 30, "flat3"),
    ...filler(4, 6, 30, "flat4"),
    ...filler(5, 6, 30, "flat5"),
  ];
  const { index, worstPoolId, worstTeamId } = tierImbalanceIndex(teams);
  assert.equal(index, 20);
  assert.equal(worstPoolId, 2);
  assert.equal(worstTeamId, "severe");
});

test("tierImbalanceIndex: tom input giver indeks 0 uden at kaste", () => {
  const r = tierImbalanceIndex([]);
  assert.equal(r.index, 0);
  assert.equal(r.worstPoolId, null);
});

// ── planTierReseed ───────────────────────────────────────────────────────────

test("planTierReseed: snake-fordeler stærkeste hold over puljerne", () => {
  const teams = [
    { teamId: "t1", poolId: 1, strength: 100 },
    { teamId: "t2", poolId: 1, strength: 90 },
    { teamId: "t3", poolId: 1, strength: 80 },
    { teamId: "t4", poolId: 1, strength: 70 },
  ];
  const { assignments } = planTierReseed({ teams, poolIds: [1, 2] });
  const to = Object.fromEntries(assignments.map((a) => [a.teamId, a.toPoolId]));
  // snake over 2 puljer: række 0 → 1,2 · række 1 → 2,1
  assert.equal(to.t1, 1);
  assert.equal(to.t2, 2);
  assert.equal(to.t3, 2);
  assert.equal(to.t4, 1);
});

test("planTierReseed: udligner en runaway-pulje (after er fladere end before)", () => {
  // Alle fire top-seeds sad i pulje 1; resten er middelmådige.
  const teams = [
    ...[100, 95, 90, 85].map((s, i) => ({ teamId: `top${i}`, poolId: 1, strength: s })),
    ...[30, 30, 30, 30].map((s, i) => ({ teamId: `mid${i}`, poolId: 2, strength: s })),
  ];
  const { before, after } = planTierReseed({ teams, poolIds: [1, 2] });
  const beforeSpread = Math.abs(before[0].total - before[1].total);
  const afterSpread = Math.abs(after[0].total - after[1].total);
  assert.ok(beforeSpread > afterSpread, `forventede udligning, fik ${beforeSpread} → ${afterSpread}`);
  assert.equal(afterSpread, 0);
});

test("planTierReseed: moves indeholder KUN hold der faktisk skifter pulje", () => {
  const teams = [
    { teamId: "a", poolId: 1, strength: 100 },
    { teamId: "b", poolId: 2, strength: 90 },
  ];
  const { moves, assignments } = planTierReseed({ teams, poolIds: [1, 2] });
  assert.equal(assignments.length, 2);
  assert.equal(moves.length, 0); // begge sidder allerede rigtigt
});

test("planTierReseed: deterministisk ved ens styrke (tiebreak på teamId)", () => {
  const teams = [
    { teamId: "zeta", poolId: 1, strength: 50 },
    { teamId: "alpha", poolId: 2, strength: 50 },
  ];
  const first = planTierReseed({ teams, poolIds: [1, 2] }).assignments;
  const second = planTierReseed({ teams: [...teams].reverse(), poolIds: [1, 2] }).assignments;
  assert.deepEqual(first, second);
  assert.equal(first[0].teamId, "alpha"); // laveste teamId først ved ens styrke
});

test("planTierReseed: muterer ikke input-arrayet", () => {
  const teams = [
    { teamId: "a", poolId: 1, strength: 10 },
    { teamId: "b", poolId: 2, strength: 90 },
  ];
  planTierReseed({ teams, poolIds: [1, 2] });
  assert.equal(teams[0].teamId, "a");
  assert.equal(teams[0].poolId, 1);
});

test("planTierReseed: kaster uden puljer", () => {
  assert.throws(() => planTierReseed({ teams: [], poolIds: [] }), /at least one pool/);
});

// ── evaluateTierBalance ──────────────────────────────────────────────────────

test("evaluateTierBalance: under tærskel → ingen plan (intet aktiveres)", () => {
  const teams = filler(1, 6, 30).concat(filler(2, 6, 30));
  const r = evaluateTierBalance({ teams, poolIds: [1, 2] });
  assert.equal(r.needsReseed, false);
  assert.equal(r.plan, null);
  assert.equal(r.threshold, DEFAULT_RESEED_THRESHOLD);
});

test("evaluateTierBalance: over tærskel → plan med moves", () => {
  const teams = [
    { teamId: "stacker", poolId: 1, strength: 55, riderPeaks: [60, 56, 54, 52, 40, 30] },
    ...filler(1, 5, 38).map((t) => ({ ...t, strength: 38 })),
    ...filler(2, 6, 38, "p2").map((t) => ({ ...t, strength: 38 })),
  ];
  const r = evaluateTierBalance({ teams, poolIds: [1, 2] });
  assert.equal(r.needsReseed, true); // margin 52-38 = 14 > 10
  assert.equal(r.imbalance.index, 14);
  assert.ok(r.plan.moves.length > 0);
});

test("evaluateTierBalance: tærskel kan overstyres", () => {
  const teams = [
    { teamId: "stacker", poolId: 1, strength: 55, riderPeaks: [60, 56, 54, 52, 40, 30] },
    ...filler(1, 5, 38).map((t) => ({ ...t, strength: 38 })),
  ];
  assert.equal(evaluateTierBalance({ teams, poolIds: [1], threshold: 100 }).needsReseed, false);
  assert.equal(evaluateTierBalance({ teams, poolIds: [1], threshold: 1 }).needsReseed, true);
});
