// #6937: G16-maalefunktionen (komGcOverlap6937.mjs).
import test from "node:test";
import assert from "node:assert/strict";

import { accumulateKomStage, breakawayKomPointsOfStage, emptyKomAccount, komGcOverlap, komWinnerOf, stageRaceJerseyOutcome } from "./komGcOverlap6937.mjs";

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

test("#6937 G16-kontrakt: udbrudspoint er bjergpoint taget mens rytteren sad i dagens udbrud (segmentets gruppebillede)", () => {
  const out = {
    timeline: { events: [{ type: "breakaway_formed", km: 5, params: { rider_ids: ["brk", "brk2"] } }] },
    groupSnapshots: [
      { km: 50, groups: [{ kind: "breakaway", rider_ids: ["brk", "brk2"] }, { kind: "peloton", rider_ids: ["fav", "att"] }] },
      { km: 100, groups: [{ kind: "solo", rider_ids: ["brk"] }, { kind: "solo", rider_ids: ["att"] }, { kind: "peloton", rider_ids: ["brk2", "fav"] }] },
      { km: 150, groups: [{ kind: "peloton", rider_ids: ["brk", "brk2", "fav", "att"] }] },
    ],
    passages: [
      kom(40, [["brk", 10], ["brk2", 6], ["fav", 4]]), // udbruddet + feltets jaeger
      { kind: "sprint", km: 60, results: [{ rider_id: "brk", points: 20 }] }, // ikke bjergpoint
      kom(100, [["brk", 5], ["att", 3], ["brk2", 2]]), // brk solo fra udbruddet, att er finaleangriber fra feltet, brk2 er hentet
      kom(150, [["fav", 20], ["brk", 12]]), // topankomst efter indhentning
    ],
  };
  const m = breakawayKomPointsOfStage(out);
  assert.deepEqual(Object.fromEntries(m), { brk: 15, brk2: 6 });
  assert.equal(breakawayKomPointsOfStage(null).size, 0);
  assert.equal(breakawayKomPointsOfStage({ passages: out.passages }).size, 0, "uden gruppebillede kan intet maales");
});
