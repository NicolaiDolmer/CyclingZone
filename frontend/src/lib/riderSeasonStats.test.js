import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRiderSeasons } from "./riderSeasonStats.js";

const row = (rank, result_type, race_type, season, prize_money = 0) => ({
  rank, result_type, prize_money,
  race: { race_type, season: { number: season } },
});

test("tæller sejrstyper hver for sig og ignorerer trøje-leder-dage", () => {
  const rows = [
    row(1, "stage", "stage_race", 1, 30000),    // etapesejr
    row(1, "stage", "stage_race", 1, 30000),    // etapesejr
    row(2, "stage", "stage_race", 1, 22500),    // ikke sejr (rank 2)
    row(1, "gc", "stage_race", 1, 300000),      // GC-sejr
    row(1, "gc", "single", 1, 300000),          // klassikersejr (endagsløb)
    row(1, "points", "stage_race", 1, 48000),   // pointtrøje
    row(1, "mountain", "stage_race", 1, 48000), // bjergtrøje
    row(1, "leader", "stage_race", 1, 7500),    // trøje-leder-dag → IKKE sejr
    row(1, "points_day", "stage_race", 1, 4500),// trøje-leder-dag → IKKE sejr
    row(1, "young_day", "stage_race", 1, 4500), // trøje-leder-dag → IKKE sejr
  ];
  const s = aggregateRiderSeasons(rows)[1];
  assert.equal(s.stageWins, 2);
  assert.equal(s.gcWins, 1);
  assert.equal(s.classicWins, 1);
  assert.equal(s.pointsJerseys, 1);
  assert.equal(s.mountainJerseys, 1);
  // totalPrize summerer ALLE rækker (også trøje-dage)
  assert.equal(s.totalPrize, 30000 + 30000 + 22500 + 300000 + 300000 + 48000 + 48000 + 7500 + 4500 + 4500);
});

test("grupperer pr. sæson", () => {
  const agg = aggregateRiderSeasons([
    row(1, "stage", "stage_race", 1),
    row(1, "stage", "stage_race", 2),
    row(1, "gc", "stage_race", 2),
  ]);
  assert.equal(agg[1].stageWins, 1);
  assert.equal(agg[2].stageWins, 1);
  assert.equal(agg[2].gcWins, 1);
});

test("ukendt sæson havner under '-'", () => {
  const agg = aggregateRiderSeasons([{ rank: 1, result_type: "stage", prize_money: 0, race: null }]);
  assert.equal(agg["-"].stageWins, 1);
  assert.equal(agg["-"].season, null);
});

test("tom/ugyldig input giver tomt map", () => {
  assert.deepEqual(aggregateRiderSeasons([]), {});
  assert.deepEqual(aggregateRiderSeasons(null), {});
});
