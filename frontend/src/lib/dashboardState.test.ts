import test from "node:test";
import assert from "node:assert/strict";
import { retainKnownList } from "./dashboardState.ts";

test("failed list requests settle initial state and retain known data by identity", () => {
  assert.deepEqual(retainKnownList(null), []);
  const known = [{ id: "result" }];
  assert.equal(retainKnownList(known), known);
  const empty: unknown[] = [];
  assert.equal(retainKnownList(empty), empty);
});
