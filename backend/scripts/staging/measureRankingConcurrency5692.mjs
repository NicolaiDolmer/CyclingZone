import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { refreshRankingMatviewsSafe, refreshRankingMatviewsGated } from '../../lib/refreshRankingMatviews.js';
import { runRankingRefreshWork } from '../../lib/rankingRefreshWork.ts';

if (process.env.CZ_TARGET_ENV !== 'loadtest-staging'
  || process.env.SUPABASE_URL !== 'https://pywxpnynzmbukdvoiazp.supabase.co') throw new Error('Staging-only measurement');
const make = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const a = make(), b = make();
const raw = a.rpc.bind(a);
let attempted = false, bPasses = 0, refreshCalls = 0, competingResult;
a.rpc = async (name, args) => {
  const pending = Promise.resolve(raw(name, args));
  if (name.startsWith('refresh_')) {
    refreshCalls++;
    if (!attempted) {
      attempted = true;
      // A new explicit repair request arrives while A owns the actual pass.
      competingResult = await runRankingRefreshWork(b, async () => { bPasses++; return true; }, { force: true });
    }
  }
  return pending;
};
const first = await refreshRankingMatviewsSafe(a, { captureExceptionFn: () => {} });
const middle = await raw('get_ranking_refresh_work_state');
const callsAfterFirst = refreshCalls;
const followup = await refreshRankingMatviewsGated(a, { captureExceptionFn: () => {} });
const final = await raw('get_ranking_refresh_work_state');
const summary = { stagingRef: 'pywxpnynzmbukdvoiazp', first, competingResult, competingHeavyPasses: bPasses,
  callsAfterFirst, laterArrivalRetained: middle.data?.pending === true,
  followup, totalRefreshCalls: refreshCalls, allComplete: final.data?.pending === false };
writeFileSync(process.argv[2], JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
process.exitCode = first === true && competingResult === 'coalesced' && bPasses === 0 && callsAfterFirst === 5
  && summary.laterArrivalRetained && followup === true && refreshCalls === 10 && summary.allComplete ? 0 : 1;
