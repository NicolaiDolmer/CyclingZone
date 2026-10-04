export const WATCHDOG_RESULT_BATCH_SIZE = 300;
export const WATCHDOG_RESULT_MIGRATION = 'database/2026-10-04-6102-watchdog-result-summary.sql';

export type WatchdogResultSummary = {
  race_id: string;
  last_imported_at: string | null;
  has_prize: boolean;
  stage_numbers: (number | null)[];
};

type SummaryClient = {
  rpc(name: 'stall_watchdog_result_summary', args: { p_race_ids: string[] }, options: { get: false }):
    PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function parseSummary(value: unknown): WatchdogResultSummary {
  if (typeof value !== 'object' || value === null || !('race_id' in value) || typeof value.race_id !== 'string'
    || !('last_imported_at' in value) || (value.last_imported_at !== null &&
      (typeof value.last_imported_at !== 'string' || !Number.isFinite(Date.parse(value.last_imported_at))))
    || !('has_prize' in value) || typeof value.has_prize !== 'boolean'
    || !('stage_numbers' in value) || !Array.isArray(value.stage_numbers)
    || !value.stage_numbers.every(stage => stage === null || Number.isInteger(stage))) {
    throw new Error('stall-watchdog result summary: malformed payload');
  }
  return value as WatchdogResultSummary;
}

export async function fetchWatchdogResultSummaries(supabase: SummaryClient, raceIds: readonly string[]) {
  const ids = [...new Set(raceIds)];
  const summaries = new Map<string, WatchdogResultSummary>();
  if (!ids.length) return summaries;
  if (ids.some(id => typeof id !== 'string' || !id)) throw new Error('stall-watchdog result summary: invalid candidate');
  for (let offset = 0; offset < ids.length; offset += WATCHDOG_RESULT_BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + WATCHDOG_RESULT_BATCH_SIZE);
    // POST keeps UUID arrays out of the URL; one row per input stays below PostgREST's row cap.
    const { data, error } = await supabase.rpc('stall_watchdog_result_summary', { p_race_ids: chunk }, { get: false });
    if (error) throw new Error(`stall-watchdog result summary: ${error.message ?? 'RPC failed'}`);
    if (!Array.isArray(data)) throw new Error('stall-watchdog result summary: missing payload');
    const expected = new Set(chunk);
    for (const value of data) {
      const row = parseSummary(value);
      if (!expected.delete(row.race_id)) throw new Error('stall-watchdog result summary: duplicate or unexpected candidate');
      summaries.set(row.race_id, row);
    }
    if (expected.size) throw new Error('stall-watchdog result summary: incomplete candidates');
  }
  return summaries;
}
