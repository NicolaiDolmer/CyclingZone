// Pure helpers for /api/admin/cron-runs (slice 07e Fase B).
// Grupperer finance_transactions-rows der stammer fra samme cron-tick
// eller request-burst, så admin kan drille ned i én batch ad gangen.
//
// Definition af "samme run":
//   1) samme (actor_id, source_path)
//   2) created_at-diff til foregående row i samme gruppe <= windowSeconds
//
// Rows uden actor_id eller source_path filtreres fra (legacy/NULL).

export const DEFAULT_WINDOW_SECONDS = 5;

function toMs(iso) {
  return new Date(iso).getTime();
}

export function groupCronRuns(rows, { windowSeconds = DEFAULT_WINDOW_SECONDS } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const windowMs = windowSeconds * 1000;

  const eligible = rows.filter((r) => r && r.actor_id && r.source_path && r.created_at);
  eligible.sort((a, b) => {
    if (a.actor_id !== b.actor_id) return a.actor_id < b.actor_id ? -1 : 1;
    if (a.source_path !== b.source_path) return a.source_path < b.source_path ? -1 : 1;
    return toMs(a.created_at) - toMs(b.created_at);
  });

  const runs = [];
  let current = null;
  for (const row of eligible) {
    const ts = toMs(row.created_at);
    const sameGroup =
      current &&
      current.actor_id === row.actor_id &&
      current.source_path === row.source_path &&
      ts - current._lastTs <= windowMs;

    if (!sameGroup) {
      if (current) runs.push(finalizeRun(current));
      current = {
        actor_id: row.actor_id,
        source_path: row.source_path,
        started_at: row.created_at,
        ended_at: row.created_at,
        _startTs: ts,
        _lastTs: ts,
        tx_count: 0,
        total_amount: 0,
        reason_codes: new Set(),
        affected_teams: new Set(),
      };
    }
    current.tx_count += 1;
    current.total_amount += Number(row.amount) || 0;
    if (row.reason_code) current.reason_codes.add(row.reason_code);
    if (row.team_id) current.affected_teams.add(row.team_id);
    current.ended_at = row.created_at;
    current._lastTs = ts;
  }
  if (current) runs.push(finalizeRun(current));

  runs.sort((a, b) => toMs(b.started_at) - toMs(a.started_at));
  return runs;
}

function finalizeRun(run) {
  return {
    actor_id: run.actor_id,
    source_path: run.source_path,
    started_at: run.started_at,
    ended_at: run.ended_at,
    tx_count: run.tx_count,
    total_amount: run.total_amount,
    reason_codes: [...run.reason_codes].sort(),
    affected_teams: [...run.affected_teams],
  };
}
