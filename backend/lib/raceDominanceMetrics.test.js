import { test } from "node:test";
import assert from "node:assert/strict";

import {
  observeRace,
  aggregateObservations,
  winRateStats,
  giniOverWins,
  helperPlacementDeltas,
  median,
} from "./raceDominanceMetrics.js";

// ── observeRace ────────────────────────────────────────────────────────────

test("observeRace: favorit = højeste components.terrain; tie brydes på laveste rider_id", () => {
  const ranked = [
    { rider_id: "r2", rank: 1, components: { terrain: 95 } }, // vinder + favorit (tie-vinder mod r3)
    { rider_id: "r1", rank: 2, components: { terrain: 80 } },
    { rider_id: "r3", rank: 3, components: { terrain: 95 } }, // samme terrain som r2, men "r3" > "r2"
    { rider_id: "r4", rank: 4, components: { terrain: 70 } },
  ];
  const teamByRider = new Map();
  const obs = observeRace({ ranked, teamByRider, terrain: "mountain" });

  assert.equal(obs.favoriteId, "r2", "laveste rider_id skal vinde tie-break");
  assert.equal(obs.winnerId, "r2");
  assert.equal(obs.favoriteWon, true);
  assert.equal(obs.favoritePodium, true);
  assert.equal(obs.favoriteRank, 1);
  assert.equal(obs.fieldSize, 4);
  assert.equal(obs.terrain, "mountain");
});

test("observeRace: favorit hverken vinder eller på podie", () => {
  const ranked = [
    { rider_id: "r1", rank: 1, components: { terrain: 50 } },
    { rider_id: "r2", rank: 2, components: { terrain: 40 } },
    { rider_id: "r3", rank: 3, components: { terrain: 30 } },
    { rider_id: "r4", rank: 4, components: { terrain: 20 } },
    { rider_id: "r5", rank: 5, components: { terrain: 99 } }, // favorit, men rank 5
  ];
  const obs = observeRace({ ranked, teamByRider: new Map(), terrain: "flat" });

  assert.equal(obs.favoriteId, "r5");
  assert.equal(obs.favoriteRank, 5);
  assert.equal(obs.favoriteWon, false);
  assert.equal(obs.favoritePodium, false);
});

test("observeRace: maxSameTeamTop10/distinctTeamsTop10 — blandede hold + null-team_id klumpes ALDRIG sammen", () => {
  // Top10 (rank 1-10): teamA x3 (rank1-3), teamB x2 (rank4-5), 5 ryttere uden hold (rank6-10).
  // rank 11-12 ligger uden for top10 og må ikke påvirke tallene.
  const ranked = [
    { rider_id: "a1", rank: 1, components: { terrain: 10 } },
    { rider_id: "a2", rank: 2, components: { terrain: 9 } },
    { rider_id: "a3", rank: 3, components: { terrain: 8 } },
    { rider_id: "b1", rank: 4, components: { terrain: 7 } },
    { rider_id: "b2", rank: 5, components: { terrain: 6 } },
    { rider_id: "n1", rank: 6, components: { terrain: 5 } },
    { rider_id: "n2", rank: 7, components: { terrain: 4 } },
    { rider_id: "n3", rank: 8, components: { terrain: 3 } },
    { rider_id: "n4", rank: 9, components: { terrain: 2 } },
    { rider_id: "n5", rank: 10, components: { terrain: 1 } },
    { rider_id: "x1", rank: 11, components: { terrain: 100 } }, // uden for top10
    { rider_id: "x2", rank: 12, components: { terrain: 0 } },
  ];
  const teamByRider = new Map([
    ["a1", "teamA"], ["a2", "teamA"], ["a3", "teamA"],
    ["b1", "teamB"], ["b2", "teamB"],
    ["n1", null], ["n2", null], ["n3", null], ["n4", null], ["n5", null],
    ["x1", "teamA"], ["x2", null],
  ]);
  const obs = observeRace({ ranked, teamByRider, terrain: "hilly" });

  assert.equal(obs.fieldSize, 12);
  assert.equal(obs.maxSameTeamTop10, 3, "teamA har 3 i top10");
  // teamA + teamB + 5 unikke null-ryttere = 7 distinkte "hold"
  assert.equal(obs.distinctTeamsTop10, 7);
});

test("observeRace: felt < 10 ryttere — top10-slice dækker hele feltet", () => {
  const ranked = [
    { rider_id: "r1", rank: 1, components: { terrain: 30 } },
    { rider_id: "r2", rank: 2, components: { terrain: 25 } },
    { rider_id: "r3", rank: 3, components: { terrain: 20 } },
    { rider_id: "r4", rank: 4, components: { terrain: 15 } },
    { rider_id: "r5", rank: 5, components: { terrain: 10 } },
    { rider_id: "r6", rank: 6, components: { terrain: 5 } },
  ];
  const teamByRider = new Map([
    ["r1", "teamX"], ["r2", "teamX"], ["r3", null], ["r4", null], ["r5", "teamY"], ["r6", "teamY"],
  ]);
  const obs = observeRace({ ranked, teamByRider, terrain: "rolling" });

  assert.equal(obs.fieldSize, 6);
  assert.equal(obs.maxSameTeamTop10, 2, "teamX/teamY/hver null-rytter topper ved 2");
  // teamX(1) + teamY(1) + r3(1) + r4(1) = 4
  assert.equal(obs.distinctTeamsTop10, 4);
});

