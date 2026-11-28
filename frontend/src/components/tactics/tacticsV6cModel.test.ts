import test from "node:test";
import assert from "node:assert/strict";
import {
  dayLoadOfEffort, dayLoadOfLegs, fatigueTone, legsFromParts, levelOfEffort,
  partTaskOptions, partTasks, routeParts, setPartTask, todayTasks, withLockedRiders, effortForLevel,
} from "./tacticsV6cModel.ts";
import { validateStagePlanLegs, type StagePlanRoute } from "../race/StagePlanModel.ts";

// Wireframets etape 2: to stigninger undervejs og topafslutning (topafslutningen er ikke et skift-punkt).
const route: StagePlanRoute = {
  distance_km: 175, profile_type: "high_mountain", summit_finish: true,
  climbs: [{ index: 0, km: 87, name: "Salita di Bondone", category: "1" }, { index: 1, km: 123, name: "Cima Zoncolan", category: "1" }],
};
const named = [
  { km: 87, name: "Salita di Bondone", summit: false },
  { km: 123, name: "Cima Zoncolan", summit: false },
  { km: 175, name: "Monte Zoncolaro", summit: true },
];
const parts = routeParts(route, named);

test("#8828: hver stigning er en rutedel, også den midterste (K1); topafslutningen efter den sidste", () => {
  assert.deepEqual(parts.map((p) => p.label), [
    { key: "toClimb", name: "Salita di Bondone" },
    { key: "toClimb", name: "Cima Zoncolan" },
    { key: "toClimb", name: "Monte Zoncolaro" },
    { key: "lastTen" },
  ]);
  assert.deepEqual(parts.map((p) => p.from), [null, { at: "kom", kom_index: 0 }, { at: "kom", kom_index: 1 }, { at: "final_km" }]);
});

test("#8828: tre stigninger uden topafslutning viser alle tre; en stigning uden navn vises med kategori og km", () => {
  const three: StagePlanRoute = {
    distance_km: 180, profile_type: "hilly",
    climbs: [
      { index: 0, km: 40, name: "Côte A", category: "3" },
      { index: 1, km: 87.4, name: null, category: "2" },
      { index: 2, km: 150, name: "Côte C", category: "1" },
    ],
  };
  const p3 = routeParts(three, [{ km: 40, name: "Côte A", summit: false }, { km: 87.4, name: null, summit: false }, { km: 150, name: "Côte C", summit: false }]);
  assert.deepEqual(p3.map((p) => p.label), [
    { key: "toClimb", name: "Côte A" },
    { key: "toClimbUnnamed", category: "2", km: 87 },
    { key: "toClimb", name: "Côte C" },
    { key: "toLastTen" },
    { key: "lastTen" },
  ]);
  // Den midterste stignings top er et skift-punkt, kæden kan gemmes med.
  const legs = legsFromParts(["stay_sheltered", "stay_sheltered", "follow_moves", "follow_moves", "ride_for_result"], p3, "captain", three);
  assert.deepEqual(legs, [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 1 } }, { task: "ride_for_result", from: { at: "final_km" } }]);
  assert.equal(validateStagePlanLegs(legs, "captain", three), null);
});

test("#8828: én stigning giver samme dele som før", () => {
  const one: StagePlanRoute = { distance_km: 160, profile_type: "hilly", climbs: [{ index: 0, km: 70, name: "Côte A", category: "3" }] };
  assert.deepEqual(routeParts(one, [{ km: 70, name: "Côte A", summit: false }]).map((p) => p.label), [
    { key: "toClimb", name: "Côte A" }, { key: "toLastTen" }, { key: "lastTen" },
  ]);
});

test("en flad etape har to dele", () => {
  const flat: StagePlanRoute = { distance_km: 180, profile_type: "flat", climbs: [] };
  assert.deepEqual(routeParts(flat).map((p) => p.label.key), ["toLastTen", "lastTen"]);
});

test("kæden fra rutedelene er gyldig og læses tilbage ens", () => {
  const tasks = ["shelter_leader", "tempo", "tempo", "tempo"] as const;
  const legs = legsFromParts([...tasks], parts, "helper", route);
  assert.deepEqual(legs, [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }]);
  assert.equal(validateStagePlanLegs(legs, "helper", route), null);
  assert.deepEqual(partTasks(legs, route, parts), [...tasks]);
});

test("en afsluttende opgave gælder resten af ruten", () => {
  assert.deepEqual(setPartTask(["stay_sheltered", "stay_sheltered", "stay_sheltered"], 1, "grupetto"), ["stay_sheltered", "grupetto", "grupetto"]);
});

test("rutedelens valg følger rollen", () => {
  const opts = partTaskOptions(["stay_sheltered", "stay_sheltered", "ride_for_result"], 2, parts, "captain", route);
  assert.ok(opts.includes("attack"));
  assert.ok(!opts.includes("tempo"));
  assert.ok(!partTaskOptions(["stay_sheltered", "stay_sheltered", "stay_sheltered"], 1, parts, "helper", route).includes("breakaway"));
});

test("uden etapeplan er valgene indsats-trin", () => {
  assert.equal(levelOfEffort("grupetto"), "easy");
  assert.equal(levelOfEffort("normal"), "medium");
  assert.equal(levelOfEffort("all_out"), "hard");
  assert.equal(effortForLevel("hard", ["save", "normal", "all_out"]), "all_out");
  assert.equal(effortForLevel("easy", ["grupetto", "save", "normal", "protect", "all_out"]), "save");
});

