import test from "node:test";
import assert from "node:assert/strict";
import {
  getUpgradePrice, getFacilityUpkeepTotal, getStaffSalary,
  effectiveBonus, validateUpgrade, validateHire, severanceCost,
} from "./facilityEngine.js";

test("getUpgradePrice: næste tier-pris; null ved max", () => {
  assert.equal(getUpgradePrice(0), 7_000);
  assert.equal(getUpgradePrice(4), 285_000);
  assert.equal(getUpgradePrice(5), null);
});

test("getFacilityUpkeepTotal: summerer tier-upkeep over spor", () => {
  assert.equal(getFacilityUpkeepTotal([]), 0);
  assert.equal(getFacilityUpkeepTotal([{ track: "training", tier: 2 }, { track: "medical", tier: 1 }]), 11_000 + 2_700);
});

test("getStaffSalary + severanceCost", () => {
  assert.equal(getStaffSalary(3), 3_000);
  assert.equal(severanceCost({ salary: 40_000 }), 20_000); // 0.5 × sæsonløn
});

test("effectiveBonus: facilitet = kapacitet, staff = udnyttelse", () => {
  assert.equal(effectiveBonus("training", 0, null), 0);                 // intet bygget
  assert.equal(effectiveBonus("training", 5, null), 0.12 * 0.5);        // uden staff: 50%
  assert.equal(effectiveBonus("training", 5, 5), 0.12 * 1.0);           // fuld staff: 100%
  assert.equal(effectiveBonus("training", 3, 1), 0.0465 * 0.6);
});

test("validateUpgrade: track, tier-loft, balance", () => {
  assert.equal(validateUpgrade({ track: "training", currentTier: 0, balance: 30_000 }), null);
  assert.equal(validateUpgrade({ track: "bogus", currentTier: 0, balance: 1e9 }), "invalid_track");
  assert.equal(validateUpgrade({ track: "training", currentTier: 5, balance: 1e9 }), "max_tier");
  assert.equal(validateUpgrade({ track: "training", currentTier: 0, balance: 5_000 }), "insufficient_funds");
  assert.equal(validateUpgrade({ track: "training", currentTier: -1, balance: 1e9 }), "invalid_tier");
  assert.equal(validateUpgrade({ track: "training", currentTier: NaN, balance: 1e9 }), "invalid_tier");
});

test("validateHire: staff-tier gated af facilitets-tier (spec §2.2)", () => {
  assert.equal(validateHire({ role: "training", staffTier: 2, facilityTier: 3, balance: 1e9 }), null);
  assert.equal(validateHire({ role: "training", staffTier: 4, facilityTier: 3, balance: 1e9 }), "staff_tier_exceeds_facility");
  assert.equal(validateHire({ role: "training", staffTier: 1, facilityTier: 1, balance: 1_000 }), "insufficient_funds");
  assert.equal(validateHire({ role: "bogus", staffTier: 1, facilityTier: 1, balance: 1e9 }), "invalid_role");
  assert.equal(validateHire({ role: "training", staffTier: 0, facilityTier: 5, balance: 1e9 }), "invalid_staff_tier");
  assert.equal(validateHire({ role: "training", staffTier: 7, facilityTier: 5, balance: 1e9 }), "invalid_staff_tier");
});

test("edge: ukendt tier/track giver 0, ikke crash", () => {
  assert.equal(getFacilityUpkeepTotal([{ track: "training", tier: 9 }]), 0);
  assert.equal(effectiveBonus("bogus", 3, 3), 0);
});
