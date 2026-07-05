// Rene facilitets-funktioner — ingen I/O. Konstanter i facilityConstants.js (A2-kalibreres).
import {
  FACILITY_TRACKS, MAX_FACILITY_TIER, FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP,
  STAFF_SALARY_BY_TIER, STAFF_SEVERANCE_FACTOR, FACILITY_BASE_EFFECT,
} from "./facilityConstants.js";

export function getUpgradePrice(currentTier) {
  const next = currentTier + 1;
  return next > MAX_FACILITY_TIER ? null : FACILITY_TIER_PRICE[next];
}

export function getFacilityUpkeepTotal(facilities) {
  return (facilities || []).reduce((sum, f) => sum + (FACILITY_TIER_UPKEEP[f.tier] || 0), 0);
}

export function getStaffSalary(tier) {
  return STAFF_SALARY_BY_TIER[tier];
}

export function severanceCost(staff) {
  return Math.round(staff.salary * STAFF_SEVERANCE_FACTOR);
}

// staffTier null = ingen ansat → 50% udnyttelse. Tier 1..5 → 0.6..1.0.
// Eksporteret så harness-modellen (facilityInvestmentModel) deler formlen (co-SSOT).
export function staffUtilization(staffTier) {
  return staffTier == null ? 0.5 : 0.5 + 0.1 * staffTier;
}

export function effectiveBonus(track, facilityTier, staffTier) {
  const base = FACILITY_BASE_EFFECT[track]?.[facilityTier] ?? 0;
  return base * staffUtilization(staffTier);
}

export function validateUpgrade({ track, currentTier, balance }) {
  if (!Number.isInteger(currentTier) || currentTier < 0) return "invalid_tier";
  if (!FACILITY_TRACKS.includes(track)) return "invalid_track";
  const price = getUpgradePrice(currentTier);
  if (price == null) return "max_tier";
  if (balance < price) return "insufficient_funds";
  return null;
}

export function validateHire({ role, staffTier, facilityTier, balance }) {
  if (!Number.isInteger(staffTier) || staffTier < 1 || staffTier > MAX_FACILITY_TIER) return "invalid_staff_tier";
  if (!FACILITY_TRACKS.includes(role)) return "invalid_role";
  if (staffTier > facilityTier) return "staff_tier_exceeds_facility";
  if (balance < STAFF_SALARY_BY_TIER[staffTier]) return "insufficient_funds";
  return null;
}
