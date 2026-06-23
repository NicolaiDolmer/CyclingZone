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

test("selectionSizeForRace: 8 (GT), 7 (WorldTour), 6 (øvrige), default 6-8 (ukendt klasse)", () => {
  assert.deepEqual(selectionSizeForRace({ race_class: "TourFrance" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "GiroVuelta" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "Monuments" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "OtherWorldTourA" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "OtherWorldTourC" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "ProSeries" }), { min: 6, max: 6 });
  assert.deepEqual(selectionSizeForRace({ race_class: "Class1" }), { min: 6, max: 6 });
  // Ukendt/manglende klasse → generøs default-fallback (uændret adfærd for legacy/test-løb).
  assert.deepEqual(selectionSizeForRace({ race_class: null }), { min: 6, max: 8 });
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

  const tired = riders(10, (_i) => ({ sprint: 70 }));
  tired[0].fatigue = 100; // ellers identisk med resten → skal fravælges først
  const picks = autopickTeamSelection({ riders: tired, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(!picks.some((p) => p.rider_id === "r00"), "udmattet rytter fravælges når ens alternativer findes");
});

test("autopick: fatigue-damping (0.3) er den afgørende faktor — udmattet topstjerne taber til frisk rival", () => {
  // Flat race: sprint 0.8, endurance 0.2. ABILITY_MAX = 99.
  // Tired star (sprint=90, fatigue=100):
  //   terrainScore ≈ (90/99)×0.8 + (50/99)×0.2 ≈ 0.6828
  //   freshness = 1 - (100/100)×0.3 = 0.7  → effective ≈ 0.4780
  // Fresh rivals (sprint=70, fatigue=0):
  //   terrainScore ≈ (70/99)×0.8 + (50/99)×0.2 ≈ 0.6667
  //   freshness = 1.0                         → effective ≈ 0.6667
  // 0.4780 < 0.6667 → star must drop out of top-8 (pool = 9, max=8)
  const freshRivals = riders(8, () => ({ sprint: 70 }));
  const tiredStar = { rider_id: "star", abilities: ab({ sprint: 90 }), fatigue: 100 };
  const pool = [tiredStar, ...freshRivals];

  // Variant A: tired star — should be excluded
  const picksWithFatigue = autopickTeamSelection({ riders: pool, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(!picksWithFatigue.some((p) => p.rider_id === "star"),
    "udmattet topstjerne (fatigue=100) skal ekskluderes fra top-8 når fresh rivals scorer højere");

  // Variant B (kontrol): same star with fatigue=0 — should be included and top scorer
  const freshStar = { rider_id: "star", abilities: ab({ sprint: 90 }), fatigue: 0 };
  const controlPool = [freshStar, ...freshRivals];
  const picksWithoutFatigue = autopickTeamSelection({ riders: controlPool, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(picksWithoutFatigue.some((p) => p.rider_id === "star"),
    "frisk topstjerne (fatigue=0) skal inkluderes — damping er den afgørende forskel");
});

test("autopick: all-flat løb → én kaptajn (bedste sprinter), sprint_captain=null", () => {
  // Kun flade etaper → gcStages() falder tilbage til alle stages (alle flat)
  // → captain = bedste på flat stages = bedste sprinter
  // → ingen separate non-flat stages → sprint_captain skal IKKE sættes
  const pool = [
    { rider_id: "best-sprinter", abilities: ab({ sprint: 95 }), fatigue: 0 },
    { rider_id: "mid-sprinter",  abilities: ab({ sprint: 75 }), fatigue: 0 },
    ...riders(6, () => ({ sprint: 60 })),
  ];
  const picks = autopickTeamSelection({ riders: pool, stages: [flatStage], sizeRule: { min: 6, max: 8 } });

  const captains = picks.filter((p) => p.race_role === "captain");
  const sprintCaptains = picks.filter((p) => p.race_role === "sprint_captain");

  assert.equal(captains.length, 1, "præcis én kaptajn");
  assert.equal(captains[0].rider_id, "best-sprinter", "kaptajn = bedste sprinter");
  assert.equal(sprintCaptains.length, 0, "sprint_captain = null/ingen når kaptajn allerede er bedste sprinter");
});

test("autopick: deterministisk uafhængigt af input-rækkefølge", () => {
  const pool = riders(20, (i) => ({ climbing: (i * 7) % 40 + 40 }));
  const a = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  const b = autopickTeamSelection({ riders: [...pool].reverse(), stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.deepEqual(a, b);
});