// ── aggregateObservations ────────────────────────────────────────────────────

test("aggregateObservations: tom liste → races:0 og alle rater null", () => {
  const agg = aggregateObservations([]);
  assert.equal(agg.races, 0);
  assert.equal(agg.favoriteWinRate, null);
  assert.equal(agg.favoritePodiumRate, null);
  assert.equal(agg.share4PlusSameTeamTop10, null);
  assert.equal(agg.avgMaxSameTeamTop10, null);
  assert.equal(agg.avgDistinctTeamsTop10, null);
  assert.deepEqual(agg.perTerrain, {});
});

test("aggregateObservations: share4PlusSameTeamTop10 tæller kun løb med maxSameTeamTop10 ≥ 4", () => {
  const observations = [
    { terrain: "flat", favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 5, distinctTeamsTop10: 4 },
    { terrain: "flat", favoriteWon: false, favoritePodium: true, maxSameTeamTop10: 4, distinctTeamsTop10: 5 },
    { terrain: "flat", favoriteWon: false, favoritePodium: false, maxSameTeamTop10: 3, distinctTeamsTop10: 6 },
    { terrain: "flat", favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 2, distinctTeamsTop10: 7 },
    { terrain: "flat", favoriteWon: false, favoritePodium: false, maxSameTeamTop10: 1, distinctTeamsTop10: 8 },
  ];
  const agg = aggregateObservations(observations);
  assert.equal(agg.races, 5);
  assert.equal(agg.share4PlusSameTeamTop10, 0.4, "2 ud af 5 løb har maxSameTeamTop10 ≥ 4");
  assert.equal(agg.favoriteWinRate, 0.4);
  assert.equal(agg.favoritePodiumRate, 0.6, "3 ud af 5 løb har favoritten på podiet");
});

test("aggregateObservations: perTerrain-split måler favoriteWinRate isoleret pr. terræn", () => {
  const observations = [
    { terrain: "flat", favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 2, distinctTeamsTop10: 8 },
    { terrain: "flat", favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 2, distinctTeamsTop10: 8 },
    { terrain: "mountain", favoriteWon: false, favoritePodium: false, maxSameTeamTop10: 3, distinctTeamsTop10: 6 },
    { terrain: "mountain", favoriteWon: false, favoritePodium: true, maxSameTeamTop10: 3, distinctTeamsTop10: 6 },
    { terrain: "mountain", favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 3, distinctTeamsTop10: 6 },
  ];
  const agg = aggregateObservations(observations);
  assert.deepEqual(agg.perTerrain.flat, { races: 2, favoriteWinRate: 1 });
  assert.deepEqual(agg.perTerrain.mountain, { races: 3, favoriteWinRate: 1 / 3 });
});

// ── winRateStats ──────────────────────────────────────────────────────────

test("winRateStats: minStarts-filter ekskluderer ryttere med for få starter", () => {
  const winsByRider = new Map([["a", 3], ["b", 1]]);
  const startsByRider = new Map([["a", 10], ["b", 2]]); // b under minStarts=5
  const stats = winRateStats({ winsByRider, startsByRider, minStarts: 5 });
  assert.equal(stats.riders, 1, "kun 'a' kvalificerer");
  assert.equal(stats.maxWinRate, 0.3);
});

test("winRateStats: max/p95 følger harnessets index-metode (sorted asc, floor(0.95*len) clamped)", () => {
  // 21 ryttere, starts=100, wins=0..20 → rates 0.00..0.20, allerede stigende.
  const winsByRider = new Map();
  const startsByRider = new Map();
  for (let i = 0; i <= 20; i++) {
    winsByRider.set(`r${i}`, i);
    startsByRider.set(`r${i}`, 100);
  }
  const stats = winRateStats({ winsByRider, startsByRider, minStarts: 5 });
  assert.equal(stats.riders, 21);
  assert.equal(stats.maxWinRate, 0.20, "sidste (index 20) er maks");
  // len=21 → floor(0.95*21)=19 → min(20,19)=19 → rate for wins=19 → 0.19
  assert.equal(Math.round(stats.p95WinRate * 100) / 100, 0.19);
});

