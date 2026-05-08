import test from "node:test";
import assert from "node:assert/strict";

import { resolveDmTargetFromInput } from "./discordDmTarget.js";

// #203: DM-routing-logik. Pure function — tester valg af target uden Supabase.
test("resolveDmTargetFromInput — test-konto tvinger stdout uanset env", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: undefined, isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "webhook", isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "test-channel", isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "stdout", isTestAccount: true }), "stdout");
});

test("resolveDmTargetFromInput — ægte manager respekterer env-var", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: undefined, isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "webhook", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "stdout", isTestAccount: false }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "test-channel", isTestAccount: false }), "test-channel");
});

test("resolveDmTargetFromInput — ukendt env-værdi falder tilbage til webhook (bagudkompat)", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: "bogus", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: null, isTestAccount: false }), "webhook");
});
