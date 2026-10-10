import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_URL_BYTES, PHASES, RANKING_SLA_MS, WRAPPER_MARKER,
  checkViewerToken, classifyRequest, computeTicks, createFaultController, createInstrumentedFetch, createRecorder,
  evaluateOracles, evaluateRun, nextCopenhagenMidnightMs, parseArgs, runRaceDaySim, urlBytes, validatePlan,
} from './race-day-sim.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';

const STAGING_REF = 'pywxpnynzmbukdvoiazp';
const PROD_REF = 'ghwvkxzhsbbltzfnuhhz';
const ORIGIN = `https://${STAGING_REF}.supabase.co`;
const CLOCK = '2026-10-06T00:00:00+02:00';
const CLOCK_MS = Date.parse(CLOCK);

const wrapperEnv = () => ({
  [WRAPPER_MARKER]: '1', CZ_TARGET_ENV: 'loadtest-staging', SUPABASE_URL: ORIGIN,
  SUPABASE_SERVICE_KEY: 'fixture-secret-never-print', SUPABASE_DB_URL: `postgresql://u@db.${STAGING_REF}.supabase.co:5432/postgres`,
});

function jwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(payload)}.sig`;
}
const stagingToken = (nowMs = Date.now()) => jwt({ iss: `${ORIGIN}/auth/v1`, exp: Math.floor(nowMs / 1000) + 4 * 3600 });

function options(extra = {}) {
  const { errors, options: opts } = parseArgs(['--clock', CLOCK, '--season', '4', '--min-results', '1931805', '--viewer-token-file', 'token.txt']);
  assert.deepEqual(errors, []);
  return { ...opts, ...extra };
}

// ─── Fake løbsdag: en lille verden der kører gennem den ÆGTE fetch-instrumentering ───

const SLOT_HOURS = [[10, 0], [11, 0], [12, 30], [14, 0], [15, 0], [16, 0], [17, 30], [19, 0], [20, 0]];
const SQUAD_ORDER = ['senior', 'u23', 'junior'];

function makeWorld() {
  const races = SLOT_HOURS.map(([h, m], i) => ({
    id: `race-uuid-${i}`, squad: SQUAD_ORDER[i % 3], stages: 1, stagesCompleted: 0, status: 'scheduled',
    finalizeState: null, prizePaid: false, scheduledAtMs: CLOCK_MS + (h * 60 + m) * 60 * 1000,
  }));
  return { races, runs: [], finance: [], board: [], results: {} };
}

function makeFakeLive(world, behaviour = {}) {
  return async ({ recorder, faults, als, getPhase }) => {
    let restarts = 0;
    const baseFetch = async (url, init) => {
      if (behaviour.lockTimeoutInNormal && getPhase() === 'normal' && String(url).includes('race_stage_schedule') && !behaviour.lockTimeoutDone) {
        behaviour.lockTimeoutDone = true;
        return new Response('{"code":"55P03","message":"canceling statement due to lock timeout"}', { status: 500 });
      }
      return new Response(init?.method === 'HEAD' ? null : '[]', { status: 200 });
    };
    const f = createInstrumentedFetch({ baseFetch, als, getPhase, recorder, faults });
    const aliasOf = new Map(world.races.map((r, i) => [r.id, `R${String(i + 1).padStart(2, '0')}`]));

    async function finishRace(race) {
      await f(`${ORIGIN}/rest/v1/board_satisfaction_events`, { method: 'POST' });
      world.board.push({ raceId: race.id, teamId: 'team-x' });
      await f(`${ORIGIN}/rest/v1/races?id=eq.${race.id}`, { method: 'PATCH' });
      race.finalizeState = null;
      if (race.stagesCompleted >= race.stages) race.status = 'completed';
    }

    return {
      async loadPlan() {
        return {
          activeSeasonCount: 1, activeSeasonNumber: 4,
          slots: world.races.map(r => ({ raceId: r.id, alias: aliasOf.get(r.id), stageNumber: 1, squad: r.squad, scheduledAtMs: r.scheduledAtMs })),
          races: world.races.map(r => ({ id: r.id, alias: aliasOf.get(r.id) })), raceCount: world.races.length,
          backlogBeforeClock: 0, finalizeStatePresent: 0, existingRunsForSlots: 0, capBaselineRuns: 0,
          flags: { stage_scheduler_enabled: true, race_engine_v2: true, auto_prize: true },
        };
      },
      async runTick(now) {
        const counter = { dbCalls: 0 };
        const result = { ran: 0, errors: 0, resumed: 0 };
        let threw = false;
        await als.run({ kind: 'tick', counter }, async () => {
          try {
            await f(`${ORIGIN}/rest/v1/race_stage_schedule?select=race_id&scheduled_at=lte.${now.toISOString()}`);
            for (const race of world.races.filter(r => r.finalizeState)) {
              if (behaviour.brokenResume) continue;
              await als.run({ kind: 'tick', counter, race: race.id, raceAlias: aliasOf.get(race.id) }, async () => {
                try { await finishRace(race); result.resumed++; } catch { result.errors++; }
              });
            }
            for (const race of world.races) {
              if (race.status === 'completed' || race.finalizeState || race.scheduledAtMs > now.getTime()) continue;
              await als.run({ kind: 'tick', counter, race: race.id, raceAlias: aliasOf.get(race.id) }, async () => {
                try {
                  await f(`${ORIGIN}/rest/v1/races?id=eq.${race.id}`);
                  await f(`${ORIGIN}/rest/v1/rpc/apply_stage_result`, { method: 'POST' });
                  world.runs.push({ raceId: race.id, stageNumber: 1 });
                  if (behaviour.duplicateRun === race.id) world.runs.push({ raceId: race.id, stageNumber: 1 });
                  race.stagesCompleted = 1;
                  world.results[`${race.id}#1`] = 120;
                  await f(`${ORIGIN}/rest/v1/races?id=eq.${race.id}`, { method: 'PATCH' });
                  race.finalizeState = { stage_index: 0 };
                  await finishRace(race);
                  result.ran++;
                } catch { result.errors++; }
              });
            }
          } catch { threw = true; }
        });
        await als.run({ kind: 'cron', counter: { dbCalls: 0 } }, async () => {
          for (const race of world.races.filter(r => r.status === 'completed' && !r.prizePaid)) {
            try {
              await f(`${ORIGIN}/rest/v1/finance_transactions`, { method: 'POST' });
              world.finance.push({ raceId: race.id, teamId: 'team-x', type: 'prize' });
              if (behaviour.duplicatePrize === race.id) world.finance.push({ raceId: race.id, teamId: 'team-x', type: 'prize' });
              race.prizePaid = true;
            } catch { /* afregning prøves igen næste tick */ }
          }
        });
        // Spillerlæsninger: en ideel backend verificerer tokenet mod Auth og læser derefter
        // DB; når en af dem er nede, svarer den entydigt 503.
        for (let i = 0; i < 3; i++) {
          let status = 200; let code503 = null;
          try { await f(`${ORIGIN}/auth/v1/user`); } catch { status = 503; code503 = 'auth_unavailable'; }
          if (status === 200) {
            try { await f(`${ORIGIN}/rest/v1/global_rank_mv?select=team_id`); } catch { status = 503; code503 = 'db_unavailable'; }
          }
          if (behaviour.cacheAuthorizes && i === 2 && faults.mode() === 'auth_down') { status = 200; code503 = null; }
          recorder.recordHttp(getPhase(), { status, ms: 5, code503 });
        }
        return { ms: 12, dbCalls: counter.dbCalls, cronDbCalls: 0, result, threw };
      },
      async raceStates(ids) {
        return world.races.filter(r => ids.includes(r.id)).map(r => ({ id: r.id, status: r.status, stagesCompleted: r.stagesCompleted, finalizeState: r.finalizeState, prizePaid: r.prizePaid }));
      },
      async stageResultCount(raceId, stage) { return world.results[`${raceId}#${stage}`] ?? 0; },
      async rankingsReady() { return true; },
      startReaders() { return { stop: async () => {} }; },
      sampleDb() { return { connections: 12, waitingLocks: 0, blksRead: 100, blksHit: 1000, tempBytes: 0, deadlocks: 0 }; },
      async restart() { restarts++; world.restarts = restarts; },
      async collectOracle() {
        const runsBySlot = {};
        for (const r of world.races) runsBySlot[`${aliasOf.get(r.id)}#1`] = world.runs.filter(x => x.raceId === r.id).length;
        const dup = (rows, key) => { const m = new Map(); for (const row of rows) m.set(key(row), (m.get(key(row)) ?? 0) + 1); return [...m].filter(([, n]) => n > 1).map(([k]) => k); };
        return {
          runsBySlot,
          financeDup: dup(world.finance, r => `${r.raceId}|${r.teamId}|${r.type}`).map(k => ({ alias: aliasOf.get(k.split('|')[0]), type: 'prize' })),
          boardDup: dup(world.board, r => `${r.raceId}|${r.teamId}`).map(k => aliasOf.get(k.split('|')[0])),
          races: world.races.map(r => ({ alias: aliasOf.get(r.id), status: r.status, finalizeState: !!r.finalizeState, prizePaid: r.prizePaid })),
          finalResultCounts: Object.fromEntries(world.races.map(r => [`${aliasOf.get(r.id)}#1`, world.results[`${r.id}#1`] ?? 0])),
        };
      },
      async close() {},
    };
  };
}

