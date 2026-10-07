/** Stable read-only wire shape; expected date slots are not recorded activities. */
export function trainingRunResponse<T extends Record<string, unknown>>(input: readonly T[] | null | undefined) {
  const todayRuns = (input ?? []).map(row => {
    const report = row.report && typeof row.report === 'object' && !Array.isArray(row.report)
      ? row.report as Record<string, unknown> : {};
    const day = row.game_day ?? report.game_day;
    return { ...row,
      game_days: typeof day === 'number' && Number.isInteger(day) ? [day] : [],
    };
  });
  return { todayRun: todayRuns[0] ?? null, todayRuns };
}
