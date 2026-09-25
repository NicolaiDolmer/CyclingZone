import test from "node:test";
import assert from "node:assert/strict";
import { ACADEMY_DRIFT_ENABLED_FLAG_KEY, isAcademyDriftEnabled } from "./academyDriftFlag.js";

function flagClient(value) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) };
}

test("ACADEMY_DRIFT_ENABLED_FLAG_KEY = academy_drift_enabled", () => {
  assert.equal(ACADEMY_DRIFT_ENABLED_FLAG_KEY, "academy_drift_enabled");
});

test("isAcademyDriftEnabled: fail-safe TRUE ved fejl/fravær (#5741 — drift opkræves som i dag)", async () => {
  assert.equal(await isAcademyDriftEnabled(null), true);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await isAcademyDriftEnabled(errClient), true);
  assert.equal(await isAcademyDriftEnabled(flagClient(undefined)), true);
});

test("isAcademyDriftEnabled: false KUN ved eksplicit off/false", async () => {
  assert.equal(await isAcademyDriftEnabled(flagClient("off")), false);
  assert.equal(await isAcademyDriftEnabled(flagClient(false)), false);
});

test("isAcademyDriftEnabled: true ved eksplicit on/true", async () => {
  assert.equal(await isAcademyDriftEnabled(flagClient(true)), true);
  assert.equal(await isAcademyDriftEnabled(flagClient("on")), true);
});

test("isAcademyDriftEnabled: beta-stage kun for beta-testere/engine-write", async () => {
  assert.equal(await isAcademyDriftEnabled(flagClient("beta"), { isBetaTester: true }), true);
  assert.equal(await isAcademyDriftEnabled(flagClient("beta"), { isBetaTester: false }), false);
  assert.equal(await isAcademyDriftEnabled(flagClient("beta"), { engineWrite: true }), true);
});
