import test from "node:test";
import assert from "node:assert/strict";
import { STAGE_SCHEDULER_FLAG_KEY, isStageSchedulerEnabled } from "./stageSchedulerFlag.js";

function flagClient(value) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) };
}

test("STAGE_SCHEDULER_FLAG_KEY = stage_scheduler_enabled", () => {
  assert.equal(STAGE_SCHEDULER_FLAG_KEY, "stage_scheduler_enabled");
});

test("isStageSchedulerEnabled: fail-safe false ved fejl/fravær", async () => {
  assert.equal(await isStageSchedulerEnabled(null), false);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await isStageSchedulerEnabled(errClient), false);
  assert.equal(await isStageSchedulerEnabled(flagClient(undefined)), false);
});

test("isStageSchedulerEnabled: true KUN når value === true/'on'", async () => {
  assert.equal(await isStageSchedulerEnabled(flagClient(true)), true);
  assert.equal(await isStageSchedulerEnabled(flagClient("on")), true);
  assert.equal(await isStageSchedulerEnabled(flagClient(false)), false);
});

test("isStageSchedulerEnabled: beta-stage kun for beta-testere", async () => {
  assert.equal(await isStageSchedulerEnabled(flagClient("beta"), { isBetaTester: true }), true);
  assert.equal(await isStageSchedulerEnabled(flagClient("beta"), { isBetaTester: false }), false);
  assert.equal(await isStageSchedulerEnabled(flagClient("beta")), false);
});
