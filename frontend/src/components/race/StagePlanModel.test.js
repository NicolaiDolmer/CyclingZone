// #7003: etapeplanens UI-hjaelpere (kun gyldige valg, reparation, opsummering efter etapen).
import test from "node:test";
import assert from "node:assert/strict";
import {
  nextLeg,
  removeLeg,
  setLegTask,
  setLegTrigger,
  stagePlanRecap,
  stagePlanRouteFromRaw,
  taskOptions,
  triggerOptions,
  validateStagePlanLegs,
  withStagePlanFields,
  withoutStagePlans,
} from "./StagePlanModel.js";

const ROUTE = stagePlanRouteFromRaw({
  distance_km: 150,
  profile_type: "mountain",
  climbs: [{ name: "Col A", crest_km: 60, category: "2" }, { name: "Col B", crest_km: 110, category: "1" }],
});
const HELPER = [
  { task: "shelter_leader" },
  { task: "tempo", from: { at: "kom", kom_index: 0 } },
  { task: "grupetto", from: { at: "dropped" } },
];

test("#7003: valgene for et led er kun de logiske", () => {
  assert.ok(!taskOptions(HELPER, 1, "helper", ROUTE).includes("breakaway"), "udbrud kun foerst");
  assert.ok(taskOptions(HELPER, 0, "helper", ROUTE).includes("breakaway"));
  assert.ok(!taskOptions(HELPER, 0, "captain", ROUTE).includes("grupetto"));
  // Leddet efter Col A kan ikke skifte foer Col A; "naar sat" kun i sidste led.
  const opts = triggerOptions(HELPER, 1, "helper", ROUTE).map((f) => f.at === "kom" ? `kom:${f.kom_index}` : f.at);
  assert.ok(!opts.includes("kom:1") || opts.indexOf("kom:0") < opts.indexOf("kom:1"), "rutens orden");
  // "Naar sat" paa et midter-led goer det til sidste led (resten klippes af).
  assert.deepEqual(setLegTrigger(HELPER, 1, { at: "dropped" }, "helper", ROUTE), [HELPER[0], { task: "tempo", from: { at: "dropped" } }]);
  assert.deepEqual(triggerOptions([{ task: "shelter_leader" }, { task: "grupetto", from: { at: "final_km" } }], 1, "helper", ROUTE).map((f) => f.at), ["kom", "kom", "final_km", "dropped"]);
});

test("#7003: et valg der goer resten ugyldig, klipper kaeden til det gyldige praefiks", () => {
  // Grupetto i midten: alt efter det falder bort.
  assert.deepEqual(setLegTask(HELPER, 1, "grupetto", "helper", ROUTE), [HELPER[0], { task: "grupetto", from: { at: "kom", kom_index: 0 } }]);
  // Andet led flyttet til efter Col B: tredje led (sat) er stadig gyldigt.
  assert.deepEqual(setLegTrigger(HELPER, 1, { at: "kom", kom_index: 1 }, "helper", ROUTE)[1].from, { at: "kom", kom_index: 1 });
  assert.deepEqual(removeLeg(HELPER, 1, "helper", ROUTE), [HELPER[0], HELPER[2]]);
  assert.equal(removeLeg(HELPER, 0, "helper", ROUTE), HELPER, "foerste led fjernes aldrig");
  assert.equal(nextLeg(HELPER, "helper", ROUTE), null, "loftet er naaet");
  const added = [{ task: "shelter_leader" }, nextLeg([{ task: "shelter_leader" }], "helper", ROUTE)];
  assert.equal(validateStagePlanLegs(added, "helper", ROUTE), null);
});

test("#7003: gem udleder de gamle felter; kopi til naeste etape tager ikke planen med", () => {
  const order = { breakaway_stance: "neutral", riders: [{ rider_id: "a", effort: "all_out", try_break: true, leadout: false, plan: HELPER }, { rider_id: "b", effort: "save" }] };
  assert.deepEqual(withStagePlanFields(order).riders[0], { rider_id: "a", effort: "normal", try_break: false, leadout: false, plan: HELPER });
  assert.deepEqual(withStagePlanFields(order).riders[1], { rider_id: "b", effort: "save" });
  assert.deepEqual(withoutStagePlans(order).riders[0], { rider_id: "a", effort: "all_out", try_break: true, leadout: false });
});

test("#7003: opsummeringen efter etapen laeses af stage_plan_leg-events", () => {
  const sat = [{ type: "stage_plan_leg", km: 64, params: { rider_id: "a", leg: 2, task: "grupetto", reason: "dropped" } }];
  assert.deepEqual(stagePlanRecap(HELPER, sat, "a").map((i) => [i.status, i.endReason]), [
    ["done", "dropped"],
    ["skipped", null],
    ["to_finish", "finish"],
  ]);
  const planned = [
    { type: "stage_plan_leg", km: 62, params: { rider_id: "a", leg: 1, task: "tempo", reason: "kom" } },
    { type: "stage_plan_leg", km: 101, params: { rider_id: "a", leg: 2, task: "grupetto", reason: "dropped" } },
    { type: "stage_plan_leg", km: 30, params: { rider_id: "other", leg: 1, task: "tempo", reason: "kom" } },
  ];
  assert.deepEqual(stagePlanRecap(HELPER, planned, "a").map((i) => [i.status, i.endReason, i.endKm]), [
    ["done", "kom", 62],
    ["done", "dropped", 101],
    ["to_finish", "finish", null],
  ]);
  const quit = [{ type: "incident", km: 80, params: { rider_id: "a", outcome: "abandoned" } }];
  assert.deepEqual(stagePlanRecap(HELPER, quit, "a").map((i) => i.status), ["abandoned", "not_reached", "not_reached"]);
});
