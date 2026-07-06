// #2216 A4 — Task 7: training-effekt-hook (dimension×niveau, kun under caps, no-op uden staff).
// staffTrainingBonus({ facilityTier, staff, ability, riderLevel }) → multiplikator ≥ 1.0.
//   • 1.0 (nul regression) når staff==null ELLER ingen trænings-facilitet (facilityTier null/0).
//   • > 1.0 kun ved ægte specialiserings-fordel: physical-youth-coach løfter en UNG rytters
//     FYSISKE evne; en dimension-miss (mental) eller niveau-miss (senior) løfter mindre / slet ikke.
//   • Multiplikatoren ændrer KUN daglig delta — cap-loopet i dailyTrainingEngine klipper stadig
//     ved ability_caps (bevist i dailyTraining.test.js + dailyTrainingEngine.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { staffTrainingBonus, STAFF_TRAINING_BONUS_CONFIG } from "./staffTrainingBonus.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

// Fixture: en ren fysisk-ungdoms-coach. physical 99 (stærk) / mental 33 (svag);
// youth 74 / senior 37. → specializationMatch: physical-youth ≈ 1.32 (fordel),
// mental-youth ≈ 0.987 (≤ baseline → ingen bonus), physical-senior ≈ 1.21 (< youth).
const PHYS_YOUTH_COACH = deriveStaffAbilities({ role: "training", tier: 5, name: "Karel Novotny" });

// ── Nul regression: ingen staff / ingen facilitet → præcis 1.0 ────────────────

test("staffTrainingBonus: staff==null → 1.0 (nul regression)", () => {
  assert.equal(
    staffTrainingBonus({ facilityTier: 5, staff: null, ability: "climbing", riderLevel: "youth" }),
    1.0
  );
  assert.equal(
    staffTrainingBonus({ facilityTier: 5, staff: undefined, ability: "climbing", riderLevel: "youth" }),
    1.0
  );
});

test("staffTrainingBonus: ingen trænings-facilitet (tier null/0) → 1.0", () => {
  assert.equal(
    staffTrainingBonus({ facilityTier: 0, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "youth" }),
    1.0
  );
  assert.equal(
    staffTrainingBonus({ facilityTier: null, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "youth" }),
    1.0
  );
});

// ── Dimension×niveau-targeting ────────────────────────────────────────────────

test("staffTrainingBonus: fysisk-ungdoms-coach løfter ung rytters FYSISKE evne (>1.0)", () => {
  // climbing er en physical-evne (dimensionOf("climbing")==="physical").
  const bonus = staffTrainingBonus({ facilityTier: 5, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "youth" });
  assert.ok(bonus > 1.0, `forventede >1.0, fik ${bonus}`);
});

test("staffTrainingBonus: dimension-miss — samme coach = 1.0 for ung rytters MENTALE evne", () => {
  // aggression er en mental-evne; coachens mental-akse (33) er under baseline →
  // ingen specialiserings-fordel → bonus præcis 1.0 (træning straffer aldrig).
  const bonus = staffTrainingBonus({ facilityTier: 5, staff: PHYS_YOUTH_COACH, ability: "aggression", riderLevel: "youth" });
  assert.equal(bonus, 1.0);
});

test("staffTrainingBonus: niveau-miss — senior-rytters fysiske evne løftes MINDRE end en ungdoms", () => {
  const youthBonus = staffTrainingBonus({ facilityTier: 5, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "youth" });
  const seniorBonus = staffTrainingBonus({ facilityTier: 5, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "senior" });
  assert.ok(seniorBonus < youthBonus, `senior (${seniorBonus}) skal løftes mindre end youth (${youthBonus})`);
  assert.ok(seniorBonus >= 1.0, "bonus aldrig under 1.0");
});

// ── Egenskaber ────────────────────────────────────────────────────────────────

test("staffTrainingBonus: altid ≥ 1.0 (træning kan aldrig give negativ effekt)", () => {
  const combos = [
    { ability: "climbing", riderLevel: "youth" },
    { ability: "aggression", riderLevel: "senior" },
    { ability: "descending", riderLevel: "junior" },
    { ability: "tactics", riderLevel: "senior" },
  ];
  for (const staff of [PHYS_YOUTH_COACH, deriveStaffAbilities({ role: "training", tier: 1, name: "Elena Sarti" })]) {
    for (const { ability, riderLevel } of combos) {
      const b = staffTrainingBonus({ facilityTier: 3, staff, ability, riderLevel });
      assert.ok(b >= 1.0, `bonus ${b} < 1.0 for ${ability}/${riderLevel}`);
    }
  }
});

test("staffTrainingBonus: højere facilitets-tier → større (eller lige) løft ved samme fordel", () => {
  const args = { staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "youth" };
  const t1 = staffTrainingBonus({ ...args, facilityTier: 1 });
  const t5 = staffTrainingBonus({ ...args, facilityTier: 5 });
  assert.ok(t5 > t1, `t5 (${t5}) skal løfte mere end t1 (${t1})`);
});

test("staffTrainingBonus: config-objekt eksponeret til harness-kalibrering (k + facilityScale)", () => {
  assert.equal(typeof STAFF_TRAINING_BONUS_CONFIG.k, "number");
  assert.equal(typeof STAFF_TRAINING_BONUS_CONFIG.facilityScale, "object");
  // facilityScale monotont ikke-aftagende i tier.
  let prev = -Infinity;
  for (const tier of [1, 2, 3, 4, 5]) {
    const s = STAFF_TRAINING_BONUS_CONFIG.facilityScale[tier];
    assert.ok(s >= prev, `facilityScale[${tier}]=${s} ikke ≥ ${prev}`);
    prev = s;
  }
});
