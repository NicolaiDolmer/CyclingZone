import assert from "node:assert/strict";
import { test } from "node:test";
import { applyQuickEffort, quickEffortOf, QUICK_TASK } from "./quickEffort8356.ts";
import { TASK_ROLES, type StagePlanRoute } from "../race/StagePlanModel.ts";

const route: StagePlanRoute = {
  profile_type: "mountain", distance_km: 170,
  climbs: [{ index: 0, km: 96, name: "Example", category: "1" }],
};

test("#8356 quick tasks are legal for their role", () => {
  for (const [role, tasks] of Object.entries(QUICK_TASK)) {
    for (const task of Object.values(tasks)) assert.ok(TASK_ROLES[task].some(candidate => candidate === role));
  }
});

test("#8356 Hard merges duplicate neighbours, retaining the final task and its trigger", () => {
  const exit = { task: "grupetto", from: { at: "dropped" } } as const;
  const plan = applyQuickEffort([
    { task: "shelter_leader" },
    { task: "tempo", from: { at: "kom", kom_index: 0 } },
    exit,
  ], "helper", "hard", route);
  assert.deepEqual(plan, { legs: [{ task: "tempo" }, exit], error: null });
  assert.equal(quickEffortOf(plan.legs, "helper"), "hard");
});

test("#8356 Normal refuses a hunter's breakaway when it would replace a valid leadout plan", () => {
  const plan = applyQuickEffort([
    { task: "shelter_leader" },
    { task: "sprint_train", from: { at: "final_km" } },
  ], "hunter", "normal", route);
  assert.deepEqual(plan, { legs: null, error: "stage_plan_train_after_breakaway" });
});

test("#8356 mixed tasks, absent plans and plans containing only a terminal task select nothing", () => {
  assert.equal(quickEffortOf([{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }], "captain"), null);
  assert.equal(quickEffortOf(null, "captain"), null);
  assert.deepEqual(applyQuickEffort([{ task: "ride_in" }], "captain", "easy", route),
    { legs: null, error: "stage_plan_terminal_not_last" });
});
