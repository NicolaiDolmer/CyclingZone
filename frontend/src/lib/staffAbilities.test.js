import { test } from "node:test";
import assert from "node:assert/strict";
import { topStaffAxis } from "./staffAbilities.js";

// #2695: coach hired before the U23-band collapse (#2529) showed a "senior"
// specialty headline even when his real skill (physical) or age-focus (U23)
// should have won — topStaffAxis mixed the levels (u23/senior age-focus) into
// the same ranked pool as dimensions (skill). Fixed by excluding levels from
// the "top skill axis" search — levels get their own column elsewhere.

test("topStaffAxis: ignores levels (u23/senior) even when they outrank every dimension", () => {
  const profile = {
    abilities: {
      dimensions: { physical: 80, mental: 32, technical: 61 },
      // levels.senior (80) ties/would-beat physical if not excluded
      levels: { u23: 22, senior: 90 },
      roleSkills: {},
    },
  };
  const top = topStaffAxis(profile);
  assert.equal(top.axisKey, "physical");
  assert.equal(top.value, 80);
});

test("topStaffAxis: never returns a levels key (u23/senior)", () => {
  const profile = {
    abilities: {
      dimensions: { physical: 10, mental: 5, technical: 1 },
      levels: { u23: 99, senior: 1 },
      roleSkills: {},
    },
  };
  const top = topStaffAxis(profile);
  assert.ok(!["u23", "senior"].includes(top.axisKey));
  assert.equal(top.axisKey, "physical");
});

test("topStaffAxis: falls back to roleSkills for non-training roles (empty dimensions)", () => {
  const profile = {
    abilities: {
      dimensions: {},
      levels: { u23: 95, senior: 10 },
      roleSkills: { evaluation: 40, reach: 66 },
    },
  };
  const top = topStaffAxis(profile);
  assert.equal(top.axisKey, "reach");
});