function makeDeps({ env = wrapperEnv(), isolation, prerequisites, live, token } = {}) {
  let t = Date.parse('2026-10-10T08:00:00Z');
  const calls = { isolation: 0, prerequisites: [], live: 0, reports: [] };
  return {
    calls,
    deps: {
      env,
      now: () => (t += 1000),
      sleep: async (ms) => { t += ms; },
      assertIsolation: async () => { calls.isolation++; return isolation ?? { status: 'ISOLATED', blockers: [] }; },
      checkPrerequisites: async (config) => {
        calls.prerequisites.push(config);
        return prerequisites ?? { status: 'DATA_PREREQUISITES_READY', resultRows: 1931806, blockers: [] };
      },
      readFile: () => token ?? stagingToken(t),
      createLive: async (args) => { calls.live++; if (!live) throw Object.assign(new Error('x'), { code: 'NO_FAKE' }); return live(args); },
      writeReport: (dir, name, md) => { calls.reports.push({ name, md }); return `${dir}/${name}`; },
    },
  };
}

// ─── Argumenter + ur ───

test('args: pinned clock with offset, season, min-results and token file are mandatory; no default volume', () => {
  assert.ok(parseArgs([]).errors.includes('USAGE_REQUIRE_PINNED_CLOCK'));
  assert.ok(parseArgs([]).errors.includes('USAGE_REQUIRE_MIN_RESULTS'));
  assert.ok(parseArgs([]).errors.includes('USAGE_REQUIRE_SEASON'));
  assert.ok(parseArgs([]).errors.includes('USAGE_REQUIRE_VIEWER_TOKEN_FILE'));
  // Uden offset ville uret afhænge af maskinens tidszone: afvist.
  assert.ok(parseArgs(['--clock', '2026-10-06T00:00:00', '--season', '4', '--min-results', '1', '--viewer-token-file', 'x']).errors.includes('USAGE_REQUIRE_PINNED_CLOCK'));
  assert.ok(parseArgs(['--clock', CLOCK, '--season', '4', '--min-results', '0', '--viewer-token-file', 'x']).errors.includes('USAGE_REQUIRE_MIN_RESULTS'));
  assert.ok(parseArgs(['--clock', CLOCK, '--bogus', '1']).errors.includes('USAGE_UNKNOWN_FLAG:bogus'));
  const ok = options();
  assert.equal(ok.clockMs, CLOCK_MS);
  assert.equal(ok.minResults, 1931805);
  assert.equal(ok.untilMs - ok.clockMs, 24 * 3600 * 1000);
});

