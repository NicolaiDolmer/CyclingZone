import test from "node:test";
import assert from "node:assert/strict";
import { generateStaffCandidates, STAFF_NAME_POOL } from "./staffCandidates.js";

const ARGS = { teamId: "11111111-1111-1111-1111-111111111111", seasonNumber: 3, role: "training", facilityTier: 3 };

test("genererer 3 kandidater, deterministisk på samme seed", () => {
  const a = generateStaffCandidates(ARGS);
  const b = generateStaffCandidates(ARGS);
  assert.equal(a.length, 3);
  assert.deepEqual(a, b); // ingen reroll ved refresh
});

test("kandidat-tiers overstiger aldrig facilitets-tier og salary matcher tier", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    assert.ok(c.tier >= 1 && c.tier <= 3);
    assert.equal(typeof c.name, "string");
    assert.ok(STAFF_NAME_POOL.includes(c.name));
    assert.ok(c.salary > 0);
  }
});

test("forskellige seeds giver (som regel) forskellige kandidater", () => {
  const other = generateStaffCandidates({ ...ARGS, seasonNumber: 4 });
  assert.notDeepEqual(generateStaffCandidates(ARGS), other);
});