test("Day load følger planens hårdeste opgave; udbruddet er mindst en hård dag", () => {
  assert.equal(dayLoadOfLegs([{ task: "grupetto" }]), "easy");
  assert.equal(dayLoadOfLegs([{ task: "stay_sheltered" }, { task: "ride_in", from: { at: "final_km" } }]), "light");
  assert.equal(dayLoadOfLegs([{ task: "shelter_leader" }]), "normal");
  assert.equal(dayLoadOfLegs([{ task: "shelter_leader" }, { task: "tempo", from: { at: "final_km" } }]), "hard");
  assert.equal(dayLoadOfLegs([{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }]), "veryHard");
  assert.equal(dayLoadOfLegs([{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }]), "hard");
  assert.equal(dayLoadOfEffort("protect", true), "light");
  assert.equal(dayLoadOfEffort("protect", false), "hard");
});

test("trætheds-skalaen er neutral, rav, rød", () => {
  assert.equal(fatigueTone(20).tone, "neutral");
  assert.equal(fatigueTone(50).tone, "amber");
  assert.equal(fatigueTone(80).tone, "red");
  assert.equal(fatigueTone(null).tone, "neutral");
});

test("dagens linje viser opgaver fra starten til finalen og udelader ordren ved afsætning", () => {
  assert.deepEqual(todayTasks([
    { task: "follow_moves" },
    { task: "ride_in", from: { at: "final_km" } },
    { task: "grupetto", from: { at: "dropped" } },
  ], [], null), [{ key: "follow_moves" }, { key: "ride_in" }]);
  assert.deepEqual(todayTasks([
    { task: "breakaway" },
    { task: "attack", from: { at: "final_km" } },
  ], [], null), [{ key: "breakaway" }, { key: "attackFinale" }]);
  assert.deepEqual(todayTasks([
    { task: "attack" },
    { task: "ride_in", from: { at: "final_km" } },
  ], [{ index: 1, km: 75, name: "Monte Zoncolaro", category: "1" }], null), [{ key: "attackUnspecified" }, { key: "ride_in" }]);
  assert.deepEqual(todayTasks([
    { task: "stay_sheltered" },
    { task: "attack", from: { at: "kom", kom_index: 0 } },
  ], [{ index: 0, km: 25, name: "Col du Verger", category: "2" }, { index: 1, km: 75, name: "Monte Zoncolaro", category: "1" }], null),
  [{ key: "stay_sheltered" }, { key: "attack", climb: "Col du Verger" }]);
  assert.deepEqual(todayTasks([{ task: "shelter_leader" }], [], "Yamada"), [{ key: "shelterLeader", leader: "Yamada" }]);
});

test("låste ryttere beholder deres række, når holdplanen lægges på", () => {
  const current = { riders: [{ rider_id: "a", plan: [{ task: "attack" }] }, { rider_id: "b", plan: null }] };
  const plan = { riders: [{ rider_id: "a", plan: [{ task: "stay_sheltered" }] }, { rider_id: "b", plan: [{ task: "tempo" }] }] };
  assert.deepEqual(withLockedRiders(plan, current, new Set(["a"])).riders, [{ rider_id: "a", plan: [{ task: "attack" }] }, { rider_id: "b", plan: [{ task: "tempo" }] }]);
});

test("Codex P1: en ændring i én rutedel flytter aldrig ordrer i en anden (skift-punkter bevares)", () => {
  // Angreb fra den ANDEN stigning (km 123); #8828: den er nu sin egen rutedel.
  const saved = [{ task: "stay_sheltered" as const }, { task: "attack" as const, from: { at: "kom" as const, kom_index: 1 } }];
  const tasks = partTasks(saved, route, parts)!;
  assert.deepEqual(tasks, ["stay_sheltered", "stay_sheltered", "attack", "attack"]);
  const next = setPartTask(tasks, 3, "ride_in");
  const legs = legsFromParts(next, parts, "captain", route, null, saved);
  assert.deepEqual(legs, [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: 1 } }, { task: "ride_in", from: { at: "final_km" } }]);
  assert.equal(validateStagePlanLegs(legs, "captain", route), null);
  // Uden ændring er kæden uændret.
  assert.deepEqual(legsFromParts(tasks, parts, "captain", route, null, saved), saved);
});

test("Codex P1: et uændret første led beholder trøjejagten (hunt), når en senere rutedel ændres", () => {
  const huntRoute: StagePlanRoute = { ...route, jersey_hunt_7855: true, sprints: [{ index: 0, km: 60, name: null }] };
  const huntParts = routeParts(huntRoute, named);
  const saved = [{ task: "breakaway" as const, hunt: "hunt_points" as const }];
  assert.equal(validateStagePlanLegs(saved, "hunter", huntRoute), null);
  const tasks = partTasks(saved, huntRoute, huntParts)!;
  const legs = legsFromParts(setPartTask(tasks, 2, "ride_in"), huntParts, "hunter", huntRoute, null, saved);
  assert.deepEqual(legs[0], { task: "breakaway", hunt: "hunt_points" });
  assert.equal(legs[legs.length - 1].task, "ride_in");
  assert.equal(validateStagePlanLegs(legs, "hunter", huntRoute), null);
  // Uden ændring er kæden uændret, også med jagten.
  assert.deepEqual(legsFromParts(tasks, huntParts, "hunter", huntRoute, null, saved), saved);
});
