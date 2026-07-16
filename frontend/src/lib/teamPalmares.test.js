import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeasonHistory, teamCareerTotals, groupHallOfFame } from "./teamPalmares.js";

// Ægte season_standings-shape (join season:season_id(number,status),
// verificeret mod database/schema.sql 16/7). 3 sæsoner: forfremmet S1→S2
// (division 3→2), nedrykket S2→S3 (division 2→3).
const ROWS = [
  { id: "r1", season: { number: 1, status: "completed" }, division: 3, league_division_id: 10, rank_in_division: 2, total_points: 1200, races_completed: 40, stage_wins: 3, gc_wins: 1 },
  { id: "r2", season: { number: 2, status: "completed" }, division: 2, league_division_id: 5, rank_in_division: 1, total_points: 2100, races_completed: 45, stage_wins: 5, gc_wins: 2 },
  { id: "r3", season: { number: 3, status: "active" }, division: 3, league_division_id: 11, rank_in_division: 6, total_points: 300, races_completed: 10, stage_wins: 0, gc_wins: 0 },
];

test("buildSeasonHistory: nyeste sæson først, movement udledt af divisionsændring", () => {
  const history = buildSeasonHistory(ROWS);
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((h) => h.season.number), [3, 2, 1]);

  const s1 = history.find((h) => h.season.number === 1);
  const s2 = history.find((h) => h.season.number === 2);
  const s3 = history.find((h) => h.season.number === 3);
  assert.equal(s1.movement, null, "første registrerede sæson har intet at sammenligne med");
  assert.equal(s2.movement, "promoted", "division 3 → 2 er en forfremmelse (lavere tal = højere niveau)");
  assert.equal(s3.movement, "relegated", "division 2 → 3 er en nedrykning");
});

test("buildSeasonHistory: uændret division giver maintained", () => {
  const rows = [
    { season: { number: 1 }, division: 2, rank_in_division: 3 },
    { season: { number: 2 }, division: 2, rank_in_division: 2 },
  ];
  const history = buildSeasonHistory(rows);
  assert.equal(history.find((h) => h.season.number === 2).movement, "maintained");
});

test("buildSeasonHistory: rækker uden season.number filtreres væk", () => {
  const rows = [...ROWS, { id: "orphan", season: null, division: 4 }];
  assert.equal(buildSeasonHistory(rows).length, 3);
});

test("teamCareerTotals: sejre summeret pr. sæson, bedste sæson = laveste division + laveste rank", () => {
  const totals = teamCareerTotals(ROWS);
  assert.equal(totals.seasonsPlayed, 3);
  assert.equal(totals.stageWins, 8);
  assert.equal(totals.gcWins, 3);
  assert.equal(totals.totalWins, 11);
  assert.equal(totals.totalPoints, 3600);
  assert.equal(totals.bestDivision, 2, "S2 (division 2) er bedste division på tværs af karrieren");
  assert.equal(totals.bestRank, 1, "S2 var #1 i sin pulje");
});

test("teamCareerTotals: tomt input giver nulstillede totaler uden at kaste", () => {
  const totals = teamCareerTotals([]);
  assert.equal(totals.seasonsPlayed, 0);
  assert.equal(totals.totalWins, 0);
  assert.equal(totals.bestDivision, null);
  assert.equal(totals.bestRank, null);
});

test("groupHallOfFame: sorteret nyeste sæson først", () => {
  const hof = groupHallOfFame([
    { id: "a", category: "most_points_season", value: 1200, season_number: 1 },
    { id: "b", category: "most_div1_titles", value: 1, season_number: 3 },
    { id: "c", category: "most_stage_wins_season", value: 5, season_number: 2 },
  ]);
  assert.deepEqual(hof.map((h) => h.id), ["b", "c", "a"]);
});
