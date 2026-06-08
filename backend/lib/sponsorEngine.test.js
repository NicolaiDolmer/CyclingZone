import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSponsorForSeason,
  computeVariableSponsor,
} from "./sponsorEngine.js";

test("computeSponsorForSeason keeps season 1 on intro sponsor", () => {
  const result = computeSponsorForSeason({
    seasonNumber: 1,
    team: { sponsor_income: 240_000 },
  });

  assert.equal(result.mode, "intro");
  assert.equal(result.gross_sponsor, 240_000);
  assert.equal(result.variable, 0);
});

test("computeVariableSponsor gives top team max variable and bottom team base only", () => {
  const divisionPoints = [300, 200, 100, 0];

  const top = computeVariableSponsor({
    lastSeasonPoints: 300,
    lastSeasonRank: 1,
    divisionPoints,
    divisionSize: 4,
  });
  const bottom = computeVariableSponsor({
    lastSeasonPoints: 0,
    lastSeasonRank: 4,
    divisionPoints,
    divisionSize: 4,
  });

  assert.equal(top.total, 2_650_000);
  assert.equal(top.variable, 150_000);
  assert.equal(bottom.total, 2_500_000);
  assert.equal(bottom.variable, 0);
});

test("computeSponsorForSeason uses division-relative points and rank from previous season", () => {
  const standings = [
    { team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
    { team_id: "team-2", division: 3, total_points: 120, rank_in_division: 2 },
    { team_id: "team-3", division: 3, total_points: 60, rank_in_division: 3 },
  ];

  const result = computeSponsorForSeason({
    seasonNumber: 2,
    team: { id: "team-2", sponsor_income: 240_000 },
    lastSeasonStanding: standings[1],
    divisionStandings: standings,
  });

  assert.equal(result.mode, "variable");
  assert.equal(result.base, 2_500_000);
  assert.equal(result.variable, 75_000);
  assert.equal(result.gross_sponsor, 2_575_000);
  assert.equal(result.last_season_rank, 2);
  assert.equal(result.median_points, 120);
});

test("computeSponsorForSeason falls back safely if season 2 lacks standings", () => {
  const result = computeSponsorForSeason({
    seasonNumber: 2,
    team: { sponsor_income: 240_000 },
  });

  assert.equal(result.mode, "fallback");
  assert.equal(result.gross_sponsor, 240_000);
});