test('clock: the window ends at the next Copenhagen midnight, also on the 25-hour DST day', () => {
  const dst = Date.parse('2026-10-25T00:00:00+02:00');
  assert.equal(nextCopenhagenMidnightMs(dst) - dst, 25 * 3600 * 1000);
  const ticks = computeTicks(CLOCK_MS, CLOCK_MS + 3600 * 1000);
  assert.equal(ticks.length, 12);
  assert.equal(ticks[0], CLOCK_MS + 5000);
  assert.ok(ticks.every((t, i) => i === 0 || t - ticks[i - 1] === 5 * 60 * 1000));
});

// ─── Isolation + fail-closed ───

test('isolation: without the wrapper marker nothing is checked, contacted or started', async () => {
  const env = wrapperEnv();
  delete env[WRAPPER_MARKER];
  const { deps, calls } = makeDeps({ env });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.verdict.loadTestPassed, false);
  assert.ok(r.verdict.blockers.includes('NOT_STARTED_VIA_WRAPPER'));
  assert.equal(calls.isolation, 0);
  assert.equal(calls.prerequisites.length, 0);
  assert.equal(calls.live, 0);
  assert.equal(calls.reports.length, 1);
  assert.match(calls.reports[0].md, /loadTestPassed: false/);
});

test('isolation: a prod DB URL or a cron-enabling env blocks before any network call', async () => {
  for (const patch of [{ SUPABASE_DB_URL: `postgresql://u@db.${PROD_REF}.supabase.co/postgres` }, { RAILWAY_ENVIRONMENT_NAME: 'production' }, { CRON_FORCE_LOCAL: '1' }]) {
    const { deps, calls } = makeDeps({ env: { ...wrapperEnv(), ...patch } });
    const r = await runRaceDaySim(options(), deps);
    assert.equal(r.status, 'BLOCKED');
    assert.equal(calls.isolation, 0);
  }
});

