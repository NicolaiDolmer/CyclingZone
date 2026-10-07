interface StageCounts { byTier?: Record<number, number>; fallbackDays?: number }

// A missing future calendar is not a sixty-stage calendar. Only reuse the
// current club's own pool as an explicitly provisional display estimate.
export function resolveSponsorCalendarPreview(
  stageCounts: StageCounts | null, division: number | null,
  currentStages: number | null, currentDivision: number | null,
): { count: number | null; estimated: boolean } {
  const next = Number(division != null ? stageCounts?.byTier?.[division] : null);
  if (Number.isFinite(next) && next > 0) return { count: next, estimated: false };
  const current = Number(currentStages);
  if (division != null && Number(division) === Number(currentDivision)
      && Number.isFinite(current) && current > 0) return { count: current, estimated: true };
  return { count: null, estimated: true };
}
