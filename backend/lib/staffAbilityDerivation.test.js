import test from "node:test";
import assert from "node:assert/strict";
import { deriveStaffAbilities, staffOverall } from "./staffAbilityDerivation.js";
import { TIER_OVERALL_BAND, STAFF_ROLES } from "./staffAbilityConstants.js";

test("deterministisk: samme (role,tier,name) → samme profil", () => {
  const a = deriveStaffAbilities({ role: "training", tier: 3, name: "Sofie Lindqvist" });
  const b = deriveStaffAbilities({ role: "training", tier: 3, name: "Sofie Lindqvist" });
  assert.deepEqual(a, b);
});

test("forskellig name → forskellig profil (hash-drevet)", () => {
  const a = deriveStaffAbilities({ role: "training", tier: 3, name: "Sofie Lindqvist" });
  const b = deriveStaffAbilities({ role: "training", tier: 3, name: "Marc Vandenbroucke" });
  assert.notDeepEqual(a, b);
});

test("overall ligger i tier-båndet (±3 tolerance) for alle roller", () => {
  for (const role of STAFF_ROLES) {
    for (const tier of [1, 2, 3, 4, 5]) {
      const p = deriveStaffAbilities({ role, tier, name: "Test Navn" });
      const band = TIER_OVERALL_BAND[tier];
      assert.ok(
        p.overall >= band.lo - 3 && p.overall <= band.hi + 3,
        `${role} tier ${tier} overall ${p.overall} uden for ${band.lo}-${band.hi}`,
      );
    }
  }
});

test("training-rollen har dimensioner + niveau-affiniteter i [1,99]", () => {
  const p = deriveStaffAbilities({ role: "training", tier: 4, name: "A B" });
  for (const d of ["physical", "mental", "technical"]) {
    assert.ok(p.dimensions[d] >= 1 && p.dimensions[d] <= 99, `dimension ${d}=${p.dimensions[d]}`);
  }
  for (const l of ["u23", "senior"]) {
    assert.ok(p.levels[l] >= 1 && p.levels[l] <= 99, `level ${l}=${p.levels[l]}`);
  }
});

test("kontrast: en specialisering rager op (ikke flad profil)", () => {
  const p = deriveStaffAbilities({ role: "training", tier: 5, name: "Spec Ialist" });
  const dims = Object.values(p.dimensions);
  assert.ok(Math.max(...dims) - Math.min(...dims) >= 10, "for flad — kontrast mangler");
  const levels = Object.values(p.levels);
  assert.ok(Math.max(...levels) - Math.min(...levels) >= 10, "niveau-profil for flad");
});

test("return shape: role/tier/overall/dimensions/levels/roleSkills", () => {
  const p = deriveStaffAbilities({ role: "training", tier: 3, name: "Sofie Lindqvist" });
  assert.equal(p.role, "training");
  assert.equal(p.tier, 3);
  assert.equal(typeof p.overall, "number");
  assert.deepEqual(Object.keys(p.dimensions).sort(), ["mental", "physical", "technical"]);
  assert.deepEqual(Object.keys(p.levels).sort(), ["senior", "u23"]);
  assert.equal(typeof p.roleSkills, "object");
});

test("non-training roller: rolle-relevante roleSkills-akser i [1,99]", () => {
  const expectedAxes = {
    scouting: ["evaluation", "reach"],
    medical: ["recovery", "injuryPrevention"],
    academy: ["intake", "growth"],
    commercial: ["negotiation", "marketing"],
  };
  for (const [role, axes] of Object.entries(expectedAxes)) {
    const p = deriveStaffAbilities({ role, tier: 3, name: "Rolle Test" });
    for (const axis of axes) {
      assert.ok(
        p.roleSkills[axis] >= 1 && p.roleSkills[axis] <= 99,
        `${role}.${axis}=${p.roleSkills?.[axis]} uden for [1,99]`,
      );
    }
    // non-training har ingen coaching-dimensioner (training-only)
    assert.deepEqual(p.dimensions, {}, `${role} skal ikke have coaching-dimensioner`);
  }
});

test("staffOverall er eksporteret og deterministisk for en profil", () => {
  const p = deriveStaffAbilities({ role: "training", tier: 4, name: "Overall Test" });
  assert.equal(staffOverall(p), p.overall);
});

test("clamp: overall altid i [1,99]", () => {
  for (const role of STAFF_ROLES) {
    for (const tier of [1, 2, 3, 4, 5]) {
      for (const name of ["Aa", "Zz Zz", "Lang Navn Med Ord", "X"]) {
        const p = deriveStaffAbilities({ role, tier, name });
        assert.ok(p.overall >= 1 && p.overall <= 99, `${role} t${tier} ${name} overall ${p.overall}`);
      }
    }
  }
});