test('isolation: a BLOCKED isolation check stops before prerequisites and the live run', async () => {
  const { deps, calls } = makeDeps({ isolation: { status: 'BLOCKED', blockers: ['DB_DISCORD_WEBHOOKS_PRESENT'] } });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.status, 'BLOCKED');
  assert.deepEqual(r.verdict.blockers, ['ISOLATION:DB_DISCORD_WEBHOOKS_PRESENT']);
  assert.equal(calls.prerequisites.length, 0);
  assert.equal(calls.live, 0);
});

test('fail-closed: too small volume blocks; the limit is passed through unchanged, never lowered', async () => {
  const { deps, calls } = makeDeps({ prerequisites: { status: 'BLOCKED', resultRows: 1889644, blockers: ['RESULT_VOLUME_TOO_SMALL'] } });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.status, 'BLOCKED');
  assert.deepEqual(r.verdict.blockers, ['PREREQUISITE:RESULT_VOLUME_TOO_SMALL']);
  assert.equal(calls.prerequisites[0].minResults, 1931805);
  assert.equal(calls.prerequisites[0].url, ORIGIN);
  assert.equal(calls.prerequisites[0].ref, STAGING_REF);
  assert.equal(calls.live, 0);
});

test('fail-closed: a viewer token from another project or about to expire blocks', () => {
  const now = Date.now();
  assert.deepEqual(checkViewerToken('nope', now), ['VIEWER_TOKEN_INVALID']);
  assert.ok(checkViewerToken(jwt({ iss: `https://${PROD_REF}.supabase.co/auth/v1`, exp: now / 1000 + 9999 }), now).includes('VIEWER_TOKEN_NOT_STAGING'));
  assert.ok(checkViewerToken(jwt({ iss: `${ORIGIN}/auth/v1`, exp: now / 1000 + 60 }), now).includes('VIEWER_TOKEN_EXPIRES_TOO_SOON'));
  assert.deepEqual(checkViewerToken(stagingToken(now), now), []);
});

