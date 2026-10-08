// Isolated staging benchmark. Never imports cron, scheduler or notification dispatch.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { assertIsolation, STAGING_REF } from './assertLoadtestIsolation.mjs';
import { fetchWatchdogState, evaluateStallFindings } from '../../lib/stallWatchdog.js';

const baselinePath = new URL('../../lib/.codex-watchdog-baseline.mjs', import.meta.url);
const now = new Date('2026-10-07T09:00:00Z');
const marker = 'database/2026-10-07-6102-watchdog-result-summary.sql';
let phase = 'isolation';
let baselineCreated = false;
try {
  assert.equal((await assertIsolation()).status, 'ISOLATED');
  assert.equal(process.argv[2], '--apply-staging-proposal');
  const db = new URL(process.env.SUPABASE_DB_URL);
  assert.equal(db.hostname, `db.${STAGING_REF}.supabase.co`);
  function sql(statement) {
    const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: statement, encoding: 'utf8', timeout: 120_000, windowsHide: true,
      env: { ...process.env, PGHOST: db.hostname, PGPORT: db.port || '5432',
        PGDATABASE: db.pathname.slice(1), PGUSER: decodeURIComponent(db.username),
        PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' },
    });
    assert.equal(result.status, 0, 'STAGING_SQL_FAILED');
    return result.stdout.trim();
  }
  phase = 'staging-proposal';
  const proposal = readFileSync(new URL('../../../database/2026-10-07-6102-watchdog-result-summary.sql', import.meta.url), 'utf8');
  // Register only after the exact function/ACL transaction succeeded on staging.
  sql(proposal);
  sql(`INSERT INTO public.schema_migrations(filename) VALUES ('${marker}') ON CONFLICT DO NOTHING;`);
  const access = JSON.parse(sql(`SELECT json_build_object(
    'anon',has_function_privilege('anon','public.stall_watchdog_result_summary(uuid[])','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.stall_watchdog_result_summary(uuid[])','EXECUTE'),
    'service_role',has_function_privilege('service_role','public.stall_watchdog_result_summary(uuid[])','EXECUTE'));`));
  assert.deepEqual(access, { anon: false, authenticated: false, service_role: true });
  const baselineSha = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
  writeFileSync(baselinePath, execFileSync('git', ['show', `${baselineSha}:backend/lib/stallWatchdog.js`]), { flag: 'wx' });
  baselineCreated = true;
  const baseline = await import(baselinePath.href);
  const samples = [], states = [], findings = [];
  for (const [name, fetchState] of [['before', baseline.fetchWatchdogState], ['after', fetchWatchdogState]]) {
    phase = name;
    const requests = [];
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input));
        const start = performance.now();
        const response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(90_000) });
        const data = await response.clone().json();
        requests.push({ path: url.pathname, ms: performance.now()-start, status: response.status,
          rows: Array.isArray(data) ? data.length : data == null ? 0 : 1, urlBytes: Buffer.byteLength(url.href) });
        return response;
      } },
    });
    const start = performance.now();
    const state = await fetchState({ supabase: client, now, autoPrizeEnabled: true });
    states.push(state);
    findings.push(evaluateStallFindings({ ...state, now, autoPrizeEnabled: true }));
    samples.push({ phase: name, durationMs: performance.now()-start, calls: requests.length,
      rows: requests.reduce((n,r)=>n+r.rows,0), maxUrlBytes: Math.max(...requests.map(r=>r.urlBytes)),
      requests });
  }
  phase = 'parity';
  assert.deepEqual(states[1], states[0]);
  assert.deepEqual(findings[1], findings[0]);
  assert.ok(samples.every(s=>s.maxUrlBytes < 8192 && s.requests.every(r=>r.status < 400)));
  const ids = [...new Set([...Object.keys(states[0].lastResultByRace), ...states[0].dueStages.map(s=>s.race_id)])];
  assert.ok(ids.length > 0 && ids.every(id=>/^[0-9a-f-]{36}$/i.test(id)), 'PINNED_CANDIDATES_REQUIRED');
  const plans = JSON.parse(sql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT max(imported_at),bool_or(prize_money>0),array_agg(DISTINCT stage_number) FROM public.race_results WHERE race_id='${ids[0]}'::uuid;`));
  const nodes=[];
  function visit(plan) { nodes.push({ type: plan['Node Type'], index: plan['Index Name'] ?? null, rows: plan['Actual Rows'] }); for(const child of plan.Plans ?? []) visit(child); }
  visit(plans[0].Plan);
  const report = { stagingRef: STAGING_REF, baselineSha, pinnedNow: now.toISOString(),
    resultRows: Number(sql('SELECT count(*) FROM public.race_results;')), candidates: ids.length,
    identicalStates: true, identicalFindings: true, findingCount: findings[0].length, access, samples,
    explain: { executionMs: plans[0]['Execution Time'], nodes }, fullRaceDayPassed: false };
  writeFileSync(new URL('../../../docs/audits/6102-watchdog-staging.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ ...report, samples: samples.map(({ requests: _requests, ...s })=>s) }));
} catch {
  console.error(JSON.stringify({ status: 'WATCHDOG_MEASUREMENT_BLOCKED', phase })); process.exitCode=1;
} finally {
  // Only this harness's exclusive temporary baseline file; never a shared checkout.
  if (baselineCreated) unlinkSync(fileURLToPath(baselinePath));
}
