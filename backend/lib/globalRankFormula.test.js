import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySeasonRollover,
  computeGlobalPoints,
  isActiveRecent,
  rankTeams,
  computeClimbers,
  computeBestNewManagers,
  computeMovement,
} from "./globalRankFormula.js";

test("applySeasonRollover: halves banked + season points combined", () => {
  assert.equal(applySeasonRollover(100, 50), 75); // (100+50)*0.5
  assert.equal(applySeasonRollover(0, 200), 100);
  assert.equal(applySeasonRollover(100, 0), 50); // inactive team still decays
});

test("applySeasonRollover: constant per-season points self-limit, never inflate without bound", () => {
  let banked = 0;
  const P = 100;
  for (let i = 0; i < 20; i++) {
    banked = applySeasonRollover(banked, P);
  }
  // Fixed point of banked' = 0.5*(banked+P) is banked = P — the banked balance
  // converges to one season's worth, it never grows unbounded season over season.
  assert.ok(banked <= P);
  assert.ok(banked > 0.99 * P);
  // The DISPLAYED global total (banked + live current-season points) peaks at
  // ~2P right before the next rollover absorbs it — matches the design note
  // "self-limiting (max ~2x one season's points)".
  const displayedAtSeasonEnd = computeGlobalPoints(banked, P);
  assert.ok(displayedAtSeasonEnd <= 2 * P);
  assert.ok(displayedAtSeasonEnd > 1.9 * P);
});

test("computeGlobalPoints: banked + current season live points", () => {
  assert.equal(computeGlobalPoints(75, 30), 105);
  assert.equal(computeGlobalPoints(null, undefined), 0);
});

test("isActiveRecent: true if team played in current or previous season", () => {
  assert.equal(isActiveRecent(["s3"], ["s3", "s2"]), true);
  assert.equal(isActiveRecent(["s2"], ["s3", "s2"]), true);
  assert.equal(isActiveRecent(["s1"], ["s3", "s2"]), false); // 2+ seasons inactive
  assert.equal(isActiveRecent([], ["s3", "s2"]), false);
});

test("rankTeams: RANK()-style among active teams only, inactive get null (hidden)", () => {
  const ranked = rankTeams([
    { teamId: "a", globalPoints: 400, activeRecent: true },
    { teamId: "b", globalPoints: 400, activeRecent: true }, // tie with a
    { teamId: "c", globalPoints: 100, activeRecent: true },
    { teamId: "ghost", globalPoints: 9999, activeRecent: false }, // inactive, hidden
  ]);
  const byId = Object.fromEntries(ranked.map(r => [r.teamId, r.globalRank]));
  assert.equal(byId.a, 1);
  assert.equal(byId.b, 1);
  assert.equal(byId.c, 3); // skips rank 2 (RANK, not DENSE_RANK)
  assert.equal(byId.ghost, null);
});

test("computeClimbers: places gained since season-start snapshot, positive only", () => {
  const rows = [
    { teamId: "a", globalRank: 5 },
    { teamId: "b", globalRank: 20 },
    { teamId: "c", globalRank: 3 },
  ];
  const startRanks = new Map([["a", 10], ["b", 15], ["c", 3]]);
  const climbers = computeClimbers(rows, startRanks);
  // a: 10-5=+5 climbed. b: 15-20=-5 dropped (excluded). c: 3-3=0 (excluded, not >0).
  assert.equal(climbers.length, 1);
  assert.equal(climbers[0].teamId, "a");
  assert.equal(climbers[0].placesGained, 5);
});

test("computeBestNewManagers: rookies only, ranked by global points desc", () => {
  const rows = [
    { teamId: "vet", isRookie: false, globalPoints: 500, globalRank: 1 },
    { teamId: "r1", isRookie: true, globalPoints: 200, globalRank: 4 },
    { teamId: "r2", isRookie: true, globalPoints: 350, globalRank: 2 },
    { teamId: "hidden-rookie", isRookie: true, globalPoints: 999, globalRank: null },
  ];
  const best = computeBestNewManagers(rows);
  assert.deepEqual(best.map(r => r.teamId), ["r2", "r1"]);
});

test("computeMovement: null when no current rank or no previous snapshot yet", () => {
  assert.equal(computeMovement(null, 5), null);
  assert.equal(computeMovement(5, null), null);
  assert.equal(computeMovement(5, 10), 5); // moved up 5 places
  assert.equal(computeMovement(10, 5), -5); // moved down 5 places
  assert.equal(computeMovement(5, 5), 0);
});
