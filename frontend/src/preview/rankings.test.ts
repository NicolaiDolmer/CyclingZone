import test from "node:test";
import assert from "node:assert/strict";
import { apiResponse } from "./mockHandlers.js";
import { TEST_TEAM, ACTIVE_SEASON, SEED_GLOBAL_RANK, SEED_RIDER_RANKINGS, SEED_TEAM_RACE_POINTS_MV } from "./seedData.js";

test("ranking preview APIs preserve global, rider, season and team filters", () => {
  assert.deepEqual(apiResponse("/api/rankings/global", `?team_id=${TEST_TEAM.id}`), { data: SEED_GLOBAL_RANK.filter(r => r.team_id === TEST_TEAM.id) });
  assert.deepEqual(apiResponse("/api/rankings/riders", `?season_id=${ACTIVE_SEASON.id}&rider_ids=rider-1`), { data: SEED_RIDER_RANKINGS.filter(r => r.rider_id === "rider-1") });
  assert.deepEqual(apiResponse("/api/rankings/riders", "?season_id=missing"), { data: [] });
  assert.deepEqual(apiResponse("/api/rankings/race-points", "?season_id=missing"), { data: [] });
});

test("NPS preview count is per team across seasons; race points are scoped to requested races", () => {
  const own = SEED_TEAM_RACE_POINTS_MV.filter(r => r.team_id === TEST_TEAM.id);
  assert.deepEqual(apiResponse("/api/rankings/race-count", `?team_id=${TEST_TEAM.id}`), { count: own.length });
  const raceId = own[0].race_id;
  const expected = SEED_TEAM_RACE_POINTS_MV.filter(r => r.race_id === raceId).map(({ team_id, race_id, race_points }) => ({ team_id, race_id, race_points }));
  assert.deepEqual(apiResponse("/api/rankings/race-points", `?race_ids=${raceId}`), { data: expected });
});

test("standings preview keeps historical empty aggregate data and rejects unknown seasons", () => {
  assert.deepEqual(apiResponse("/api/rankings/standings", `?season_id=${ACTIVE_SEASON.id}`), { data: [] });
  assert.deepEqual(apiResponse("/api/rankings/standings", "?season_id=missing"), { data: [] });
});
