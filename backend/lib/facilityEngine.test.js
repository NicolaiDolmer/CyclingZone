import test from "node:test";
import assert from "node:assert/strict";
import {
  getUpgradePrice, getFacilityUpkeepTotal, getStaffSalary,
  effectiveBonus, validateUpgrade, validateHire, severanceCost,
} from "./facilityEngine.js";

test("getUpgradePrice: næste tier-pris; null ved max", () => {
  assert.equal(getUpgradePrice(0), 12_000);
  assert.equal(getUpgradePrice(4), 240_000);
  assert.equal(getUpgradePrice(5), null);
});

test("getFacilityUpkeepTotal: summerer tier-upkeep over spor", () => {
  assert.equal(getFacilityUpkeepTotal([]), 0);
  assert.equal(getFacilityUpkeepTotal([{ track: "training", tier: 2 }, { track: "medical", tier: 1 }]), 3_500 + 1_500);
});

test("getStaffSalary + severanceCost", () => {
  assert.equal(getStaffSalary(3), 600);
  assert.equal(severanceCost({ salary: 40_000 }), 20_000); // 0.5 × sæsonløn
});

test("effectiveBonus: bagud-kompat — integer staffTier (A1-service/A3-UI rå-tier-sti)", () => {
  // Den DEPRECEREDE integer-sti bruger staffUtilization (0.5 + 0.1·tier) UÆNDRET —
  // kun den ability-drevne staffEffectFactor er blevet kalibreret, ikke denne bagud-
  // kompat-adapter (integer-tier-kald giver bit-identisk resultat som før).
  assert.equal(effectiveBonus("training", 0, null), 0);                 // intet bygget
  assert.equal(effectiveBonus("training", 5, null), 0.165 * 0.5);       // null → staffEffectFactor-gulv 0.5
  assert.equal(effectiveBonus("training", 5, 5), 0.165 * 1.0);          // fuld tier-staff: 100%
  assert.equal(effectiveBonus("training", 3, 1), 0.074 * 0.6);          // integer-tier-skalar bevaret (0.5+0.1·1)
});

test("effectiveBonus: #2216 A4 — ability-drevet display-magnitude (staff-objekt med overall)", () => {
  // Rekalibreret model (ejer-valg 2026-07-05): base × staffEffectFactor(staff) = base × (0.5 + 0.5·overall/99).
  assert.equal(effectiveBonus("training", 5, { overall: 99 }), 0.165 * 1.0);       // overall 99 → faktor 1.0 (0.5+0.5)
  assert.equal(effectiveBonus("training", 5, { overall: 0 }), 0.165 * 0.5);        // overall 0 → gulv 0.5
  assert.equal(effectiveBonus("training", 5, null), 0.165 * 0.5);                  // ingen staff → gulv 0.5
  assert.ok(Math.abs(effectiveBonus("training", 5, { overall: 50 }) - 0.165 * (0.5 + 0.5 * (50 / 99))) < 1e-12);
  assert.equal(effectiveBonus("bogus", 3, { overall: 80 }), 0);                    // ukendt track
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
  assert.equal(validateHire({ role: "training", staffTier: 1, facilityTier: 1, balance: 50 }), "insufficient_funds");
  assert.equal(validateHire({ role: "bogus", staffTier: 1, facilityTier: 1, balance: 1e9 }), "invalid_role");
  assert.equal(validateHire({ role: "training", staffTier: 0, facilityTier: 5, balance: 1e9 }), "invalid_staff_tier");
  assert.equal(validateHire({ role: "training", staffTier: 7, facilityTier: 5, balance: 1e9 }), "invalid_staff_tier");
});

test("edge: ukendt tier/track giver 0, ikke crash", () => {
  assert.equal(getFacilityUpkeepTotal([{ track: "training", tier: 9 }]), 0);
  assert.equal(effectiveBonus("bogus", 3, 3), 0);
});
