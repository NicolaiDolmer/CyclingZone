import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGlobalScore, rankTeams, DIVISION_WEIGHTS, SEASON_WEIGHTS } from "./globalRankFormula.js";

test("division weights: Div 1 counts more than Div 4 for identical points", () => {
  const div1 = computeGlobalScore([{ division: 1, totalPoints: 100, recencyRank: 1 }]);
  const div4 = computeGlobalScore([{ division: 4, totalPoints: 100, recencyRank: 1 }]);
  assert.equal(div1.globalScore, 100 * DIVISION_WEIGHTS[1]);
  assert.equal(div4.globalScore, 100 * DIVISION_WEIGHTS[4]);
  assert.ok(div1.globalScore > div4.globalScore);
});

test("season weights: current season counts more than previous season", () => {
  const current = computeGlobalScore([{ division: 2, totalPoints: 100, recencyRank: 1 }]);
  const previous = computeGlobalScore([{ division: 2, totalPoints: 100, recencyRank: 2 }]);
  assert.equal(current.globalScore, 100 * DIVISION_WEIGHTS[2] * SEASON_WEIGHTS[1]);
  assert.equal(previous.globalScore, 100 * DIVISION_WEIGHTS[2] * SEASON_WEIGHTS[2]);
  assert.ok(current.globalScore > previous.globalScore);
});

test("new manager (1 season) is scored on per-season average, not penalized for tenure", () => {
  // Veteran: two mediocre seasons averaging 50 weighted points/season.
  const veteran = computeGlobalScore([
    { division: 3, totalPoints: 25, recencyRank: 1 }, // 25*2*1.0 = 50
    { division: 3, totalPoints: 50, recencyRank: 2 }, // 50*2*0.5 = 50
  ]);
  // Rookie: one strong season, same weighted value as veteran's average.
  const rookie = computeGlobalScore([
    { division: 3, totalPoints: 25, recencyRank: 1 }, // 25*2*1.0 = 50
  ]);
  assert.equal(veteran.seasonsPlayed, 2);
  assert.equal(rookie.seasonsPlayed, 1);
  // Averaging (not summing) means a rookie's single strong season can match a
  // veteran's two-season average — tenure alone does not inflate the score.
  assert.equal(veteran.globalScore, rookie.globalScore);
});

test("manager with no results in the window scores 0, not null/NaN", () => {
  const noResults = computeGlobalScore([]);
  assert.deepEqual(noResults, { weightedPointsSum: 0, seasonsPlayed: 0, globalScore: 0 });

  const outsideWindow = computeGlobalScore([{ division: 1, totalPoints: 999, recencyRank: 5 }]);
  assert.deepEqual(outsideWindow, { weightedPointsSum: 0, seasonsPlayed: 0, globalScore: 0 });
});

test("unknown division falls back to weight 1 (defensive, matches SQL CASE ELSE 1)", () => {
  const unknownDiv = computeGlobalScore([{ division: 99, totalPoints: 100, recencyRank: 1 }]);
  assert.equal(unknownDiv.globalScore, 100 * 1);
});

test("rankTeams: RANK()-style — tied scores share a rank, next rank skips", () => {
  const ranked = rankTeams([
    { teamId: "a", rows: [{ division: 1, totalPoints: 100, recencyRank: 1 }] }, // 400
    { teamId: "b", rows: [{ division: 1, totalPoints: 100, recencyRank: 1 }] }, // 400 (tie with a)
    { teamId: "c", rows: [{ division: 4, totalPoints: 100, recencyRank: 1 }] }, // 100
  ]);
  const byId = Object.fromEntries(ranked.map(r => [r.teamId, r.globalRank]));
  assert.equal(byId.a, 1);
  assert.equal(byId.b, 1);
  assert.equal(byId.c, 3); // skips rank 2 (RANK, not DENSE_RANK — matches SQL RANK())
});

test("rankTeams: team with zero seasons ranks last, not crashes", () => {
  const ranked = rankTeams([
    { teamId: "a", rows: [{ division: 1, totalPoints: 100, recencyRank: 1 }] },
    { teamId: "new", rows: [] },
  ]);
  const byId = Object.fromEntries(ranked.map(r => [r.teamId, r.globalRank]));
  assert.equal(byId.a, 1);
  assert.equal(byId.new, 2);
});
