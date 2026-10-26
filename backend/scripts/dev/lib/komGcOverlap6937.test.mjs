// #6937: G16-maalefunktionen (komGcOverlap6937.mjs).
import test from "node:test";
import assert from "node:assert/strict";

import { accumulateKomStage, breakawayKomPointsOfStage, createJerseyLeaderTracker, emptyKomAccount, komGcOverlap, komWinnerOf, stageRaceJerseyOutcome } from "./komGcOverlap6937.mjs";

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

test("#6937 (Codex): udbruddet der smeltes sammen EFTER passagen i samme segment, tog pointene i udbrud", () => {
  const out = {
    timeline: { events: [
      { type: "breakaway_formed", km: 5, params: { rider_ids: ["brk"] } },
      { type: "group_merged", km: 60, params: { group_id: "b", into_group_id: "p", rider_ids: ["brk"] } },
    ] },
    groupSnapshots: [
      { km: 40, groups: [{ kind: "breakaway", rider_ids: ["brk"] }, { kind: "peloton", rider_ids: ["fav"] }] },
      { km: 60, groups: [{ kind: "peloton", rider_ids: ["brk", "fav"] }] },
    ],
    passages: [kom(55, [["brk", 10], ["fav", 6]])],
  };
  assert.deepEqual(Object.fromEntries(breakawayKomPointsOfStage(out)), { brk: 10 });
  // Codex #7208: en topankomst (sidste snapshot) faar ikke tilbagefoeringen; maalordenen afgoer den.
  const summit = { ...out, passages: [kom(60, [["brk", 20]])] };
  assert.equal(breakawayKomPointsOfStage(summit).size, 0);
  // Uden sammensmeltningen ved segmentets slut (hentet af jagten foer passagen) taeller det ikke.
  const caught = { ...out, timeline: { events: out.timeline.events.slice(0, 1) } };
  assert.equal(breakawayKomPointsOfStage(caught).size, 0);
});

test("#6937 (Codex #7208): en hentet udbryder der senere angriber solo fra feltet, er ikke i udbrud", () => {
  const out = {
    timeline: { events: [{ type: "breakaway_formed", km: 5, params: { rider_ids: ["brk"] } }] },
    groupSnapshots: [
      { km: 30, groups: [{ kind: "breakaway", rider_ids: ["brk"] }, { kind: "peloton", rider_ids: ["fav"] }] },
      { km: 60, groups: [{ kind: "peloton", rider_ids: ["brk", "fav"] }] },
      { km: 90, groups: [{ kind: "solo", rider_ids: ["brk"] }, { kind: "peloton", rider_ids: ["fav"] }] },
      { km: 150, groups: [{ kind: "peloton", rider_ids: ["brk", "fav"] }] },
    ],
    passages: [kom(25, [["brk", 5]]), kom(85, [["brk", 10]])],
  };
  assert.deepEqual(Object.fromEntries(breakawayKomPointsOfStage(out)), { brk: 5 });
});

test("#6937 (Codex): udbruddet bevarer sin oprindelse gennem et split til chase og finalens placeringsgruppe", () => {
  const out = {
    timeline: { events: [{ type: "breakaway_formed", km: 5, params: { rider_ids: ["b1", "b2", "b3"] } }] },
    groupSnapshots: [
      { km: 40, groups: [{ kind: "breakaway", rider_ids: ["b1", "b2", "b3"], gap_seconds: 0 }, { kind: "peloton", rider_ids: ["fav", "h"], gap_seconds: 180 }] },
      // Udbruddet splitter paa stigningen: b2+b3 bliver en chase-gruppe, stadig foran feltet.
      { km: 80, groups: [{ kind: "solo", rider_ids: ["b1"], gap_seconds: 0 }, { kind: "chase", rider_ids: ["b2", "b3"], gap_seconds: 30 }, { kind: "peloton", rider_ids: ["fav", "h"], gap_seconds: 150 }] },
      // Finalen: de overlevende udbrydere deler en placeringsgruppe kaldet "peloton"; b3 er sat af bag feltet.
      { km: 120, groups: [{ kind: "peloton", rider_ids: ["b1", "b2"], gap_seconds: 0 }, { kind: "peloton", rider_ids: ["fav", "h"], gap_seconds: 40 }, { kind: "solo", rider_ids: ["b3"], gap_seconds: 90 }] },
    ],
    passages: [kom(75, [["b1", 10], ["b2", 6], ["b3", 4]]), kom(120, [["b1", 20], ["b2", 15], ["fav", 12], ["b3", 2]])],
  };
  assert.deepEqual(Object.fromEntries(breakawayKomPointsOfStage(out)), { b1: 30, b2: 21, b3: 4 });
  // En chase-gruppe med en rytter udefra er en indhentning: oprindelsen nulstilles.
  const bridged = structuredClone(out);
  bridged.groupSnapshots[1].groups[1].rider_ids = ["b2", "b3", "h"];
  bridged.groupSnapshots[1].groups[2].rider_ids = ["fav"];
  bridged.groupSnapshots[2].groups[0].rider_ids = ["b1"];
  bridged.groupSnapshots[2].groups[1].rider_ids = ["b2", "fav", "h"];
  assert.deepEqual(Object.fromEntries(breakawayKomPointsOfStage(bridged)), { b1: 30 });
});

test("#6937 (Codex): troejefoerer-trackeren bruger passagerne, ellers den generiske fallback; bjergjaegere kun under v3", () => {
  const res = (perRider) => ({ ranked: [{ rider_id: "a", rank: 1 }, { rider_id: "b", rank: 2 }], passages: perRider ? { perRider: new Map(perRider) } : null });
  const v3 = createJerseyLeaderTracker("s5_profiles_v3", true);
  assert.equal(v3.leadersFor([{ rider_id: "a" }]), null, "foer foerste etape: ingen foerer");
  v3.addStage(res([["a", { sprint_points: 0, kom_points: 2 }], ["b", { sprint_points: 5, kom_points: 4 }]]), { profile_type: "mountain" });
  assert.deepEqual(v3.leadersFor([{ rider_id: "a" }, { rider_id: "b" }]), { points: "b", kom: "b", komHunters: ["b", "a"] });
  const v2 = createJerseyLeaderTracker("s5_profiles_v2", true);
  v2.addStage(res(null), { profile_type: "mountain" });
  const l = v2.leadersFor([{ rider_id: "a" }, { rider_id: "b" }]);
  assert.equal(l.kom, "a", "fallback: bjergpoint paa en klatreprofil");
  assert.equal("komHunters" in l, false, "under v2 ingen bjergjaegere");
  assert.equal(createJerseyLeaderTracker("s5_profiles_v3", false).leadersFor([{ rider_id: "a" }]), null, "endagsloeb: ingen foerere");
});
