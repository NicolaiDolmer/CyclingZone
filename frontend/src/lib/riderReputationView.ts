export type RiderReputationBand = "unknown" | "known" | "profile" | "star" | "legend";

const REPUTATION_BAND_LIMITS: Record<Exclude<RiderReputationBand, "legend">, { min: number; max: number; next: Exclude<RiderReputationBand, "unknown"> }> = {
  unknown: { min: 0, max: 20, next: "known" },
  known: { min: 20, max: 45, next: "profile" },
  profile: { min: 45, max: 70, next: "star" },
  star: { min: 70, max: 90, next: "legend" },
};

export function riderReputationProgress(value: number | null | undefined) {
  const band = riderReputationBand(value);
  if (!band || band === "legend") return null;
  const range = REPUTATION_BAND_LIMITS[band];
  const score = Math.max(range.min, Math.min(range.max, Number(value)));
  return {
    nextBand: range.next,
    current: Math.round(score),
    target: range.max,
    percent: ((score - range.min) / (range.max - range.min)) * 100,
  };
}

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

export function riderReputationBandKey(rider: RiderReputationLike | null | undefined, enabled: boolean): string | null {
  const band = riderReputationBand(riderReputationValue(rider, enabled));
  return band ? `reputation.band.${band}` : null;
}
