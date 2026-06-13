import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";

test("evaluateFlagStage: on/true → alle", () => {
  assert.equal(evaluateFlagStage("on"), true);
  assert.equal(evaluateFlagStage(true), true);
  assert.equal(evaluateFlagStage("on", { isBetaTester: false }), true);
});

test("evaluateFlagStage: beta → kun beta-testere", () => {
  assert.equal(evaluateFlagStage("beta", { isBetaTester: true }), true);
  assert.equal(evaluateFlagStage("beta", { isBetaTester: false }), false);
  assert.equal(evaluateFlagStage("beta"), false);
});

test("evaluateFlagStage: off/false/ukendt → ingen", () => {
  for (const v of ["off", false, null, undefined, "garbage"]) {
    assert.equal(evaluateFlagStage(v, { isBetaTester: true }), false, `v=${v}`);
  }
});

test("readFlagStage: fail-safe null + happy path", async () => {
  assert.equal(await readFlagStage(null, "k"), null);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await readFlagStage(errClient, "k"), null);
  const onClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await readFlagStage(onClient, "k"), "beta");
});