test('fail-closed: plan validation demands all three squads, no backlog, no half-finalized race and staging flags on', () => {
  const ticks = computeTicks(CLOCK_MS, CLOCK_MS + 86400000);
  const slots = [10, 12, 14, 16, 18].map((h, i) => ({ squad: i < 3 ? 'senior' : 'junior', scheduledAtMs: CLOCK_MS + h * 3600000, dueTickIndex: h * 12 }));
  const plan = { activeSeasonCount: 1, activeSeasonNumber: 4, slots, backlogBeforeClock: 2, finalizeStatePresent: 1, existingRunsForSlots: 0, capBaselineRuns: 0, flags: { stage_scheduler_enabled: true, race_engine_v2: false } };
  const b = validatePlan(plan, { season: 4, clockMs: CLOCK_MS, untilMs: CLOCK_MS + 86400000 });
  assert.ok(b.includes('PLAN_SQUAD_WITHOUT_SLOTS:u23'));
  assert.ok(!b.includes('PLAN_SQUAD_WITHOUT_SLOTS:senior'));
  assert.ok(b.includes('PLAN_BACKLOG_BEFORE_CLOCK'));
  assert.ok(b.includes('PLAN_FINALIZE_STATE_PRESENT'));
  assert.ok(b.includes('PLAN_STAGING_FLAG_OFF:race_engine_v2'));
  assert.ok(validatePlan({ ...plan, activeSeasonNumber: 3 }, { season: 4, clockMs: CLOCK_MS, untilMs: CLOCK_MS + 86400000 }).includes('PLAN_SEASON_MISMATCH'));
  assert.ok(ticks.length > 0);
});

// ─── URL-grænse + instrumentering ───

test('URL limit: bytes are counted in UTF-8, and a URL over 8 KB fails the run', async () => {
  assert.equal(urlBytes('æøå'), 6);
  const recorder = createRecorder();
  const als = new AsyncLocalStorage();
  const f = createInstrumentedFetch({ baseFetch: async () => new Response('[]'), als, getPhase: () => 'normal', recorder, faults: createFaultController() });
  const ids = 'æ'.repeat(4100); // 4.100 tegn, 8.200 bytes
  await f(`${ORIGIN}/rest/v1/races?id=in.(${ids})`);
  const s = recorder.phases.normal;
  assert.ok(s.maxUrlBytes > MAX_URL_BYTES);
  assert.equal(s.urlOverLimit, 1);
  const v = evaluateRun({ phases: { normal: s } });
  assert.ok(v.blockers.includes('URL_OVER_8KB:normal'));
  assert.equal(v.loadTestPassed, false);
});

test('instrumentation: lock timeouts and 5xx are counted, prod or local URLs are never fault targets', async () => {
  assert.equal(classifyRequest(`https://${PROD_REF}.supabase.co/rest/v1/races`).surface, 'other');
  assert.equal(classifyRequest('http://127.0.0.1:3000/api/rankings/global').surface, 'other');
  assert.deepEqual(classifyRequest(`${ORIGIN}/rest/v1/rpc/apply_race_results_batch`), { surface: 'rpc', name: 'apply_race_results_batch' });
  assert.equal(classifyRequest(`${ORIGIN}/auth/v1/user`).surface, 'auth');
  const recorder = createRecorder();
  const als = new AsyncLocalStorage();
  const faults = createFaultController();
  const f = createInstrumentedFetch({
    baseFetch: async () => new Response('{"code":"55P03"}', { status: 500 }), als, getPhase: () => 'normal', recorder, faults,
  });
  await f(`${ORIGIN}/rest/v1/races`);
  assert.equal(recorder.phases.normal.lockTimeouts, 1);
  assert.equal(recorder.phases.normal.upstream5xx, 1);
  faults.setMode('db_down');
  await assert.rejects(() => f(`${ORIGIN}/rest/v1/races`), TypeError);
  // Simulatorens egne målinger rammes aldrig af et injiceret udfald.
  await als.run({ kind: 'sim' }, () => f(`${ORIGIN}/rest/v1/races`));
  faults.setMode('auth_down');
  await f(`${ORIGIN}/rest/v1/races`);
  await assert.rejects(() => f(`${ORIGIN}/auth/v1/user`), TypeError);
  assert.equal(recorder.phases.normal.injectedFaults, 2);
});

