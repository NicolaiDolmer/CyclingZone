import test from "node:test";
import assert from "node:assert/strict";
import {
  dayLoadOfEffort, dayLoadOfLegs, fatigueTone, legsFromParts, levelOfEffort, levelOfLegs, levelPlans,
  partTaskOptions, partTasks, routeParts, setPartTask, todayLine, withLockedRiders, effortForLevel, maxPartCost,
} from "./tacticsV6cModel.ts";
import { validateStagePlanLegs, type StagePlanRoute } from "../race/StagePlanModel.ts";
import { taskCostWord } from "../race/tacticsReady7864.ts";

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

test("rutedelene er wireframets: To første, To sidste, Last 10 km", () => {
  assert.deepEqual(parts.map((p) => p.label), [
    { key: "toClimb", name: "Salita di Bondone" },
    { key: "toClimb", name: "Monte Zoncolaro" },
    { key: "lastTen" },
  ]);
  assert.deepEqual(parts.map((p) => p.from), [null, { at: "kom", kom_index: 0 }, { at: "final_km" }]);
});

test("en flad etape har to dele", () => {
  const flat: StagePlanRoute = { distance_km: 180, profile_type: "flat", climbs: [] };
  assert.deepEqual(routeParts(flat).map((p) => p.label.key), ["toLastTen", "lastTen"]);
});

test("kæden fra rutedelene er gyldig og læses tilbage ens", () => {
  const tasks = ["shelter_leader", "tempo", "tempo"] as const;
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

test("Easy, Medium og Hard bygger gyldige kæder; Medium er aldrig hårdere end Medium", () => {
  const plans = levelPlans("captain", route, parts, true);
  for (const level of ["easy", "medium", "hard"] as const) assert.equal(validateStagePlanLegs(plans[level], "captain", route), null, level);
  assert.equal(plans.hard?.[plans.hard.length - 1].task, "attack");
  for (const role of ["captain", "helper", "hunter", "sprint_captain", "free_role"] as const) {
    const p = levelPlans(role, route, parts, true);
    const tasks = partTasks(p.medium, route, parts) ?? [];
    assert.ok(["easy", "medium"].includes(maxPartCost(tasks, taskCostWord)), `${role}: ${tasks}`);
  }
  assert.deepEqual(levelPlans("helper", route, parts, true).hard, [{ task: "tempo" }]);
});

test("ingen lyser, når rytteren følger holdets plan; ellers det valg kæden er", () => {
  const plans = levelPlans("captain", route, parts, true);
  const team = [{ task: "stay_sheltered" as const }, { task: "follow_moves" as const, from: { at: "kom" as const, kom_index: 1 } }];
  assert.equal(levelOfLegs(team, plans, team), null);
  assert.equal(levelOfLegs(plans.easy, plans, team), "easy");
  assert.equal(levelOfLegs(plans.hard, plans, team), "hard");
  assert.equal(levelOfLegs(plans.easy, plans, plans.easy), null, "holdets plan vinder, også når den er lig et valg");
  assert.equal(levelOfLegs(null, plans, team), null);
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

test("dagens linje", () => {
  assert.deepEqual(todayLine([{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }], "Monte Zoncolaro", "Yamada"), { key: "attack", climb: "Monte Zoncolaro" });
  assert.deepEqual(todayLine([{ task: "breakaway" }], null, null), { key: "breakaway" });
  assert.deepEqual(todayLine([{ task: "shelter_leader" }, { task: "grupetto", from: { at: "dropped" } }], null, "Yamada"), { key: "shelterLeader", leader: "Yamada" });
});

test("låste ryttere beholder deres række, når holdplanen lægges på", () => {
  const current = { riders: [{ rider_id: "a", plan: [{ task: "attack" }] }, { rider_id: "b", plan: null }] };
  const plan = { riders: [{ rider_id: "a", plan: [{ task: "stay_sheltered" }] }, { rider_id: "b", plan: [{ task: "tempo" }] }] };
  assert.deepEqual(withLockedRiders(plan, current, new Set(["a"])).riders, [{ rider_id: "a", plan: [{ task: "attack" }] }, { rider_id: "b", plan: [{ task: "tempo" }] }]);
});

test("Codex P1: en ændring i én rutedel flytter aldrig ordrer i en anden (skift-punkter bevares)", () => {
  // Angreb fra den ANDEN stigning (km 123) ligger inde i delen, der begynder ved den første (km 87).
  const saved = [{ task: "stay_sheltered" as const }, { task: "attack" as const, from: { at: "kom" as const, kom_index: 1 } }];
  const tasks = partTasks(saved, route, parts)!;
  assert.deepEqual(tasks, ["stay_sheltered", "attack", "attack"]);
  const next = setPartTask(tasks, 2, "ride_in");
  const legs = legsFromParts(next, parts, "captain", route, null, saved);
  assert.deepEqual(legs, [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: 1 } }, { task: "ride_in", from: { at: "final_km" } }]);
  assert.equal(validateStagePlanLegs(legs, "captain", route), null);
  // Uden ændring er kæden uændret.
  assert.deepEqual(legsFromParts(tasks, parts, "captain", route, null, saved), saved);
});
