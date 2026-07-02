import test from "node:test";
import assert from "node:assert/strict";
import { computeIsPro } from "./proEntitlement.js";

test("computeIsPro: aktiv + fremtid = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: opsagt men i perioden = true", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: udløbet = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() - 1000).toISOString() }), false);
});
test("computeIsPro: null = false", () => {
  assert.equal(computeIsPro(null), false);
});
test("computeIsPro: inaktiv = false", () => {
  assert.equal(computeIsPro({ status: "inactive", current_period_end: new Date(Date.now() + 86400000).toISOString() }), false);
});
