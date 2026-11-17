import test from "node:test";
import assert from "node:assert/strict";
import {
  dayLoadOfEffort, dayLoadOfLegs, fatigueTone, legsFromParts, levelOfEffort, levelOfLegs, levelPlans,
  partTaskOptions, partTasks, routeParts, setPartTask, todayLine, withLockedRiders, effortForLevel,
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

test("Easy, Medium og Hard bygger gyldige kæder, og valget læses af kæden", () => {
  const medium = [{ task: "stay_sheltered" as const }, { task: "follow_moves" as const, from: { at: "kom" as const, kom_index: 1 } }];
  const plans = levelPlans("captain", route, parts, medium, true);
  assert.ok(plans.easy && plans.hard);
  assert.equal(validateStagePlanLegs(plans.hard, "captain", route), null);
  assert.equal(plans.hard?.[plans.hard.length - 1].task, "attack");
  assert.equal(levelOfLegs(plans.easy, plans), "easy");
  assert.equal(levelOfLegs(plans.hard, plans), "hard");
  assert.equal(levelOfLegs(medium, plans), "medium");
  const helper = levelPlans("helper", route, parts, null, true);
  assert.deepEqual(helper.hard, [{ task: "tempo" }]);
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
