import test from "node:test";
import assert from "node:assert/strict";
import { RIDERS, TEST_TEAM } from "./seedData.js";

test("hver rider har et id og et navn", () => {
  for (const r of RIDERS) {
    assert.ok(r.id, "rider mangler id");
    assert.ok(r.firstname && r.lastname, `rider ${r.id} mangler navn`);
  }
});

test("TEST_TEAM er et ikke-AI testhold", () => {
  assert.equal(TEST_TEAM.is_ai, false);
  assert.equal(TEST_TEAM.is_test_account, true);
});
