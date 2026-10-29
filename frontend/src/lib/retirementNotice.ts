export type RetirementStatus = {
  announced_retirement?: unknown;
  retirement_after_season?: unknown;
};

function validSeason(value: unknown): number | null {
  if (typeof value !== "number") return null;
  const season = value;
  return Number.isInteger(season) && season > 0 ? season : null;
}

/** Keep the banner and announcement on one response snapshot during cutover. */
export function retirementBannerSeason(status: RetirementStatus | null | undefined, fallbackSeason: number | null): number | null {
  if (!status?.announced_retirement) return null;
  // Older backend deployments only return the boolean. Retain their existing
  // behavior until the season-bearing response is available.
  return validSeason(status.retirement_after_season) ?? validSeason(fallbackSeason);
}
