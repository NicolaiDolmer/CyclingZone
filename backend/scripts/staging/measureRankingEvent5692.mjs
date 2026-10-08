import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { requestRankingMatviewRefresh } from '../../lib/refreshRankingMatviews.js';

if (process.env.CZ_TARGET_ENV !== 'loadtest-staging'
  || process.env.SUPABASE_URL !== 'https://pywxpnynzmbukdvoiazp.supabase.co') throw new Error('Staging-only measurement');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const initial = await db.rpc('get_ranking_refresh_work_state');
if (initial.error || initial.data?.pending !== true) throw new Error('A committed staging event is required');
let resolvePass;
const finished = new Promise(resolve => { resolvePass = resolve; });
const rpc = db.rpc.bind(db), calls = [];
db.rpc = async (name, args) => {
  const start = performance.now(); const result = await rpc(name, args);
  calls.push({ name, durationMs: performance.now() - start, errorCode: result.error?.code ?? null });
  if (name === 'finish_ranking_refresh_work' && args.p_success === true && result.data === true) resolvePass();
  return result;
};
const start = performance.now();
const result = await requestRankingMatviewRefresh(db, {
  // Keep this standalone measurement alive; the production server owns liveness.
  setTimer: (fn, ms) => { setTimeout(fn, ms); return { unref() {} }; },
  captureExceptionFn: () => {},
});
const publicationWaitMs = performance.now() - start;
const deadline = setTimeout(() => resolvePass(), 240_000);
await finished; clearTimeout(deadline);
const completed = await rpc('get_ranking_refresh_work_state');
const summary = { stagingRef: 'pywxpnynzmbukdvoiazp', eventRegistered: initial.data.pending,
  wakeupResult: result, publicationWaitMs, completionMs: performance.now() - start,
  refreshCalls: calls.filter(call => call.name.startsWith('refresh_')).length,
  allComplete: !completed.error && completed.data?.pending === false, calls };
writeFileSync(process.argv[2], JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, calls: undefined }));
process.exitCode = summary.allComplete && summary.refreshCalls === 5 && summary.completionMs < 300_000 ? 0 : 1;
