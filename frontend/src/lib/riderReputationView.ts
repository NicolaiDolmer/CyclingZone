export type RiderReputationBand = "unknown" | "known" | "profile" | "star" | "legend";

export interface RiderReputationLike {
  popularity?: number | null;
  reputation?: number | null;
}

export function riderReputationValue(rider: RiderReputationLike | null | undefined, enabled: boolean): number | null {
  const values = (enabled ? [rider?.popularity, rider?.reputation] : [rider?.popularity])
    .filter((raw): raw is number => raw != null && Number.isFinite(Number(raw)))
    .map(Number);
  if (!values.length) return null;
  return Math.max(0, Math.min(100, Math.max(...values)));
}

export function riderReputationBand(value: number | null | undefined): RiderReputationBand | null {
  if (value == null) return null;
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n >= 90) return "legend";
  if (n >= 70) return "star";
  if (n >= 45) return "profile";
  if (n >= 20) return "known";
  return "unknown";
}

export function riderReputationSortValue(rider: RiderReputationLike | null | undefined, enabled: boolean): number {
  return riderReputationValue(rider, enabled) ?? -1;
}

export function riderReputationBandKey(rider: RiderReputationLike | null | undefined, enabled: boolean): string | null {
  const band = riderReputationBand(riderReputationValue(rider, enabled));
  return band ? `reputation.band.${band}` : null;
}
