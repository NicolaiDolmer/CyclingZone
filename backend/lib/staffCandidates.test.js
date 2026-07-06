import test from "node:test";
import assert from "node:assert/strict";
import { generateStaffCandidates, STAFF_NAME_POOL } from "./staffCandidates.js";
import { staffSalaryFor } from "./facilityConstants.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

const ARGS = { teamId: "11111111-1111-1111-1111-111111111111", seasonNumber: 3, role: "training", facilityTier: 3 };

test("genererer 3 kandidater, deterministisk på samme seed", () => {
  const a = generateStaffCandidates(ARGS);
  const b = generateStaffCandidates(ARGS);
  assert.equal(a.length, 3);
  assert.deepEqual(a, b); // ingen reroll ved refresh
});

test("kandidat-tiers overstiger aldrig facilitets-tier og salary er rating-drevet (Q1)", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    assert.ok(c.tier >= 1 && c.tier <= 3);
    assert.equal(typeof c.name, "string");
    assert.ok(STAFF_NAME_POOL.includes(c.name));
    assert.ok(c.salary > 0);
    // #2216 A4 (Q1): løn = staffSalaryFor(overall), ikke den flade tier-tabel.
    assert.equal(c.salary, staffSalaryFor(c.overall));
  }
});

test("forskellige seeds giver (som regel) forskellige kandidater", () => {
  const other = generateStaffCandidates({ ...ARGS, seasonNumber: 4 });
  assert.notDeepEqual(generateStaffCandidates(ARGS), other);
});

// ── #2216 A4: kandidater beriges med overall + topSpecialization til visning ──

test("kandidater har overall (fra derivation) + topSpecialization, deterministisk", () => {
  const cands = generateStaffCandidates(ARGS);
  for (const c of cands) {
    const profile = deriveStaffAbilities({ role: c.role, tier: c.tier, name: c.name });
    assert.equal(c.overall, profile.overall, "overall skal matche derivation");
    assert.equal(typeof c.topSpecialization, "string");
    assert.ok(c.topSpecialization.length > 0);
  }
  // Deterministisk: samme seed → samme berigede felter.
  assert.deepEqual(generateStaffCandidates(ARGS), cands);
});

test("topSpecialization = etiket på den højest-scorende akse (dimension/niveau/rolle)", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    const p = deriveStaffAbilities({ role: c.role, tier: c.tier, name: c.name });
    const axes = { ...p.dimensions, ...p.levels, ...p.roleSkills };
    const maxVal = Math.max(...Object.values(axes));
    assert.equal(axes[c.topSpecialization], maxVal, "top-spec skal pege på maks-aksen");
  }
});