test("winRateStats: histogram-kanter — 0% og 100% win-rate lander korrekt", () => {
  const winsByRider = new Map([["zero", 0], ["hundred", 10]]);
  const startsByRider = new Map([["zero", 10], ["hundred", 10]]);
  const stats = winRateStats({ winsByRider, startsByRider, minStarts: 5 });

  assert.equal(stats.histogram[0].from, 0);
  assert.equal(stats.histogram[0].to, 0.1);
  assert.equal(stats.histogram[0].count, 1, "0% havner i første bucket");

  assert.equal(stats.histogram[9].from, 0.9);
  assert.equal(stats.histogram[9].to, 1.0);
  assert.equal(stats.histogram[9].count, 1, "100% havner i sidste bucket (ikke out-of-bounds)");

  const totalCount = stats.histogram.reduce((sum, b) => sum + b.count, 0);
  assert.equal(totalCount, 2);
});

test("winRateStats: ingen kvalificerede ryttere → maxWinRate/p95WinRate null", () => {
  const winsByRider = new Map();
  const startsByRider = new Map([["a", 1]]); // under minStarts default 5
  const stats = winRateStats({ winsByRider, startsByRider });
  assert.equal(stats.riders, 0);
  assert.equal(stats.maxWinRate, null);
  assert.equal(stats.p95WinRate, null);
});

// ── giniOverWins ──────────────────────────────────────────────────────────

test("giniOverWins: alle ryttere med lige mange sejre → 0", () => {
  const startsByRider = new Map([["a", 10], ["b", 10], ["c", 10], ["d", 10], ["e", 10]]);
  const winsByRider = new Map([["a", 2], ["b", 2], ["c", 2], ["d", 2], ["e", 2]]);
  assert.equal(giniOverWins({ winsByRider, startsByRider }), 0);
});

test("giniOverWins: én rytter tager alle sejre → tæt på (n-1)/n", () => {
  const startsByRider = new Map([["a", 10], ["b", 10], ["c", 10], ["d", 10], ["e", 10]]);
  const winsByRider = new Map([["a", 10]]); // b-e har 0 sejre
  const gini = giniOverWins({ winsByRider, startsByRider });
  assert.equal(gini, 0.8, "n=5 → (n-1)/n = 0.8 når hele massen ligger hos én");
});

test("giniOverWins: ryttere med 0 sejre indgår i beregningen", () => {
  const startsByRider = new Map([["a", 10], ["b", 10]]);
  const winsByRider = new Map([["a", 4]]); // b har 0 sejre, men skal tælle med
  const gini = giniOverWins({ winsByRider, startsByRider });
  // sorted [0,4], n=2, sumX=4. weightedSum = 1*0 + 2*4 = 8. G = (2*8)/(2*4) - 3/2 = 2 - 1.5 = 0.5
  assert.equal(gini, 0.5);
});

test("giniOverWins: 0 starter i alt eller 0 sejre i alt → null", () => {
  assert.equal(giniOverWins({ winsByRider: new Map(), startsByRider: new Map() }), null);
  const startsByRider = new Map([["a", 10], ["b", 10]]);
  assert.equal(giniOverWins({ winsByRider: new Map(), startsByRider }), null, "ingen sejre overhovedet → null");
});

// ── helperPlacementDeltas ─────────────────────────────────────────────────

test("helperPlacementDeltas: helper der falder/stiger; captain/hunter ignoreres; kun-i-én-kørsel springes over", () => {
  const roleByRider = new Map([
    ["r1", "captain"],
    ["r2", "helper"],
    ["r3", "hunter"],
    ["r4", "helper"],
    ["r5", "helper"], // kun i rankedNeutral
    ["r6", "helper"],
  ]);
  const rankedRoles = [
    { rider_id: "r1", rank: 1 },
    { rider_id: "r2", rank: 6 },
    { rider_id: "r3", rank: 3 },
    { rider_id: "r4", rank: 9 },
    { rider_id: "r6", rank: 2 },
  ];
  const rankedNeutral = [
    { rider_id: "r1", rank: 1 },
    { rider_id: "r2", rank: 4 },
    { rider_id: "r3", rank: 2 },
    { rider_id: "r4", rank: 7 },
    { rider_id: "r5", rank: 5 },
    { rider_id: "r6", rank: 8 },
  ];

  const deltas = helperPlacementDeltas({ rankedRoles, rankedNeutral, roleByRider });
  // r2: 6-4=+2 (faldt), r4: 9-7=+2 (faldt), r5: springes over (mangler i rankedRoles),
  // r6: 2-8=-6 (steg). captain/hunter ignoreres helt.
  assert.deepEqual(deltas, [2, 2, -6]);
});

// ── median ────────────────────────────────────────────────────────────────

test("median: tom liste → null", () => {
  assert.equal(median([]), null);
});

test("median: ulige antal → midterste element", () => {
  assert.equal(median([3, 1, 2]), 2);
});

test("median: lige antal → gennemsnit af de to midterste (sorterings-uafhængigt)", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
