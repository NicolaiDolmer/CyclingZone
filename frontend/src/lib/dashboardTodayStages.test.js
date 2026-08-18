import { test } from "node:test";
import assert from "node:assert/strict";
import {
  terrainGlyphBucket,
  computeStageRaceStanding,
  todayStageWinner,
  entryCountFor,
} from "./dashboardTodayStages.js";

test("terrainGlyphBucket — flat/rolling renames to sprint (TerrainGlyph vocabulary)", () => {
  assert.equal(terrainGlyphBucket("flat"), "sprint");
  assert.equal(terrainGlyphBucket("rolling"), "sprint");
});

test("terrainGlyphBucket — hilly/classic → hilly, mountain/high_mountain → mountain, cobbles stays", () => {
  assert.equal(terrainGlyphBucket("hilly"), "hilly");
  assert.equal(terrainGlyphBucket("classic"), "hilly");
  assert.equal(terrainGlyphBucket("mountain"), "mountain");
  assert.equal(terrainGlyphBucket("high_mountain"), "mountain");
  assert.equal(terrainGlyphBucket("cobbles"), "cobbles");
});

test("terrainGlyphBucket — itt/ttt both fold to itt (existing stageTerrain.js simplification)", () => {
  assert.equal(terrainGlyphBucket("itt"), "itt");
  assert.equal(terrainGlyphBucket("ttt"), "itt");
});

test("terrainGlyphBucket — unknown/missing profile_type falls back to sprint", () => {
  assert.equal(terrainGlyphBucket(null), "sprint");
  assert.equal(terrainGlyphBucket(undefined), "sprint");
  assert.equal(terrainGlyphBucket("something-unknown"), "sprint");
});

test("computeStageRaceStanding — null with no rows / no teamId", () => {
  assert.equal(computeStageRaceStanding([], "team-1"), null);
  assert.equal(computeStageRaceStanding(null, "team-1"), null);
  assert.equal(computeStageRaceStanding([{ result_type: "team", rank: 1, team_id: "team-1" }], null), null);
});

test("computeStageRaceStanding — prefers the DEFINITIVE final 'team' classification", () => {
  const rows = [
    { result_type: "team", stage_number: 3, rank: 1, team_id: "rival" },
    { result_type: "team", stage_number: 3, rank: 2, team_id: "team-1" },
    { result_type: "team", stage_number: 3, rank: 3, team_id: "other" },
    // Earlier-stage rows should never win over the final stage's snapshot.
    { result_type: "team", stage_number: 1, rank: 1, team_id: "team-1" },
  ];
  assert.deepEqual(computeStageRaceStanding(rows, "team-1"), { rank: 2, total: 3, final: true });
});

test("computeStageRaceStanding — falls back to a derived team standing from the latest full 'leader' snapshot", () => {
  const rows = [
    // Day 1: only the jersey holder (rank 1) — not a full field snapshot yet.
    { result_type: "leader", stage_number: 1, rank: 1, team_id: "rival", finish_time: "+0:00" },
    // Day 2: full field snapshot (>1 row) for 3 riders each on 2 teams.
    { result_type: "leader", stage_number: 2, rank: 1, team_id: "rival", team_name: "Rival", finish_time: "+0:00" },
    { result_type: "leader", stage_number: 2, rank: 2, team_id: "rival", team_name: "Rival", finish_time: "+0:05" },
    { result_type: "leader", stage_number: 2, rank: 3, team_id: "rival", team_name: "Rival", finish_time: "+0:10" },
    { result_type: "leader", stage_number: 2, rank: 4, team_id: "team-1", team_name: "Mine", finish_time: "+0:20" },
    { result_type: "leader", stage_number: 2, rank: 5, team_id: "team-1", team_name: "Mine", finish_time: "+0:25" },
    { result_type: "leader", stage_number: 2, rank: 6, team_id: "team-1", team_name: "Mine", finish_time: "+0:30" },
  ];
  const standing = computeStageRaceStanding(rows, "team-1");
  assert.equal(standing.final, false);
  assert.equal(standing.total, 2);
  assert.equal(standing.rank, 2); // rival's 3-best gap sum is lower
});

test("computeStageRaceStanding — a single rank-1 jersey row (no full snapshot) can't derive a standing", () => {
  const rows = [{ result_type: "leader", stage_number: 1, rank: 1, team_id: "rival" }];
  assert.equal(computeStageRaceStanding(rows, "team-1"), null);
});

test("computeStageRaceStanding — my team has no row in the final classification → null", () => {
  const rows = [
    { result_type: "team", stage_number: 1, rank: 1, team_id: "rival" },
  ];
  assert.equal(computeStageRaceStanding(rows, "team-1"), null);
});

test("todayStageWinner — finds the rank-1 stage result for the given race+stage", () => {
  const rows = [
    { race_id: "race-a", stage_number: 3, result_type: "stage", rank: 2, rider_name: "Second" },
    { race_id: "race-a", stage_number: 3, result_type: "stage", rank: 1, rider_name: "Winner" },
    { race_id: "race-a", stage_number: 2, result_type: "stage", rank: 1, rider_name: "Wrong stage" },
    { race_id: "race-b", stage_number: 3, result_type: "stage", rank: 1, rider_name: "Wrong race" },
  ];
  assert.equal(todayStageWinner(rows, "race-a", 3), "Winner");
});

test("todayStageWinner — no rank-1 stage row yet → null", () => {
  assert.equal(todayStageWinner([], "race-a", 1), null);
  assert.equal(todayStageWinner(null, "race-a", 1), null);
});

test("entryCountFor — counts race_entries rows for one race", () => {
  const rows = [{ race_id: "race-a" }, { race_id: "race-a" }, { race_id: "race-b" }];
  assert.equal(entryCountFor(rows, "race-a"), 2);
  assert.equal(entryCountFor(rows, "race-c"), 0);
  assert.equal(entryCountFor(null, "race-a"), 0);
});
