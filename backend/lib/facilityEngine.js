// Rene facilitets-funktioner — ingen I/O. Konstanter i facilityConstants.js (A2-kalibreres).
import {
  FACILITY_TRACKS, MAX_FACILITY_TIER, FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP,
  STAFF_SALARY_BY_TIER, STAFF_SEVERANCE_FACTOR, FACILITY_BASE_EFFECT,
  STAFF_EFFECT_FACTOR_FLOOR, STAFF_EFFECT_FACTOR_SLOPE, STAFF_SPECIALIZATION,
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
// DEPRECATED (#2216 A4): erstattet af den ability-drevne staffEffectFactor(staff)
// nedenfor. Bevaret som bagud-kompat-sti for integer-tier-kald (A1-service/A3-UI der
// endnu passerer et rå tier) via effectiveBonus-adapteren, indtil alle call-sites
// er migreret til at sende staff-objektet med overall.
export function staffUtilization(staffTier) {
  return staffTier == null ? 0.5 : 0.5 + 0.1 * staffTier;
}

// #2216 A4 (Task 6, kalibreret Task 8): ability-drevet udnyttelses-faktor. staff==null →
// gulv STAFF_EFFECT_FACTOR_FLOOR (0.4 efter Task 8-kalibrering — en facilitet uden chef
// kører på 40%). Ellers FLOOR + SLOPE·(overall/99): lineær, strengt monoton i overall,
// faktor PRÆCIS 1.0 ved overall 99 (0.4 + 0.6·1). Erstatter tier→util-skalaren i display-
// magnituden (effectiveBonus). Kurve-parametrene er harness-kalibrerede named-constants.
export function staffEffectFactor(staff) {
  if (staff == null) return STAFF_EFFECT_FACTOR_FLOOR;
  const overall = Math.max(0, staff.overall ?? 0);
  return STAFF_EFFECT_FACTOR_FLOOR + STAFF_EFFECT_FACTOR_SLOPE * (overall / 99);
}

// #2216 A4 (Task 6): per-rytter specialiserings-multiplikator (dimension×niveau).
// baseline 1.0 for en generalist / manglende akse; > 1.0 (loftet) når chefens
// dimension OG niveau er stærke. Vægtet + normaliseret omkring baselineOverall, clampet
// til [floor, cap]. IKKE i facilitets-display-magnituden — bruges pr. rytter af trænings-
// hooket (Task 7). Robust: mangler staff eller den ønskede akse → 1.0.
export function specializationMatch(staff, { dimension, level } = {}) {
  if (staff == null) return 1.0;
  const S = STAFF_SPECIALIZATION;
  const dimVal = staff.dimensions?.[dimension];
  const lvlVal = staff.levels?.[level];
  if (!Number.isFinite(dimVal) && !Number.isFinite(lvlVal)) return 1.0;
  // Normalisér hver akse til [-1, +1] omkring baselineOverall (loft 99).
  const norm = (v) => {
    if (!Number.isFinite(v)) return 0;
    const span = 99 - S.baselineOverall;
    return Math.max(-1, Math.min(1, (v - S.baselineOverall) / span));
  };
  const raw = 1 + S.weightDimension * norm(dimVal) + S.weightLevel * norm(lvlVal);
  return Math.max(S.floor, Math.min(S.cap, raw));
}

// Facilitets-DISPLAY-magnitude (spec §2.2: facilitet = kapacitet, staff = udnyttelse).
// = FACILITY_BASE_EFFECT[track][facilityTier] × staffEffectFactor(staff). INGEN
// specialisering her (den er per-rytter, Task 7). Bagud-kompat: et integer staffTier
// wrappes via den bevarede staffUtilization-sti (adapter) så A1-service/A3-UI-kald med
// rå tier stadig virker; et staff-objekt (eller null) bruger den ability-drevne faktor.
export function effectiveBonus(track, facilityTier, staff) {
  const base = FACILITY_BASE_EFFECT[track]?.[facilityTier] ?? 0;
  const factor = typeof staff === "number" ? staffUtilization(staff) : staffEffectFactor(staff);
  return base * factor;
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
