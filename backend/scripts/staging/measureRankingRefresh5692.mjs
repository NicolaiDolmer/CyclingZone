import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { refreshRankingMatviewsSafe, refreshRankingMatviewsGated } from '../../lib/refreshRankingMatviews.js';

if (process.env.CZ_TARGET_ENV !== 'loadtest-staging'
  || process.env.SUPABASE_URL !== 'https://pywxpnynzmbukdvoiazp.supabase.co') throw new Error('Staging-only measurement');
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const views = ['rider_rankings_mv', 'team_standings_ext_mv', 'team_race_points_mv', 'global_rank_mv', 'youth_rider_rankings_mv'];
const rpc = client.rpc.bind(client);
const calls = [], passes = [], readers = [];
const phase = process.argv[3] ?? 'after';
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after phase');
// Copy this harness into the pinned baseline checkout to repeat the before run.
// Never label the new coordinator's forced-repair path as the old behavior.
if (phase === 'before' && readFileSync(new URL('../../lib/refreshRankingMatviews.js', import.meta.url), 'utf8').includes('runRankingRefreshWork')) {
  throw new Error('Before measurement requires the baseline helper checkout');
}
client.rpc = async (name, args) => {
  const start = performance.now();
  let settled = false;
  const pending = Promise.resolve(rpc(name, args)).then(result => {
    settled = true;
    calls.push({ name, durationMs: performance.now() - start, errorCode: result.error?.code ?? null });
    return result;
  }, error => { settled = true; throw error; });
  // The reader runs on a separate HTTP/DB connection while this RPC executes.
  if (name.startsWith('refresh_')) {
    const view = name.replace(/^refresh_/, '');
    while (!settled) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (settled) break;
      const readerStart = performance.now();
      const read = await client.from(view).select('*').limit(1);
      readers.push({ view, durationMs: performance.now() - readerStart, errorCode: read.error?.code ?? null });
    }
  }
  const result = await pending;
  return result;
};
let primed = null;
if (phase === 'after') {
  primed = await refreshRankingMatviewsSafe(client, { captureExceptionFn: () => {} });
  if (primed !== true) throw new Error('Staging priming failed');
  calls.length = 0; readers.length = 0;
}
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  const result = await (phase === 'after' ? refreshRankingMatviewsGated : refreshRankingMatviewsSafe)(client, { captureExceptionFn: () => {} });
  const ok = result === true;
  passes.push({ pass: i + 1, ok, durationMs: performance.now() - start });
  if (!ok) break;
}
const rowCounts = {};
for (const view of views) {
  const result = await client.from(view).select('*', { count: 'exact', head: true });
  if (result.error) throw new Error(`Count unavailable: ${view}`);
  rowCounts[view] = result.count;
}
const summary = {
  phase, primed, stagingRef: 'pywxpnynzmbukdvoiazp', resultRows: 1889644,
  passes, calls, readers, rowCounts,
  totalRefreshCalls: calls.filter(call => call.name.startsWith('refresh_')).length,
  meanPassMs: passes.reduce((sum, pass) => sum + pass.durationMs, 0) / passes.length,
  allSucceeded: passes.every(pass => pass.ok) && readers.every(read => !read.errorCode),
};
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ phase: summary.phase, stagingRef: summary.stagingRef, passes: summary.passes,
  totalRefreshCalls: summary.totalRefreshCalls, meanPassMs: summary.meanPassMs,
  readerSamples: readers.length, readerErrors: readers.filter(read => read.errorCode).length,
  rowCounts, allSucceeded: summary.allSucceeded, output }));
process.exitCode = summary.allSucceeded ? 0 : 1;
