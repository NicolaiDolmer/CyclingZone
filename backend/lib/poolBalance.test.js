import { test } from "node:test";
import assert from "node:assert/strict";

import {
  median,
  teamStrength,
  poolStrengthStats,
  poolDominanceMargins,
  poolTotalsSpread,
  tierImbalanceIndex,
  planTierReseed,
  planRealTeamReseed,
  evaluateTierBalance,
  buildTierInputs,
  riderPeak,
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

// ── riderPeak / buildTierInputs ──────────────────────────────────────────────

test("riderPeak: max over de seks discipliner, manglende felt tæller som 0", () => {
  assert.equal(riderPeak({ flat: 30, climbing: 52, sprint: 10 }), 52);
  assert.equal(riderPeak({ cobblestone: 41 }), 41);
  assert.equal(riderPeak({}), 0);
});

test("buildTierInputs: grupperer pr. tier og beregner styrke fra afledte evner", () => {
  const pools = new Map([
    [4, { id: 4, tier: 3, pool_index: 0 }],
    [5, { id: 5, tier: 3, pool_index: 1 }],
    [2, { id: 2, tier: 2, pool_index: 0 }],
  ]);
  const teams = [
    { id: "t1", name: "Alpha", is_ai: false, is_bank: false, league_division_id: 4 },
    { id: "t2", name: "AI Beta", is_ai: true, is_bank: false, league_division_id: 5 },
    { id: "t3", name: "Gamma", is_ai: false, is_bank: false, league_division_id: 2 },
  ];
  const riders = [
    { id: "r1", team_id: "t1", is_retired: false },
    { id: "r2", team_id: "t1", is_retired: false },
    { id: "r3", team_id: "t2", is_retired: false },
    { id: "r4", team_id: "t3", is_retired: false },
  ];
  const abilities = new Map([
    ["r1", { flat: 40, climbing: 10 }],
    ["r2", { sprint: 20 }],
    ["r3", { punch: 33 }],
    ["r4", { time_trial: 60 }],
  ]);

  const byTier = buildTierInputs(teams, riders, abilities, pools);
  assert.deepEqual([...byTier.keys()].sort(), [2, 3]);
  const tier3 = byTier.get(3);
  assert.equal(tier3.length, 2);
  const alpha = tier3.find((t) => t.teamId === "t1");
  assert.equal(alpha.strength, 30); // (40 + 20) / 2
  assert.equal(alpha.isAi, false);
  assert.deepEqual([...alpha.riderPeaks].sort((a, b) => b - a), [40, 20]);
  assert.equal(tier3.find((t) => t.teamId === "t2").isAi, true);
});

test("buildTierInputs: bank-hold, pulje-løse hold, ukendte puljer og pensionerede ryttere ignoreres", () => {
  const pools = new Map([[4, { id: 4, tier: 3, pool_index: 0 }]]);
  const teams = [
    { id: "bank", name: "Bank", is_ai: false, is_bank: true, league_division_id: 4 },
    { id: "nopool", name: "No pool", is_ai: false, is_bank: false, league_division_id: null },
    { id: "ghost", name: "Ghost pool", is_ai: false, is_bank: false, league_division_id: 99 },
    { id: "real", name: "Real", is_ai: false, is_bank: false, league_division_id: 4 },
  ];
  const riders = [
    { id: "r1", team_id: "real", is_retired: true },
    { id: "r2", team_id: "real", is_retired: false },
    { id: "r3", team_id: null, is_retired: false },
  ];
  const abilities = new Map([
    ["r1", { flat: 99 }],
    ["r2", { flat: 30 }],
    ["r3", { flat: 80 }],
  ]);

  const byTier = buildTierInputs(teams, riders, abilities, pools);
  assert.equal(byTier.size, 1);
  const tier3 = byTier.get(3);
  assert.equal(tier3.length, 1);
  assert.equal(tier3[0].teamId, "real");
  assert.equal(tier3[0].strength, 30, "pensioneret 99-rytter må ikke tælle med");
});

// ── poolTotalsSpread ─────────────────────────────────────────────────────────

test("poolTotalsSpread: 0 for identiske pulje-totaler, positiv for skæve", () => {
  const flat = poolStrengthStats([
    { teamId: "a", poolId: 1, strength: 50 },
    { teamId: "b", poolId: 2, strength: 50 },
  ]);
  assert.equal(poolTotalsSpread(flat), 0);

  const skew = poolStrengthStats([
    { teamId: "a", poolId: 1, strength: 60 },
    { teamId: "b", poolId: 2, strength: 40 },
  ]);
  assert.equal(poolTotalsSpread(skew), 10); // populations-sd af [60, 40]
  assert.equal(poolTotalsSpread([]), 0);
});

// ── planRealTeamReseed (motor-politikken) ────────────────────────────────────

function reseedTeam(teamId, poolId, peaks, { isAi = false } = {}) {
  return { teamId, poolId, isAi, riderPeaks: peaks, strength: teamStrength(peaks) };
}
function flatTeams(poolId, n, peak, prefix) {
  return Array.from({ length: n }, (_, i) => reseedTeam(`${prefix}${i}`, poolId, Array(6).fill(peak)));
}

// Skæv tier der KAN udlignes: pulje 1 har én runaway-stakker blandt svage hold,
// pulje 2 er fuld af middel-hold der kan holde stakkeren i skak.
function improvableTier() {
  return [
    reseedTeam("S-stacker", 1, [60, 58, 56, 54, 50, 50]),
    ...flatTeams(1, 5, 20, "w"),
    ...flatTeams(2, 6, 45, "m"),
  ];
}

// Den empiriske hovedfælde (målt mod prod 3/8: tier 3 ville gå 14 → 17): en
// snake på GENNEMSNITS-styrke kan sprede to stakkere ud i hver sin pulje og
// dermed lade dominans-marginen stå uændret.
function unimprovableTier() {
  return [
    reseedTeam("A-stack", 1, [60, 58, 56, 54, 50, 50]),
    reseedTeam("B-stack", 1, [60, 58, 56, 54, 50, 50]),
    ...flatTeams(1, 4, 20, "w1-"),
    ...flatTeams(2, 6, 20, "w2-"),
  ];
}

test("planRealTeamReseed: under tærskel røres tieren ikke", () => {
  const teams = [...flatTeams(1, 6, 30, "a"), ...flatTeams(2, 6, 30, "b")];
  const r = planRealTeamReseed({ teams, poolIds: [1, 2] });
  assert.equal(r.needsReseed, false);
  assert.equal(r.applied, false);
  assert.equal(r.skipReason, "below-threshold");
  assert.deepEqual(r.moves, []);
  assert.equal(r.threshold, DEFAULT_RESEED_THRESHOLD);
});

test("planRealTeamReseed: én-pulje-tier kan ikke re-seedes", () => {
  const teams = [reseedTeam("S", 1, [60, 58, 56, 54, 50, 50]), ...flatTeams(1, 5, 20, "w")];
  const r = planRealTeamReseed({ teams, poolIds: [1] });
  assert.equal(r.applied, false);
  assert.equal(r.skipReason, "single-pool-tier");
});

test("planRealTeamReseed: udligner en skæv tier og sænker skævheds-indekset", () => {
  const r = planRealTeamReseed({ teams: improvableTier(), poolIds: [1, 2] });
  assert.equal(r.needsReseed, true);
  assert.equal(r.applied, true);
  assert.equal(r.beforeIndex, 34); // stakkerens 4.-bedste 54 mod svage rivalers 20
  assert.equal(r.projectedIndex, 9); // efter reseed står to middel-hold i puljen
  assert.ok(r.projectedIndex < r.beforeIndex);
  assert.ok(r.moves.length > 0);
  assert.equal(r.movableCount, 12);
});

test("planRealTeamReseed: moves flytter kun INDEN FOR tierens egne puljer", () => {
  const r = planRealTeamReseed({ teams: improvableTier(), poolIds: [1, 2] });
  for (const m of r.moves) {
    assert.ok([1, 2].includes(m.toPoolId), `ukendt destinationspulje ${m.toPoolId}`);
    assert.notEqual(m.fromPoolId, m.toPoolId, "moves må kun indeholde ægte flytninger");
  }
});

test("planRealTeamReseed: AI-hold flyttes ALDRIG (de er fyld der regenereres)", () => {
  const teams = improvableTier().map((t, i) => (i % 2 === 1 ? { ...t, isAi: true } : t));
  const aiIds = new Set(teams.filter((t) => t.isAi).map((t) => t.teamId));
  const r = planRealTeamReseed({ teams, poolIds: [1, 2] });
  assert.ok(aiIds.size > 0, "fixture skal indeholde AI-hold");
  for (const m of r.moves) {
    assert.ok(!aiIds.has(m.teamId), `AI-hold ${m.teamId} blev flyttet`);
  }
  assert.equal(r.movableCount, teams.length - aiIds.size);
});

test("planRealTeamReseed: tier uden ægte hold flagges skæv men røres ikke", () => {
  const teams = improvableTier().map((t) => ({ ...t, isAi: true }));
  const r = planRealTeamReseed({ teams, poolIds: [1, 2] });
  assert.equal(r.needsReseed, true);
  assert.equal(r.applied, false);
  assert.equal(r.skipReason, "no-real-teams");
  assert.deepEqual(r.moves, []);
});

test("planRealTeamReseed: dropper en plan der ikke forbedrer indekset", () => {
  const r = planRealTeamReseed({ teams: unimprovableTier(), poolIds: [1, 2] });
  assert.equal(r.needsReseed, true);
  assert.equal(r.applied, false);
  assert.equal(r.skipReason, "no-improvement");
  assert.deepEqual(r.moves, [], "ingen skrivninger når planen ikke hjælper");
  assert.equal(r.beforeIndex, 34);
  assert.equal(r.projectedIndex, 34, "den droppede plan rapporteres stadig som evidens");
});

test("planRealTeamReseed: requireImprovement kan slås fra (til dry-run/analyse)", () => {
  const r = planRealTeamReseed({ teams: unimprovableTier(), poolIds: [1, 2], requireImprovement: false });
  assert.equal(r.applied, true);
  assert.ok(r.moves.length > 0);
});

test("planRealTeamReseed: tærskel kan overstyres", () => {
  assert.equal(planRealTeamReseed({ teams: improvableTier(), poolIds: [1, 2], threshold: 100 }).needsReseed, false);
  assert.equal(planRealTeamReseed({ teams: improvableTier(), poolIds: [1, 2], threshold: 1 }).needsReseed, true);
});

test("planRealTeamReseed: deterministisk — samme input giver samme flytninger", () => {
  const a = planRealTeamReseed({ teams: improvableTier(), poolIds: [1, 2] });
  const b = planRealTeamReseed({ teams: improvableTier().reverse(), poolIds: [1, 2] });
  assert.deepEqual(
    [...a.moves].sort((x, y) => x.teamId.localeCompare(y.teamId)),
    [...b.moves].sort((x, y) => x.teamId.localeCompare(y.teamId)),
  );
});

test("planRealTeamReseed: muterer ikke input", () => {
  const teams = improvableTier();
  const snapshot = JSON.stringify(teams);
  planRealTeamReseed({ teams, poolIds: [1, 2] });
  assert.equal(JSON.stringify(teams), snapshot);
});
