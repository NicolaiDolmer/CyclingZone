import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeasonRowsForTeam,
  computeSeasonAchievementStats,
  isInRelegationDangerZone,
  relegationCutoffRank,
} from "./seasonAchievements.js";
import { MAX_DIVISION } from "./economyConstants.js";

const S1 = "00000000-0000-0000-0000-000000000001";
const S2 = "00000000-0000-0000-0000-000000000002";

function poolRows({ seasonId, poolId, division, size, ownTeamId, ownRank }) {
  return Array.from({ length: size }, (_, index) => ({
    season_id: seasonId,
    league_division_id: poolId,
    division,
    rank_in_division: index + 1,
    team_id: index + 1 === ownRank ? ownTeamId : `filler-${seasonId}-${poolId}-${index}`,
  }));
}

test("relegationCutoffRank: 24-holds pulje har sidste sikre plads på rang 20", () => {
  assert.equal(relegationCutoffRank(24), 20);
  assert.equal(relegationCutoffRank(25), 21);
  assert.equal(relegationCutoffRank(0), 0);
});

test("isInRelegationDangerZone dækker de 3 pladser over stregen, ikke stregen selv", () => {
  const base = { poolSize: 24, division: 3 };
  assert.equal(isInRelegationDangerZone({ ...base, rank: 17 }), false);
  assert.equal(isInRelegationDangerZone({ ...base, rank: 18 }), true);
  assert.equal(isInRelegationDangerZone({ ...base, rank: 20 }), true);
  // Rang 21 ER nedrykningszonen — ikke "overlevede".
  assert.equal(isInRelegationDangerZone({ ...base, rank: 21 }), false);
});

test("isInRelegationDangerZone: bund-divisionen har ingen farezone (rykker ikke ned)", () => {
  assert.equal(
    isInRelegationDangerZone({ rank: 20, poolSize: 24, division: MAX_DIVISION }),
    false
  );
});

test("computeSeasonAchievementStats: en igangværende sæson tæller ikke", () => {
  const stats = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: false, division: 3, rank: 1, poolSize: 24, nextDivision: 2 },
    ],
  });
  assert.equal(stats.seasonsCompleted, 0);
  assert.equal(stats.seasonBestRank, null);
  assert.deepEqual(stats.seasonDivisionsWon, []);
  assert.equal(stats.hasPromotion, false);
});

test("computeSeasonAchievementStats: puljesejr giver bedste rang 1 + divisionssejr", () => {
  const stats = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 3, rank: 1, poolSize: 24, nextDivision: 2 },
    ],
  });
  assert.equal(stats.seasonsCompleted, 1);
  assert.equal(stats.seasonBestRank, 1);
  assert.deepEqual(stats.seasonDivisionsWon, [3]);
  assert.equal(stats.hasPromotion, true);
  assert.equal(stats.hasRelegation, false);
  assert.equal(stats.hasSurvival, false);
});

test("computeSeasonAchievementStats: op/nedrykning udledes af faktisk divisionsskifte", () => {
  const relegated = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 3, rank: 23, poolSize: 24, nextDivision: 4 },
    ],
  });
  assert.equal(relegated.hasRelegation, true);
  assert.equal(relegated.hasPromotion, false);

  // Ukendt næste division (op/nedrykning ikke kørt endnu) → intet afgøres.
  const pending = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 3, rank: 23, poolSize: 24, nextDivision: null },
    ],
  });
  assert.equal(pending.hasRelegation, false);
  assert.equal(pending.hasPromotion, false);
});

test("computeSeasonAchievementStats: overlevede = farezone + samme division bagefter", () => {
  const survived = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 3, rank: 19, poolSize: 24, nextDivision: 3 },
    ],
  });
  assert.equal(survived.hasSurvival, true);

  const wentDown = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 3, rank: 19, poolSize: 24, nextDivision: 4 },
    ],
  });
  assert.equal(wentDown.hasSurvival, false);
  assert.equal(wentDown.hasRelegation, true);
});

