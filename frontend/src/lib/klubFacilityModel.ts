// Klub-siden retning D (#6666): rene helpers for facilitets-kortene. Ingen React,
// ingen I/O. Tallene kommer fra /api/club/facilities (backendens facilityConstants
// + akademiets niveau-regler); her afgøres kun hvordan de vises.

export type AcademyUnlock = "origin" | "type" | "extra" | "stronger" | null;

export interface LadderRow {
  tier: number;
  price: number;
  upkeep: number;
  bonus: number;
  unlock?: AcademyUnlock;
}

export interface FacilityStaff {
  id: string;
  name: string;
  tier: number;
  salary?: number;
  slot?: number;
  overall?: number;
}

export interface Facility {
  track: string;
  tier: number;
  upgradePrice: number | null;
  tierUpkeep: number;
  effectiveBonus: number;
  nextTierBonus: number | null;
  effectLive: boolean;
  staff?: FacilityStaff | null;
  staffList?: FacilityStaff[];
  staffSlotsMax?: number;
  ladder?: LadderRow[];
}

export type StepState = "owned" | "current" | "next" | "future";

/** Et trins tilstand i niveau-trappen i forhold til det ejede niveau. */
export function stepState(stepTier: number, ownedTier: number): StepState {
  if (stepTier < ownedTier) return "owned";
  if (stepTier === ownedTier) return "current";
  if (stepTier === ownedTier + 1) return "next";
  return "future";
}

/**
 * Sporet der får sidens ENE guld-knap (TASTE: ét guld pr. view): den billigste
 * mulige opgradering blandt de live, ikke fuldt udbyggede faciliteter. Ved lige
 * pris vinder den første i rækkefølgen. null når intet kan opgraderes.
 */
export function primaryUpgradeTrack(facilities: readonly Facility[]): string | null {
  let best: Facility | null = null;
  for (const f of facilities) {
    if (!f.effectLive || f.upgradePrice == null) continue;
    if (best == null || f.upgradePrice < (best.upgradePrice ?? Infinity)) best = f;
  }
  return best?.track ?? null;
}

/** Trappens række for et givet niveau (eller null når API'et ikke sendte den). */
export function ladderRow(facility: Facility, tier: number): LadderRow | null {
  return facility.ladder?.find((r) => r.tier === tier) ?? null;
}
