import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
const { assertIsolation } = await import('./assertLoadtestIsolation.mjs');
assert.equal((await assertIsolation()).status, 'ISOLATED');
const measures = [];
let reference;
for (let sample = 0; sample < 3; sample++) {
  for (const [mode, calls] of [['before', 2], ['after', 1]]) {
    let rows = 0;
    const durations = [];
    const start = performance.now();
    for (let call = 0; call < calls; call++) {
      const t = performance.now();
      let response;
      try { response = await fetch(new URL('/rest/v1/rpc/feature_liveness_table_counts', process.env.SUPABASE_URL), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: '{}',
      }); } catch { throw new Error('RPC_REQUEST_FAILED'); }
      if (!response.ok) throw new Error(`RPC_FAILED_HTTP_${response.status}`);
      let result;
      try { result = await response.json(); } catch { throw new Error('RPC_JSON_INVALID'); }
      if (!Array.isArray(result) || !result.length || result.some(row => !row
        || typeof row.table_name !== 'string' || !row.table_name.length
        || !Number.isSafeInteger(row.row_count) || row.row_count < 0
        || typeof row.rls_enabled !== 'boolean' || typeof row.estimated !== 'boolean')) {
        throw new Error('RPC_ROWS_INVALID');
      }
      reference ??= result;
      if (!isDeepStrictEqual(result, reference)) throw new Error('RPC_ROWS_CHANGED');
      rows += result.length;
      durations.push(performance.now() - t);
    }
    measures.push({ sample, mode, calls, rows, elapsedMs: performance.now() - start, meanCallMs: durations.reduce((a,b) => a+b,0)/calls });
  }
}
const summary = { target: 'loadtest-staging', stagingRef: 'pywxpnynzmbukdvoiazp', tableRows: reference.length,
  identicalRows: true, rpcUnchanged: true, samples: measures, before: {}, after: {} };
for (const mode of ['before', 'after']) {
  const group = measures.filter(m => m.mode === mode);
  summary[mode] = { callsPerRun: group[0].calls, rowsPerRun: group[0].rows,
    meanRunMs: group.reduce((s,m)=>s+m.elapsedMs,0)/group.length,
    meanCallMs: group.reduce((s,m)=>s+m.meanCallMs,0)/group.length };
}
await writeFile('docs/audits/6184-feature-liveness-staging.json', JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
