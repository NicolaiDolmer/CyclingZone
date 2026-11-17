import { test } from "node:test";
import assert from "node:assert/strict";
import { QUICK_TASK, applyQuickEffort, quickEffortOf } from "./quickEffort8356.ts";
import { TASK_ROLES, validateStagePlanLegs, type StagePlanLeg, type StagePlanRole, type StagePlanRoute } from "../race/StagePlanModel.ts";

const route: StagePlanRoute = {
  distance_km: 170,
  profile_type: "mountain",
  climbs: [{ index: 0, km: 96, name: "Passo", category: "1" }, { index: 1, km: 154, name: "Cima", category: "HC" }],
  summit_finish: true,
};
const ROLES: StagePlanRole[] = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];

test("#8356: hver rolles hurtigvalg bruger kun opgaver, rollen må få", () => {
  for (const role of ROLES) {
    for (const task of Object.values(QUICK_TASK[role])) assert.ok(TASK_ROLES[task].includes(role), `${role} må ikke få ${task}`);
  }
});

test("#8356: Hård hos hjælperen gør alle åbne led til tempo og bevarer udløsere og slut-led", () => {
  const base: StagePlanLeg[] = [
    { task: "shelter_leader" },
    { task: "shelter_leader", from: { at: "kom", kom_index: 0 } },
    { task: "grupetto", from: { at: "dropped" } },
  ];
  const out = applyQuickEffort(base, "helper", "hard", route);
  assert.equal(out[0].task, "tempo");
  assert.equal(out.at(-1)?.task, "grupetto");
  assert.deepEqual(out.at(-1)?.from, { at: "dropped" });
  assert.equal(validateStagePlanLegs(out, "helper", route), null);
  assert.equal(quickEffortOf(out, "helper"), "hard");
});

test("#8356: uden plan og forslag bliver det én opgave for hele etapen", () => {
  assert.deepEqual(applyQuickEffort(null, "hunter", "hard", route), [{ task: "attack" }]);
  assert.deepEqual(applyQuickEffort([], "captain", "easy", route), [{ task: "stay_sheltered" }]);
});

test("#8356: en blandet plan markerer intet trin", () => {
  assert.equal(quickEffortOf([{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }], "captain"), null);
  assert.equal(quickEffortOf([{ task: "ride_in" }], "captain"), null, "kun slut-led = intet hurtigvalg");
  assert.equal(quickEffortOf(null, "captain"), null);
});

test("#8356: resultatet er altid gyldigt for rollen og ruten", () => {
  const base: StagePlanLeg[] = [{ task: "breakaway" }, { task: "ride_in", from: { at: "final_km" } }];
  for (const role of ROLES) for (const effort of ["easy", "normal", "hard"] as const) {
    const out = applyQuickEffort(base, role, effort, route);
    assert.equal(validateStagePlanLegs(out, role, route), null, `${role}/${effort}`);
  }
});
