// Staging only. Both the historical function substitution and rollover are rolled back.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { assertIsolation, STAGING_REF } from './assertLoadtestIsolation.mjs';

export function assessRolloverEvidence(samples) {
  if (samples.length !== 2) return false;
  const [before, after] = samples;
  return before.phase === 'before' && after.phase === 'after'
    && before.readerCode === '55P03' && after.readerCode === null
    && before.rows > 0 && before.rolledBack && after.rolledBack
    && ['rows', 'points', 'ranks', 'snapshot'].every(key => before[key] === after[key]);
}

const fingerprints = `SELECT json_build_object(
  'rows',(SELECT count(*) FROM public.global_rank_mv),
  'points',(SELECT md5(string_agg((to_jsonb(t)-'updated_at')::text,',' ORDER BY team_id)) FROM public.team_global_rank_points t),
  'ranks',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY team_id)) FROM public.global_rank_mv t),
  'snapshot',(SELECT md5(string_agg((to_jsonb(t)-'captured_at')::text,',' ORDER BY team_id)) FROM public.global_rank_season_start_snapshot t)
)::text;`;

function session(env) {
  const db = new URL(env.SUPABASE_DB_URL);
  assert.equal(db.hostname, `db.${STAGING_REF}.supabase.co`, 'STAGING_DB_HOST_REQUIRED');
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    env: { ...env, PGHOST: db.hostname, PGPORT: db.port || '5432', PGDATABASE: db.pathname.slice(1),
      PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
      PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15', PSQL_HISTORY: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '', err = '';
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  child.stdout.on('data', data => { out += data; if (out.includes('ROLLOVER_READY')) readyResolve(true); });
  child.stderr.on('data', data => { err += data; });
  const done = new Promise((resolve, reject) => {
    child.on('error', () => { readyResolve(false); reject(new Error('PSQL_START_FAILED')); });
    child.on('close', code => { readyResolve(false); resolve({ code, out, sqlstate: /ERROR:\s+([0-9A-Z]{5}):/.exec(err)?.[1] ?? null }); });
  });
  // Drain rejection even if startup fails before the caller awaits completion.
  void done.catch(() => {});
  const timer = setTimeout(() => child.kill(), 90_000);
  void done.finally(() => clearTimeout(timer)).catch(() => {});
  return { child, ready, done };
}

async function query(env, sql) {
  const s = session(env);
  s.child.stdin.end(sql + '\n\\q\n');
  return s.done;
}
function fingerprint(result) {
  assert.equal(result.code, 0, `PSQL_FAILED_${result.sqlstate ?? 'TRANSPORT'}`);
  return JSON.parse(result.out.split(/\r?\n/).find(line => line.startsWith('{')));
}

export async function measure(env, output) {
  assert.equal((await assertIsolation(env)).status, 'ISOLATED', 'ISOLATION_REQUIRED');
  const initial = fingerprint(await query(env, fingerprints));
  const samples = [];
  for (const phase of ['before', 'after']) {
    const writer = session(env);
    const start = performance.now();
    writer.child.stdin.write(`BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='30s';
DO $probe$ DECLARE definition text; BEGIN
  SELECT pg_get_functiondef('public.apply_global_rank_season_rollover(uuid)'::regprocedure) INTO definition;
  IF position('REFRESH MATERIALIZED VIEW CONCURRENTLY public.global_rank_mv;' IN definition)=0
    OR position('pg_advisory_xact_lock(hashtextextended(''cz-ranking-refresh'',0))' IN definition)=0 THEN
    RAISE EXCEPTION 'Expected deployed concurrent rollover';
  END IF;
  ${phase === 'before' ? `definition:=replace(definition,'PERFORM pg_advisory_xact_lock(hashtextextended(''cz-ranking-refresh'',0)); REFRESH MATERIALIZED VIEW CONCURRENTLY public.global_rank_mv;', 'REFRESH MATERIALIZED VIEW public.global_rank_mv;'); EXECUTE definition;` : ''}
END $probe$;
SELECT public.apply_global_rank_season_rollover((SELECT id FROM public.seasons
 WHERE number < (SELECT max(number) FROM public.seasons WHERE status='active') ORDER BY number DESC LIMIT 1));
${fingerprints}
\\echo ROLLOVER_READY
`);
    let reader;
    let durationMs;
    try {
      assert.equal(await writer.ready, true, 'ROLLOVER_DID_NOT_FINISH');
      durationMs = performance.now() - start;
      // Locks survive until transaction end. The writer stays open until this reader finishes.
      reader = await query(env, "SET statement_timeout='5s'; SET lock_timeout='500ms'; SELECT count(*) FROM public.global_rank_mv;");
    } finally {
      writer.child.stdin.end('ROLLBACK;\n\\q\n');
    }
    const result = fingerprint(await writer.done);
    const restored = fingerprint(await query(env, fingerprints));
    samples.push({ phase, durationMs, readerCode: reader.code === 0 ? null : reader.sqlstate ?? 'TRANSPORT',
      ...result, rolledBack: JSON.stringify(restored) === JSON.stringify(initial) });
  }
  const evidence = { stagingRef: STAGING_REF, method: 'transaction-held writer lock; rollback after each phase',
    measuredAt: new Date().toISOString(), samples, passed: assessRolloverEvidence(samples), fullRaceDayPassed: false };
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  return evidence.passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv[2], 'OUTPUT_REQUIRED');
    process.exitCode = await measure(process.env, process.argv[2]) ? 0 : 1;
  } catch { console.error('ROLLOVER_MEASUREMENT_BLOCKED'); process.exitCode = 1; }
}