test('restart fault: the crash trips only after the results write and its marker, for one race only', () => {
  const faults = createFaultController();
  faults.armCrash();
  const store = { kind: 'tick', race: 'r1' };
  const ok = (surface, name, method = 'GET') => {
    const rec = { surface, name, method, status: 200 };
    const d = faults.decide(rec, store);
    if (!d) faults.observe(rec, store);
    return d;
  };
  assert.equal(ok('rest', 'races'), null);
  assert.equal(ok('rpc', 'apply_race_results_batch', 'POST'), null);
  assert.equal(ok('rest', 'races', 'PATCH'), null);
  assert.equal(faults.crash().state, 'tripped');
  assert.equal(faults.crash().point, 'after_results_write_and_marker');
  assert.equal(ok('rest', 'board_satisfaction_events', 'POST'), 'unreachable');
  assert.equal(faults.decide({ surface: 'rest', name: 'races' }, { kind: 'tick', race: 'r2' }), null);

  // Etape-stien skriver via apply_stage_result; uden trin-markering afbrydes der kort efter.
  const noMarker = createFaultController();
  noMarker.armCrash();
  const s2 = { kind: 'tick', race: 'r3' };
  const step = (surface, name, method = 'GET') => {
    const rec = { surface, name, method, status: 200 };
    const d = noMarker.decide(rec, s2);
    if (!d) noMarker.observe(rec, s2);
    return d;
  };
  assert.equal(step('rpc', 'apply_stage_result', 'POST'), null);
  for (let i = 0; i < 5; i++) assert.equal(step('rest', 'season_standings'), null);
  assert.equal(step('rest', 'season_standings'), 'unreachable');
  assert.equal(noMarker.crash().point, 'after_results_write_no_marker');
});

// ─── Oracles ───

test('oracle: exactly one run and one settlement per race passes; anything else fails', () => {
  const good = {
    runsBySlot: { 'R01#1': 1, 'R02#1': 1 }, financeDup: [], boardDup: [],
    races: [{ alias: 'R01', status: 'completed', prizePaid: true, finalizeState: false }, { alias: 'R02', status: 'completed', prizePaid: true, finalizeState: false }],
    resultCounts: { 'R01#1': { first: 120, final: 120 } },
  };
  assert.equal(evaluateOracles(good).passed, true);
  assert.ok(evaluateOracles({ ...good, runsBySlot: { 'R01#1': 2, 'R02#1': 1 } }).blockers.includes('ORACLE_RUNS_NOT_EXACTLY_ONCE'));
  assert.ok(evaluateOracles({ ...good, runsBySlot: { 'R01#1': 0, 'R02#1': 1 } }).blockers.includes('ORACLE_RUNS_NOT_EXACTLY_ONCE'));
  assert.ok(evaluateOracles({ ...good, financeDup: [{ alias: 'R01', type: 'prize' }] }).blockers.includes('ORACLE_SETTLEMENT_DUPLICATE'));
  assert.ok(evaluateOracles({ ...good, races: [{ alias: 'R01', status: 'completed', prizePaid: false }] }).blockers.includes('ORACLE_SETTLEMENT_MISSING'));
  assert.ok(evaluateOracles({ ...good, boardDup: ['R02'] }).blockers.includes('ORACLE_BOARD_DUPLICATE'));
  assert.ok(evaluateOracles({ ...good, resultCounts: { 'R01#1': { first: 120, final: 240 } } }).blockers.includes('ORACLE_RESULTS_CHANGED_AFTER_FIRST_READ'));
  assert.deepEqual(evaluateOracles(null).blockers, ['ORACLE_MISSING']);
});

test('passed=false when a phase is missing, even if everything measured is clean', () => {
  const v = evaluateRun({ phases: {}, crash: { state: 'tripped' }, recovery: { recovered: true }, oracleData: { runsBySlot: { 'R01#1': 1 }, races: [] } });
  assert.equal(v.loadTestPassed, false);
  for (const p of PHASES) assert.ok(v.blockers.includes(`PHASE_MISSING:${p}`), p);
});