test("computeSeasonAchievementStats: top-3-stimen kræver FORTLØBENDE sæsoner", () => {
  const consecutive = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 2, rank: 3, poolSize: 24, nextDivision: 2 },
      { seasonNumber: 2, isFinal: true, division: 2, rank: 2, poolSize: 24, nextDivision: 2 },
      { seasonNumber: 3, isFinal: true, division: 2, rank: 1, poolSize: 24, nextDivision: 1 },
    ],
  });
  assert.equal(consecutive.seasonMaxConsecutiveTop3, 3);
  assert.equal(consecutive.seasonsCompleted, 3);
  assert.equal(consecutive.seasonBestRank, 1);

  const broken = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 2, rank: 3, poolSize: 24, nextDivision: 2 },
      { seasonNumber: 2, isFinal: true, division: 2, rank: 9, poolSize: 24, nextDivision: 2 },
      { seasonNumber: 3, isFinal: true, division: 2, rank: 1, poolSize: 24, nextDivision: 1 },
    ],
  });
  assert.equal(broken.seasonMaxConsecutiveTop3, 1);

  // Et hul i sæsonnumrene (manager uden standings-række i sæson 2) bryder stimen.
  const gap = computeSeasonAchievementStats({
    seasonRows: [
      { seasonNumber: 1, isFinal: true, division: 2, rank: 2, poolSize: 24, nextDivision: 2 },
      { seasonNumber: 3, isFinal: true, division: 2, rank: 2, poolSize: 24, nextDivision: 2 },
      { seasonNumber: 4, isFinal: true, division: 2, rank: 2, poolSize: 24, nextDivision: 2 },
    ],
  });
  assert.equal(gap.seasonMaxConsecutiveTop3, 2);
});

test("buildSeasonRowsForTeam udleder puljestørrelse + næste sæsons division", () => {
  const teamId = "team-1";
  const standings = [
    ...poolRows({ seasonId: S1, poolId: 4, division: 3, size: 24, ownTeamId: teamId, ownRank: 19 }),
    ...poolRows({ seasonId: S2, poolId: 4, division: 3, size: 24, ownTeamId: teamId, ownRank: 5 }),
  ];
  const rows = buildSeasonRowsForTeam({
    teamId,
    standings,
    seasonsById: new Map([
      [S1, { id: S1, number: 1, status: "completed" }],
      [S2, { id: S2, number: 2, status: "active" }],
    ]),
    currentDivision: 3,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(r => ({ n: r.seasonNumber, final: r.isFinal, rank: r.rank, pool: r.poolSize, next: r.nextDivision })),
    [
      { n: 1, final: true, rank: 19, pool: 24, next: 3 },
      { n: 2, final: false, rank: 5, pool: 24, next: 3 },
    ]
  );

  const stats = computeSeasonAchievementStats({ seasonRows: rows });
  assert.equal(stats.seasonsCompleted, 1);
  assert.equal(stats.hasSurvival, true);
});

test("buildSeasonRowsForTeam falder tilbage til teams.division for seneste sæson", () => {
  const teamId = "team-1";
  const standings = poolRows({
    seasonId: S1, poolId: 4, division: 3, size: 24, ownTeamId: teamId, ownRank: 2,
  });
  const rows = buildSeasonRowsForTeam({
    teamId,
    standings,
    seasonsById: new Map([[S1, { id: S1, number: 1, status: "completed" }]]),
    // Op/nedrykningen er kørt: holdet står nu i division 2.
    currentDivision: 2,
  });
  assert.equal(rows[0].nextDivision, 2);
  assert.equal(computeSeasonAchievementStats({ seasonRows: rows }).hasPromotion, true);
});

test("buildSeasonRowsForTeam: uden kendt division er op/nedrykning uafgjort", () => {
  const teamId = "team-1";
  const standings = poolRows({
    seasonId: S1, poolId: 4, division: 3, size: 24, ownTeamId: teamId, ownRank: 2,
  });
  const rows = buildSeasonRowsForTeam({
    teamId,
    standings,
    seasonsById: new Map([[S1, { id: S1, number: 1, status: "completed" }]]),
    currentDivision: null,
  });
  assert.equal(rows[0].nextDivision, null);
  const stats = computeSeasonAchievementStats({ seasonRows: rows });
  assert.equal(stats.hasPromotion, false);
  assert.equal(stats.seasonBestRank, 2);
});
