import test from "node:test";
import assert from "node:assert/strict";
import { ALUNTA_RECONCILE_FLAG_KEY, isAluntaReconcileEnabled } from "./aluntaReconcileFlag.js";

function flagClient(value) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) };
}

test("ALUNTA_RECONCILE_FLAG_KEY = alunta_reconcile_enabled", () => {
  assert.equal(ALUNTA_RECONCILE_FLAG_KEY, "alunta_reconcile_enabled");
});

test("isAluntaReconcileEnabled: fail-safe false ved fejl/fravær (#2736 — ingen utilsigtet write)", async () => {
  assert.equal(await isAluntaReconcileEnabled(null), false);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await isAluntaReconcileEnabled(errClient), false);
  assert.equal(await isAluntaReconcileEnabled(flagClient(undefined)), false);
});

test("isAluntaReconcileEnabled: true KUN når value === true/'on'", async () => {
  assert.equal(await isAluntaReconcileEnabled(flagClient(true)), true);
  assert.equal(await isAluntaReconcileEnabled(flagClient("on")), true);
  assert.equal(await isAluntaReconcileEnabled(flagClient(false)), false);
});

test("isAluntaReconcileEnabled: beta-stage kun for beta-testere", async () => {
  assert.equal(await isAluntaReconcileEnabled(flagClient("beta"), { isBetaTester: true }), true);
  assert.equal(await isAluntaReconcileEnabled(flagClient("beta"), { isBetaTester: false }), false);
});