test('restart phase: 5xx outside the crashed run and a counter-only crash both fail the gate', () => {
  const recorder = createRecorder();
  const s = recorder.stats('restart_recovery');
  s.ticks = 3;
  s.http.byStatus = { 200: 10, 502: 1 };
  s.lockTimeouts = 1;
  const v = evaluateRun({ phases: { restart_recovery: s }, crash: { state: 'tripped', point: 'fallback_request_count' }, recovery: { recovered: true } });
  assert.ok(v.blockers.includes('RESTART_HTTP_5XX'));
  assert.ok(v.blockers.includes('RESTART_LOCK_TIMEOUT'));
  assert.ok(v.blockers.includes('RESTART_CRASH_NOT_MID_FINALIZATION'));
  assert.ok(!evaluateRun({ phases: {}, crash: { state: 'tripped', point: 'after_results_write_and_marker' }, recovery: { recovered: true } })
    .blockers.includes('RESTART_CRASH_NOT_MID_FINALIZATION'));
});

// ─── Ende-til-ende med fake staging ───

test('end-to-end: a clean race day with all phases and oracles passes and the report says so', async () => {
  const world = makeWorld();
  const { deps, calls } = makeDeps({ live: makeFakeLive(world) });
  const r = await runRaceDaySim(options(), deps);
  assert.deepEqual(r.verdict.blockers, []);
  assert.equal(r.status, 'PASSED');
  assert.equal(r.verdict.loadTestPassed, true);
  for (const p of PHASES) assert.ok(r.phases[p]?.ticks > 0, p);
  assert.equal(r.crash.state, 'tripped');
  assert.equal(r.recovery.recovered, true);
  assert.equal(world.restarts, 1);
  assert.ok(r.phases.fault_auth.injectedFaults > 0);
  assert.ok(r.phases.fault_db.injectedFaults > 0);
  assert.deepEqual(Object.keys(r.phases.fault_auth.http.byStatus), ['503']);
  assert.ok(r.phases.normal.stagesRun > 0);
  assert.ok(r.phases.normal.tickDbCalls.some(n => n > 1));
  assert.ok(r.rankingLags.every(l => l.lagMs <= RANKING_SLA_MS));
  assert.ok(Object.values(r.boardCallsByRace).every(n => n >= 1));
  const md = calls.reports.at(-1).md;
  assert.match(md, /loadTestPassed: true/);
  assert.match(calls.reports.at(-1).name, /^race-day-.*\.md$/);
  // Rapporten bærer aliaser, aldrig løbs-id'er (repoet er offentligt).
  assert.doesNotMatch(md, /race-uuid-/);
});

test('end-to-end: a cached 200 during the Auth outage fails the gate', async () => {
  const { deps } = makeDeps({ live: makeFakeLive(makeWorld(), { cacheAuthorizes: true }) });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.verdict.loadTestPassed, false);
  assert.ok(r.verdict.blockers.includes('FAULT_CACHE_AUTHORIZED:fault_auth'));
  assert.ok(r.verdict.blockers.includes('FAULT_NOT_503:fault_auth'));
});

test('end-to-end: a double settlement or a double run fails the oracle', async () => {
  const world = makeWorld();
  const { deps } = makeDeps({ live: makeFakeLive(world, { duplicatePrize: world.races[0].id, duplicateRun: world.races[1].id }) });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.verdict.loadTestPassed, false);
  assert.ok(r.verdict.blockers.includes('ORACLE_SETTLEMENT_DUPLICATE'));
  assert.ok(r.verdict.blockers.includes('ORACLE_RUNS_NOT_EXACTLY_ONCE'));
});

test('end-to-end: a lock timeout in normal operation fails the gate', async () => {
  const { deps } = makeDeps({ live: makeFakeLive(makeWorld(), { lockTimeoutInNormal: true }) });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.verdict.loadTestPassed, false);
  assert.ok(r.verdict.blockers.includes('NORMAL_LOCK_TIMEOUT'));
});

test('end-to-end: a crashed finalization that never resumes fails after the bounded recovery wait', async () => {
  const { deps } = makeDeps({ live: makeFakeLive(makeWorld(), { brokenResume: true }) });
  const r = await runRaceDaySim(options(), deps);
  assert.equal(r.verdict.loadTestPassed, false);
  assert.ok(r.verdict.blockers.includes('RESTART_NOT_RECOVERED'));
  assert.ok(r.verdict.blockers.includes('ORACLE_FINALIZE_STATE_LEFT'));
});
