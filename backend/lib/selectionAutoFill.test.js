import test from "node:test";
import assert from "node:assert/strict";

import { pickAutoSelection } from "./selectionAutoFill.js";

// #2180 · one-click auto-udtag: ren udvælgelses-kerne (ét hold, ét løb).
// Fixture-stil spejler raceEntryGenerator.test.js (samme underliggende motor,
// assignTeamAcrossRaces), så assertionerne er sammenlignelige.

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const riders = Array.from({ length: 10 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 3), fatigue: 0 }));

test("pickAutoSelection: ingen race → tom liste (defensiv)", () => {
  assert.deepEqual(pickAutoSelection({ candidateRiders: riders, race: null, stages: [flat] }), []);
});

test("pickAutoSelection: bygger en fuld trup (6) med præcis én kaptajn for et Class2-løb", () => {
  const picks = pickAutoSelection({ candidateRiders: riders, race: { id: "race-1", race_class: "Class2" }, stages: [flat] });
  assert.equal(picks.length, 6);
  assert.equal(picks.filter((p) => p.race_role === "captain").length, 1);
  const ids = new Set(picks.map((p) => p.rider_id));
  assert.equal(ids.size, 6, "ingen dubletter");
});

test("pickAutoSelection: for få ledige ryttere → mindre trup, ingen crash", () => {
  const picks = pickAutoSelection({ candidateRiders: riders.slice(0, 3), race: { id: "race-1", race_class: "Class2" }, stages: [flat] });
  assert.equal(picks.length, 3);
});

test("pickAutoSelection: ryttere bundet i et OVERLAPPENDE andet løb (lockedWindows) udelukkes", () => {
  const thisWindow = { start: 100, end: 200 };
  // r0..r4 er allerede bundet i et løb der overlapper dette (100-250).
  const lockedWindows = [{ window: { start: 100, end: 250 }, riderIds: ["r0", "r1", "r2", "r3", "r4"] }];
  const picks = pickAutoSelection({
    candidateRiders: riders, race: { id: "race-1", race_class: "Class2" }, stages: [flat],
    thisWindow, lockedWindows,
  });
  const pickedIds = new Set(picks.map((p) => p.rider_id));
  for (const bound of ["r0", "r1", "r2", "r3", "r4"]) {
    assert.ok(!pickedIds.has(bound), `${bound} skulle være udelukket (bundet i andet løb)`);
  }
  assert.equal(picks.length, 5, "kun de 5 ledige ryttere kan vælges");
});

test("pickAutoSelection: ryttere bundet i et IKKE-overlappende andet løb er stadig valgbare", () => {
  const thisWindow = { start: 100, end: 200 };
  const lockedWindows = [{ window: { start: 500, end: 600 }, riderIds: ["r0", "r1"] }]; // intet overlap
  const picks = pickAutoSelection({
    candidateRiders: riders, race: { id: "race-1", race_class: "Class2" }, stages: [flat],
    thisWindow, lockedWindows,
  });
  assert.equal(picks.length, 6, "ingen af rytterne er reelt optaget — fuld trup som normalt");
});

test("pickAutoSelection: ingen kandidat-ryttere → tom liste", () => {
  assert.deepEqual(
    pickAutoSelection({ candidateRiders: [], race: { id: "race-1", race_class: "Class2" }, stages: [flat] }),
    []
  );
});

test("pickAutoSelection: respekterer race_class-feltstørrelsen (TourFrance = 8)", () => {
  const bigRoster = Array.from({ length: 12 }, (_, i) => ({ rider_id: `s${i}`, abilities: ab(70 - i), fatigue: 0 }));
  const picks = pickAutoSelection({ candidateRiders: bigRoster, race: { id: "race-1", race_class: "TourFrance" }, stages: [flat] });
  assert.equal(picks.length, 8);
});
