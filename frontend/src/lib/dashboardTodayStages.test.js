import { test } from "node:test";
import assert from "node:assert/strict";
import {
  terrainGlyphBucket,
  computeStageRaceStanding,
  todayStageWinner,
  entryCountFor,
  mergeStandingRowsByRace,
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

test("todayStageWinner — stage race: finds the rank-1 stage result for the given race+stage", () => {
  const rows = [
    { race_id: "race-a", stage_number: 3, result_type: "stage", rank: 2, rider_name: "Second" },
    { race_id: "race-a", stage_number: 3, result_type: "stage", rank: 1, rider_name: "Winner" },
    { race_id: "race-a", stage_number: 2, result_type: "stage", rank: 1, rider_name: "Wrong stage" },
    { race_id: "race-b", stage_number: 3, result_type: "stage", rank: 1, rider_name: "Wrong race" },
  ];
  assert.equal(todayStageWinner(rows, { raceId: "race-a", raceType: "stage_race", stageNumber: 3 }), "Winner");
});

test("todayStageWinner — no rank-1 row yet → null", () => {
  assert.equal(todayStageWinner([], { raceId: "race-a", raceType: "stage_race", stageNumber: 1 }), null);
  assert.equal(todayStageWinner(null, { raceId: "race-a", raceType: "single", stageNumber: 1 }), null);
});

// #5601: the engine writes a one-day race's result ONLY as result_type 'gc'
// on stage_number 1 — never 'stage'. Before the fix every finished one-day
// card said "No results" (380 cards 23/9).
test("todayStageWinner — one-day race: the rank-1 'gc' row is the winner (#5601)", () => {
  const rows = [
    { race_id: "classic", stage_number: 1, result_type: "gc", rank: 1, rider_name: "Classic winner" },
    { race_id: "classic", stage_number: 1, result_type: "gc", rank: 2, rider_name: "Classic second" },
  ];
  assert.equal(todayStageWinner(rows, { raceId: "classic", raceType: "single", stageNumber: 1 }), "Classic winner");
});

test("todayStageWinner — a stage race's final-stage 'gc' row is never the stage winner (#5601)", () => {
  const gcOnly = [
    { race_id: "tour", stage_number: 5, result_type: "gc", rank: 1, rider_name: "Overall winner" },
  ];
  const ref = { raceId: "tour", raceType: "stage_race", stageNumber: 5 };
  // Only the overall row has landed → still no stage winner, not the GC winner.
  assert.equal(todayStageWinner(gcOnly, ref), null);
  const both = [
    ...gcOnly,
    { race_id: "tour", stage_number: 5, result_type: "stage", rank: 1, rider_name: "Stage winner" },
  ];
  assert.equal(todayStageWinner(both, ref), "Stage winner");
});

test("entryCountFor — counts race_entries rows for one race", () => {
  const rows = [{ race_id: "race-a" }, { race_id: "race-a" }, { race_id: "race-b" }];
  assert.equal(entryCountFor(rows, "race-a"), 2);
  assert.equal(entryCountFor(rows, "race-c"), 0);
  assert.equal(entryCountFor(null, "race-a"), 0);
});

// #5589: mergeStandingRowsByRace combines N per-race "placering" query
// results (each individually bounded to ONE race + ONE stage_number, so each
// is far under PostgREST's 1000-row cap) into a single in-memory map. Three
// races with 400 rows each (1200 total, over the cap) demonstrate that the
// merge is safe: the cap applies per HTTP response, never to this JS array.
test("mergeStandingRowsByRace — merges three races' results (1.200 rows combined, over the 1.000-row cap) without loss or mixing", () => {
  const makeRows = (raceId, n) =>
    Array.from({ length: n }, (_, i) => ({ race_id: raceId, rank: i + 1, team_id: `${raceId}-team-${i}` }));

  const standingRaces = [
    { id: "race-a", stages_completed: 4 },
    { id: "race-b", stages_completed: 7 },
    { id: "race-c", stages_completed: 2 },
  ];
  const standingResults = [
    { data: makeRows("race-a", 400), error: null },
    { data: makeRows("race-b", 400), error: null },
    { data: makeRows("race-c", 400), error: null },
  ];

  const byRace = mergeStandingRowsByRace(standingRaces, standingResults);

  assert.equal(byRace.size, 3);
  assert.equal(byRace.get("race-a").length, 400);
  assert.equal(byRace.get("race-b").length, 400);
  assert.equal(byRace.get("race-c").length, 400);
  const totalRows = [...byRace.values()].reduce((sum, rows) => sum + rows.length, 0);
  assert.ok(totalRows > 1000, `forventede >1000 rækker kombineret (viser at PostgREST-loftet ikke rammer den samlede merge), fik ${totalRows}`);
  // Ingen sammenblanding: hvert løbs rækker matcher kun dets eget race_id.
  for (const race of standingRaces) {
    assert.ok(byRace.get(race.id).every((r) => r.race_id === race.id));
  }
});

test("mergeStandingRowsByRace — missing/undefined data falls back to an empty array per race", () => {
  const standingRaces = [{ id: "race-a", stages_completed: 1 }];
  const standingResults = [{ data: null, error: null }];
  const byRace = mergeStandingRowsByRace(standingRaces, standingResults);
  assert.deepEqual(byRace.get("race-a"), []);
});
