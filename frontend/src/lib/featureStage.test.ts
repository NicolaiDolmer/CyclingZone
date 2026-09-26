// #5404 · Ren udledningslogik — ingen netvaerk, ingen mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFlagStage, isBetaStage, FLAG_STAGES } from "./featureStage.ts";

test("sand for mig, falsk anonymt = beta (kun beta-testere ser den)", () => {
  assert.equal(deriveFlagStage(true, false), "beta");
});

test("sand anonymt = on for alle, uanset mit eget svar", () => {
  assert.equal(deriveFlagStage(true, true), "on");
  assert.equal(deriveFlagStage(false, true), "on");
});

test("falsk for mig, falsk anonymt = off", () => {
  assert.equal(deriveFlagStage(false, false), "off");
});

test("manglende noegle (undefined/null) fail-safer til off", () => {
  assert.equal(deriveFlagStage(undefined, undefined), "off");
  assert.equal(deriveFlagStage(null, null), "off");
  assert.equal(deriveFlagStage(undefined, false), "off");
});

test("isBetaStage er sand for praecis \"beta\"", () => {
  assert.equal(isBetaStage("beta"), true);
  assert.equal(isBetaStage("on"), false);
  assert.equal(isBetaStage("off"), false);
  assert.equal(isBetaStage(null), false);
  assert.equal(isBetaStage(undefined), false);
});

test("FLAG_STAGES spejler backendens kanoniske liste (stageFlagCatalog.js)", () => {
  assert.deepEqual(FLAG_STAGES, ["off", "beta", "on"]);
});
