// #6937: G16-maalefunktionen (komGcOverlap6937.mjs).
import test from "node:test";
import assert from "node:assert/strict";

import { accumulateKomStage, emptyKomAccount, komGcOverlap, komWinnerOf, stageRaceJerseyOutcome } from "./komGcOverlap6937.mjs";

const kom = (km, results) => ({ kind: "kom", km, results: results.map(([rider_id, points]) => ({ rider_id, points })) });

test("#6937: topankomst, udbrudspoint og oevrige bjergpoint holdes adskilt; input muteres ikke", () => {
  const start = emptyKomAccount();
  const acc = accumulateKomStage(start, {
    passages: [kom(40, [["brk", 10], ["fav", 4]]), { kind: "sprint", km: 60, results: [{ rider_id: "brk", points: 20 }] }, kom(150, [["fav", 20]])],
    breakawayRiderIds: new Set(["brk"]),
    finishKm: 150,
  });
  assert.equal(start.points.size, 0);
  assert.equal(acc.points.get("brk"), 10);
  assert.equal(acc.points.get("fav"), 24);
  assert.equal(acc.breakawayPoints.get("brk"), 10);
  assert.equal(acc.breakawayPoints.get("fav"), undefined);
  assert.equal(acc.summitPoints.get("fav"), 20);
});

test("#6937: bjergtroejens vinder er kun blandt dem der fuldfoerte, flest point, rider_id som taerskel", () => {
  const acc = accumulateKomStage(emptyKomAccount(), { passages: [kom(10, [["b", 5], ["a", 5], ["out", 9]])], finishKm: 100 });
  assert.equal(komWinnerOf(acc, ["a", "b"]), "a");
  assert.equal(komWinnerOf(emptyKomAccount(), ["a"]), null);
});

test("#6937: G16-andelen taeller loeb hvor klassementsvinderen ogsaa vinder bjergtroejen", () => {
  const acc = accumulateKomStage(emptyKomAccount(), { passages: [kom(10, [["brk", 6]]), kom(100, [["gc", 5]])], breakawayRiderIds: new Set(["brk"]), finishKm: 100 });
  const a = stageRaceJerseyOutcome({ gcWinnerId: "gc", finisherIds: ["gc", "brk"], account: acc });
  assert.deepEqual([a.komWinnerId, a.komWinnerBreakawayPoints, a.komWinnerSummitPoints], ["brk", 6, 0]);
  const b = stageRaceJerseyOutcome({ gcWinnerId: "gc", finisherIds: ["gc"], account: acc });
  const m = komGcOverlap([a, b, null]);
  assert.equal(m.n, 2);
  assert.equal(m.gcWinsKom, 1);
  assert.equal(m.gcWinsKomShare, 0.5);
  assert.equal(m.komWinnerWithBreakawayPointsShare, 0.5);
  assert.equal(komGcOverlap([]).gcWinsKomShare, null);
});
