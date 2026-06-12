import test from "node:test";
import assert from "node:assert/strict";
import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  ...over,
});
const flatStage = { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const mtnStage = { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, endurance: 0.1, randomness: 0.4 } };
const riders = (n, f = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ rider_id: `r${String(i).padStart(2, "0")}`, abilities: ab(f(i)), fatigue: 0 }));

test("selectionSizeForRace: GT = 8/8, øvrige 6-8", () => {
  assert.deepEqual(selectionSizeForRace({ race_class: "TourFrance" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "GiroVuelta" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "ProSeries" }), { min: 6, max: 8 });
  assert.deepEqual(selectionSizeForRace({}), { min: 6, max: 8 });
});

test("autopick: vælger max-antal bedst egnede + kaptajn = mest egnede", () => {
  // r00 har klart bedst klatring → mest egnet til mountain-løbet.
  const pool = riders(15, (i) => ({ climbing: 90 - i * 3 }));
  const picks = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.equal(picks.length, 8);
  const captain = picks.find((p) => p.race_role === "captain");
  assert.equal(captain.rider_id, "r00");
  assert.equal(picks.filter((p) => p.race_role === "captain").length, 1);
});

test("autopick: sprint_captain sættes når løbet har flade etaper og topsprinteren ikke er kaptajn", () => {
  const pool = riders(12, (i) => (i === 5 ? { sprint: 95 } : { climbing: 80 - i * 2 }));
  const picks = autopickTeamSelection({ riders: pool, stages: [flatStage, mtnStage], sizeRule: { min: 6, max: 8 } });
  const sprintCap = picks.find((p) => p.race_role === "sprint_captain");
  assert.ok(sprintCap, "sprint_captain skal sættes");
  assert.equal(sprintCap.rider_id, "r05");
});

test("autopick: lille trup → stiller alle; tom trup → tom liste; træthed nedprioriterer", () => {
  const small = autopickTeamSelection({ riders: riders(4), stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.equal(small.length, 4);
  assert.ok(small.some((p) => p.race_role === "captain"));
  assert.deepEqual(autopickTeamSelection({ riders: [], stages: [flatStage], sizeRule: { min: 6, max: 8 } }), []);

  const tired = riders(10, (i) => ({ sprint: 70 }));
  tired[0].fatigue = 100; // ellers identisk med resten → skal fravælges først
  const picks = autopickTeamSelection({ riders: tired, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(!picks.some((p) => p.rider_id === "r00"), "udmattet rytter fravælges når ens alternativer findes");
});

test("autopick: deterministisk uafhængigt af input-rækkefølge", () => {
  const pool = riders(20, (i) => ({ climbing: (i * 7) % 40 + 40 }));
  const a = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  const b = autopickTeamSelection({ riders: [...pool].reverse(), stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.deepEqual(a, b);
});
