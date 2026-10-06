import { randomUUID } from 'node:crypto';

type Client = { rpc: (name: string, args?: unknown) => PromiseLike<{ data: unknown; error: unknown }> };
type Options = { testNowFn?: () => Date; tokenFn?: () => string; force?: boolean;
  captureExceptionFn?: (error: Error, context?: unknown) => void };
type Pass = (renewLease: () => Promise<boolean>, token: string, targetVersion: string) => Promise<boolean>;

export async function getRankingRefreshWorkState(client: Client, now: Date): Promise<{
  pending: boolean; pendingAgeMs: number; lastCompletedAt: string | null;
}> {
  const { data, error } = await client.rpc('get_ranking_refresh_work_state', { p_now: now.toISOString() });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    const code = error && typeof error === 'object' ? (error as Record<string, unknown>).code : undefined;
    throw Object.assign(new Error('Ranking work state unavailable'), { code });
  }
  const state = data as Record<string, unknown>;
  if (typeof state.pending !== 'boolean' || typeof state.pending_age_ms !== 'number'
    || !Number.isFinite(state.pending_age_ms) || state.pending_age_ms < 0
    || state.last_completed_at !== null && typeof state.last_completed_at !== 'string') throw new Error('Invalid ranking work state');
  return { pending: state.pending, pendingAgeMs: state.pending_age_ms, lastCompletedAt: state.last_completed_at as string | null };
}

/** Database admission is authoritative across clients/processes and restarts. */
export async function runRankingRefreshWork(client: Client, pass: Pass, {
  testNowFn, tokenFn = randomUUID, force = false, captureExceptionFn,
}: Options = {}): Promise<boolean | 'coalesced'> {
  const token = tokenFn();
  // Production omits p_now: SQL takes authoritative time after row admission.
  const timeArgs = () => testNowFn ? { p_now: testNowFn().toISOString() } : {};
  try {
    const { data, error } = await client.rpc('claim_ranking_refresh_work', {
      p_token: token, p_force: force, ...timeArgs(),
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return false;
    const claim = data as Record<string, unknown>;
    if (claim.status === 'clean') return true;
    if (claim.status === 'busy') return 'coalesced';
    if (claim.status !== 'claimed' || claim.token !== token || typeof claim.target_version !== 'string'
      || !/^\d{1,19}$/.test(claim.target_version) || BigInt(claim.target_version) > 9223372036854775807n) return false;
    const target = claim.target_version;
    const renew = async () => {
      const result = await client.rpc('renew_ranking_refresh_work', { p_token: token, ...timeArgs() });
      return !result.error && result.data === true;
    };
    let success = false;
    try { success = await pass(renew, token, target); }
    catch { captureExceptionFn?.(new Error('Ranking snapshot pass failed'), { tags: { lib: 'rankingRefreshWork' } }); }
    const finished = await client.rpc('finish_ranking_refresh_work', {
      p_token: token, p_target_version: target, p_success: success, ...timeArgs(),
    });
    if (success && (finished.error || finished.data !== true)) {
      captureExceptionFn?.(new Error('Ranking completion not acknowledged'), { tags: { lib: 'rankingRefreshWork' } });
    }
    return success && !finished.error && finished.data === true;
  } catch {
    captureExceptionFn?.(new Error('Ranking coordinator unavailable'), { tags: { lib: 'rankingRefreshWork' } });
    return false;
  }
}
