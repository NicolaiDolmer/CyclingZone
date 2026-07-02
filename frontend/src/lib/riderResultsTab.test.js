import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRiderRaces, racesForSeason, riderResultTotals, seasonsInRaces } from "./riderResultsTab.js";

// Formet efter ægte prod-rækker (Vuelta Burgalesa + Giro Emiliano, verificeret
// 2026-07-03): etapeløb med GC-sejr, 2 etapesejre, 3 trøjer, leder-dage — plus
// et endagsløb med en ren gc-række.
const stageRace = { id: "vb", name: "Vuelta Burgalesa", race_type: "stage_race", race_class: "ProSeries", stages: 5, status: "completed", scheduled_for: "2026-06-29T18:00:00Z", season: { number: 1 }, pool: { terrain_archetype: "mountain_tour" } };
const single = { id: "ge", name: "Giro Emiliano", race_type: "single", race_class: "ProSeries", stages: 1, status: "completed", scheduled_for: "2026-07-02T18:00:00Z", season: { number: 1 }, pool: { terrain_archetype: "puncheur" } };

const ROWS = [
  { race: stageRace, result_type: "gc", stage_number: 5, rank: 1, points_earned: 260, prize_money: 19500 },
  { race: stageRace, result_type: "stage", stage_number: 1, rank: 22, points_earned: 0, prize_money: 0 },
  { race: stageRace, result_type: "stage", stage_number: 2, rank: 2, points_earned: 32, prize_money: 2400 },
  { race: stageRace, result_type: "stage", stage_number: 4, rank: 1, points_earned: 43, prize_money: 3225 },
  { race: stageRace, result_type: "stage", stage_number: 5, rank: 1, points_earned: 43, prize_money: 3225 },
  { race: stageRace, result_type: "stage", stage_number: 3, rank: 2, points_earned: 32, prize_money: 2400 },
  { race: stageRace, result_type: "points", stage_number: 5, rank: 1, points_earned: 107, prize_money: 8025 },
  { race: stageRace, result_type: "mountain", stage_number: 5, rank: 1, points_earned: 107, prize_money: 8025 },
  { race: stageRace, result_type: "young", stage_number: 5, rank: 1, points_earned: 53, prize_money: 3975 },
  { race: stageRace, result_type: "leader", stage_number: 3, rank: 1, points_earned: 5, prize_money: 375 },
  { race: stageRace, result_type: "mountain_day", stage_number: 4, rank: 1, points_earned: 3, prize_money: 225 },
  { race: single, result_type: "gc", stage_number: 1, rank: 4, points_earned: 80, prize_money: 6000 },
];

test("groupRiderRaces grupperer pr. løb, nyeste først, etaper sorteret", () => {
  const races = groupRiderRaces(ROWS);
  assert.equal(races.length, 2);
  assert.equal(races[0].raceId, "ge", "nyeste løb først");
  const vb = races[1];
  assert.equal(vb.finalRank, 1);
  assert.equal(vb.gcPoints, 260, "Samlet (GC)-underrækken viser gc-rækkens egne point");
  assert.equal(vb.gcPrize, 19500);
  assert.deepEqual(vb.stageRows.map((s) => s.stage), [1, 2, 3, 4, 5]);
  assert.equal(vb.terrain, "mountain_tour");
  assert.equal(vb.jerseys.points, 1);
  assert.equal(vb.jerseys.mountain, 1);
  assert.equal(vb.jerseys.young, 1);
});

test("point/præmie pr. løb summerer alle rækker inkl. trøje-dage", () => {
  const vb = groupRiderRaces(ROWS).find((r) => r.raceId === "vb");
  assert.equal(vb.points, 260 + 32 + 43 + 43 + 32 + 107 + 107 + 53 + 5 + 3);
  assert.equal(vb.prize, 19500 + 2400 + 3225 + 3225 + 2400 + 8025 + 8025 + 3975 + 375 + 225);
});

test("team-rækker og rækker uden race-id filtreres fra", () => {
  const races = groupRiderRaces([
    { race: single, result_type: "team", rank: 1, points_earned: 999, prize_money: 999 },
    { race: null, result_type: "gc", rank: 1 },
    ...ROWS,
  ]);
  assert.equal(races.length, 2);
  assert.equal(races.find((r) => r.raceId === "ge").points, 80, "team-rækkens point tæller ikke med");
});

test("riderResultTotals: sejre/top5/trøjer/point/præmie", () => {
  const races = groupRiderRaces(ROWS);
  const t = riderResultTotals(races);
  assert.equal(t.races, 2);
  assert.equal(t.wins, 3, "2 etapesejre + 1 GC-sejr (endagsløbets 4.-plads er ingen sejr)");
  assert.equal(t.top5, 2, "GC 1 + endagsløb 4");
  assert.equal(t.jerseys, 3, "point + bjerg + ungdom");
  assert.equal(t.points, 685 + 80);
  assert.equal(t.prize, 51375 + 6000);
});

test("igangværende etapeløb uden gc-række: finalRank null, tæller ikke som top5", () => {
  const active = { ...stageRace, id: "act", status: "active" };
  const races = groupRiderRaces([
    { race: active, result_type: "stage", stage_number: 1, rank: 3, points_earned: 20, prize_money: 900 },
  ]);
  assert.equal(races[0].finalRank, null);
  const t = riderResultTotals(races);
  assert.equal(t.top5, 0);
  assert.equal(t.races, 1);
});

test("sæsonfilter + sæsonliste", () => {
  const s2race = { ...single, id: "s2", season: { number: 2 }, scheduled_for: "2026-08-01T18:00:00Z" };
  const races = groupRiderRaces([...ROWS, { race: s2race, result_type: "gc", rank: 9, points_earned: 10, prize_money: 0 }]);
  assert.deepEqual(seasonsInRaces(races), [2, 1]);
  assert.equal(racesForSeason(races, 1).length, 2);
  assert.equal(racesForSeason(races, 2).length, 1);
  assert.equal(racesForSeason(races, null).length, 3, "null = Alle");
});

test("tom input", () => {
  assert.deepEqual(groupRiderRaces([]), []);
  assert.deepEqual(riderResultTotals([]), { wins: 0, races: 0, top5: 0, jerseys: 0, points: 0, prize: 0 });
  assert.deepEqual(seasonsInRaces([]), []);
});
