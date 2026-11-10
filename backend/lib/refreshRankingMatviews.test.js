import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import {
  refreshRankingMatviewsSafe as rawSafe,
  refreshRankingMatviewsGated as rawGated,
  refreshRankingsAfterTrainingSettlement as rawTraining,
  requestRankingMatviewRefresh as rawRequest,
  isTrainingSettlementInProgress,
  __resetRankingRefreshStateForTests,
  MAX_DEFER_MS,
  COALESCE_WINDOW_MS,
} from "./refreshRankingMatviews.js";

const FIXED_NOW = new Date('2026-10-04T10:00:00Z');
function defaults(client, options = {}) {
  const clock = options.clock ?? (() => 0);
  if (client._setRankingClock) client._setRankingClock(clock);
  client._markRankingEvent?.();
  return { now: FIXED_NOW, nowFn: () => FIXED_NOW, heartbeatNowFn: () => FIXED_NOW,
    clock, testNowFn: options.nowFn ?? options.heartbeatNowFn ?? (() => FIXED_NOW), tokenFn: () => '00000000-0000-4000-8000-000000000001', ...options };
}
const refreshRankingMatviewsSafe = (client, options) => rawSafe(client, defaults(client, options));
const refreshRankingMatviewsGated = (client, options) => rawGated(client, defaults(client, options));
const refreshRankingsAfterTrainingSettlement = options => rawTraining({ ...defaults(options.supabase, options), ...options });
const requestRankingMatviewRefresh = (client, options) => rawRequest(client, {
  setTimer: () => ({ unref() {} }), ...defaults(client, options),
});
const coordinatorReply = (client, name, args) => client._controlRpc?.(name, args);
const ALL_RPCS = [
  "refresh_rider_rankings_mv",
  "refresh_team_standings_ext_mv",
  "refresh_team_race_points_mv",
  "refresh_global_rank_mv",
  "refresh_youth_rider_rankings_mv", // #5647: sidst, efter de fire seniorviews
];

test('#6765 independent shadow precedes failed/timed-out legacy and never acknowledges its version', async () => {
  for (const message of ['legacy failed', 'canceling statement due to statement timeout']) {
    const client = createMockSupabase({ independent: true, rpcErrors: { refresh_rider_rankings_mv: message } });
    const events = [], captured = [];
    const control = client._controlRpc;
    client._controlRpc = (name, args) => {
      events.push({ name, args });
      return control(name, args);
    };
    assert.equal(await refreshRankingMatviewsSafe(client, { captureExceptionFn: (e, c) => captured.push({ e, c }) }), false);
    assert.ok(events.findIndex(e => e.name === 'apply_ranking_deltas') < events.findIndex(e => e.name === 'refresh_rider_rankings_mv'));
    assert.equal(events.filter(e => e.name === 'apply_ranking_deltas').length, 1);
    assert.equal(events.find(e => e.name === 'finish_ranking_refresh_work').args.p_success, false);
    assert.equal(client.upsertCalls.length, 0);
    assert.ok(captured.some(e => e.c.tags.lib === 'refreshRankingMatviews'));
  }
});

test('#6765 cooldown and both deferred paths attempt shadow without borrowing a legacy lease', async () => {
  const evening = new Date('2026-10-04T18:30:00Z');
  for (const mode of ['cooldown', 'gated-deferred', 'training-deferred']) {
    const client = createMockSupabase({ independent: true, workRows: mode.endsWith('deferred') ? [{ tick_date: '2026-10-04', status: 'pending' }] : [] });
    const calls = [], control = client._controlRpc;
    client._controlRpc = (name, args) => {
      calls.push({ name, args });
      if (mode === 'cooldown' && name === 'claim_ranking_refresh_work') return { data: { status: 'cooldown' }, error: null };
      return control(name, args);
    };
    const options = { now: evening, clock: () => 0, logger: { log() {}, info() {} } };
    const result = mode === 'training-deferred'
      ? await refreshRankingsAfterTrainingSettlement({ supabase: client, ...options })
      : await refreshRankingMatviewsGated(client, options);
    assert.equal(result, mode === 'cooldown' ? 'cooldown' : 'deferred');
    const apply = calls.filter(c => c.name === 'apply_ranking_deltas');
    assert.equal(apply.length, 1, mode);
    assert.equal(apply[0].args.p_owner_token, null);
    assert.equal(apply[0].args.p_target_version, null);
    assert.equal(client.rpcCalls.length, 0);
    assert.equal(client.upsertCalls.length, 0);
  }
});

test('#6765 shadow has already drained while a legacy RPC is still unresolved', async () => {
  const client = createMockSupabase({ independent: true });
  const control = client._controlRpc;
  let shadowDrained = false, release;
  let entered;
  const legacyEntered = new Promise(resolve => { entered = resolve; });
  client._controlRpc = (name, args) => {
    if (name === 'apply_ranking_deltas') shadowDrained = true;
    if (name === 'refresh_rider_rankings_mv') {
      assert.equal(shadowDrained, true);
      entered();
      return new Promise(resolve => { release = resolve; });
    }
    return control(name, args);
  };
  const running = refreshRankingMatviewsSafe(client, { clock: () => 0, logger: { info() {} } });
  await legacyEntered;
  try { assert.equal(client.upsertCalls.length, 0); assert.equal(shadowDrained, true); }
  finally { release({ error: { message: 'statement timeout' } }); }
  assert.equal(await running, false);
});

test('#6765 leased shadow keeps version watermark drain, defers parity and does not repeat after legacy', async () => {
  const client = createMockSupabase({ independent: true });
  const control = client._controlRpc, calls = [], logs = [];
  let batch = 0, elapsed = 0;
  client._controlRpc = (name, args) => {
    calls.push({ name, args });
    if (name === 'apply_ranking_deltas') {
      elapsed += 5000;
      assert.equal(args.p_target_version, '3');
      assert.equal(args.p_owner_token, '00000000-0000-4000-8000-000000000001');
      return { data: ++batch < 3 ? { pending: true, next_id: String(batch * 200 + 1) } : { pending: false }, error: null };
    }
    return control(name, args);
  };
  assert.equal(await refreshRankingMatviewsSafe(client, { clock: () => elapsed, logger: { info: (_m, d) => logs.push(d) } }), true);
  assert.equal(batch, 3, 'version drain passes the soft budget without repeating after publication');
  assert.equal(logs[0].version_drained, true);
  assert.equal(logs[0].status, 'parity-deferred-legacy');
  assert.equal(calls.some(c => c.name === 'check_ranking_shadow_parity'), false);
  assert.equal(calls.find(c => c.name === 'finish_ranking_refresh_work').args.p_success, true);
});

test('#6765 shadow failure is captured independently of successful legacy publication; lost lease cannot acknowledge', async () => {
  for (const lostLease of [false, true]) {
    const client = createMockSupabase({ independent: true }), captured = [];
    const control = client._controlRpc;
    client._controlRpc = (name, args) => {
      if (name === 'apply_ranking_deltas') return { data: null, error: { message: 'shadow batch failed' } };
      if (lostLease && name === 'renew_ranking_refresh_work') return { data: false, error: null };
      return control(name, args);
    };
    assert.equal(await refreshRankingMatviewsSafe(client, { captureExceptionFn: (e, c) => captured.push({ e, c }), logger: { info() {} } }), !lostLease);
    assert.ok(captured.some(c => c.c.tags.lib === 'rankingShadowPass'));
    assert.equal(client.upsertCalls.length, lostLease ? 0 : 1);
  }
});

test('#6765 shared follow-up callers do not each run an extra heavy fallback', async () => {
  const client = createMockSupabase({ independent: true }), control = client._controlRpc;
  let batches = 0, first = true, release, entered;
  const legacyEntered = new Promise(resolve => { entered = resolve; });
  client._controlRpc = (name, args) => {
    if (name === 'apply_ranking_deltas') batches++;
    if (name === 'refresh_rider_rankings_mv' && first) {
      first = false; entered();
      return new Promise(resolve => { release = resolve; });
    }
    return control(name, args);
  };
  const options = { clock: () => 0, logger: { info() {} } };
  const active = refreshRankingMatviewsSafe(client, options);
  await legacyEntered;
  const second = refreshRankingMatviewsSafe(client, options);
  const third = refreshRankingMatviewsSafe(client, options);
  // Let the fresh flag reads admit both callers to the existing local queue.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  release({ error: null });
  assert.deepEqual(await Promise.all([active, second, third]), [true, true, true]);
  assert.equal(batches, 2, 'one active pass and one shared follow-up');
});

test('#6765 missing migration/config errors preserve the OFF RPC trace and legacy result', async () => {
  for (const failure of ['missing', 'error', 'throw']) {
    const client = createMockSupabase(), control = client._controlRpc, from = client.from.bind(client);
    const calls = [], captures = [];
    client._controlRpc = (name, args) => { calls.push({ name, args }); return control(name, args); };
    client.from = table => table !== 'app_config' ? from(table) : { select: () => ({ eq: (_col, key) => ({ maybeSingle: async () => {
      if (key !== 'ranking_shadow_decoupled_6765') return { data: { value: 'on' }, error: null };
      if (failure === 'throw') throw new Error('configuration failed');
      return { data: null, error: failure === 'error' ? { message: 'configuration failed' } : null };
    } }) }) };
    assert.equal(await refreshRankingMatviewsSafe(client, { captureExceptionFn: (e, c) => captures.push({ e, c }), logger: { info() {} } }), true);
    assert.deepEqual(calls.filter(c => c.name.startsWith('refresh_')).map(c => c.name), ALL_RPCS);
    assert.ok(calls.findIndex(c => c.name === 'get_ranking_shadow_metrics') > calls.findIndex(c => c.name === ALL_RPCS.at(-1)));
    assert.equal(captures.filter(c => c.c.tags.lib === 'rankingShadowDecoupled6765Flag').length, failure === 'missing' ? 0 : 1);
  }
});

test("#5692: every refresh explicitly selects the reader-safe RPC overload", async () => {
  const supabase = createMockSupabase();
  const requests = [];
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    requests.push({ name, args });
    return { error: null };
  };
  const now = new Date("2026-10-04T10:00:00Z");
  assert.equal(await refreshRankingMatviewsSafe(supabase, { nowFn: () => now }), true);
  assert.deepEqual(requests, ALL_RPCS.map(name => ({ name, args: { p_concurrently: true, p_owner_token: '00000000-0000-4000-8000-000000000001', p_target_version: '3' } })));
});

test("#5692: an unavailable concurrent overload never falls back to a blocking refresh or heartbeat", async () => {
  const supabase = createMockSupabase();
  const requests = [];
  const captured = [];
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    requests.push({ name, args });
    return { error: { code: "PGRST202", message: "Concurrent overload unavailable" } };
  };
  const now = new Date("2026-10-04T10:00:00Z");
  assert.equal(await refreshRankingMatviewsSafe(supabase, {
    nowFn: () => now, captureExceptionFn: (err, context) => captured.push({ err, context }),
  }), false);
  assert.deepEqual(requests, ALL_RPCS.map(name => ({ name, args: { p_concurrently: true, p_owner_token: '00000000-0000-4000-8000-000000000001', p_target_version: '3' } })));
  assert.equal(supabase.upsertCalls.length, 0);
  assert.equal(captured.length, 1);
});

function createMockSupabase({ rpcErrors = {}, heartbeatError = null, workRows = [], workError = null, independent = false } = {}) {
  const rpcCalls = [];
  const upsertCalls = [];
  const workQueries = [];
  let requested = 1, completed = 0, target = null, clock = () => 0, dirtyAt = 0, clockInitialized = false, lastCompleted = null, onComplete = () => {};
  const control = (name, args) => {
    if (name === 'get_ranking_shadow_metrics') return { data: { queue_length: 0, ...(independent ? { max_id: '450' } : {}) }, error: null };
    if (name === 'apply_ranking_deltas') return independent ? { data: { pending: false }, error: null } : { data: null, error: { code: 'PGRST202', message: 'M1 schema not installed in legacy fixture' } };
    if (independent && name === 'check_ranking_shadow_parity') return { data: { status: 'equal' }, error: null };
    if (name === 'get_ranking_refresh_work_state') return { data: { pending: requested > completed,
      pending_age_ms: Math.max(0, clock() - dirtyAt), last_completed_at: lastCompleted }, error: null };
    if (name === 'claim_ranking_refresh_work') {
      if (args.p_force) requested++;
      if (requested === completed) return { data: { status: 'clean' }, error: null };
      target = requested;
      return { data: { status: 'claimed', target_version: String(target), token: args.p_token }, error: null };
    }
    if (name === 'renew_ranking_refresh_work') return { data: true, error: null };
    if (name === 'finish_ranking_refresh_work') {
      if (args.p_success) {
        upsertCalls.push({ row: { matview_group: 'ranking', refreshed_at: args.p_now }, opts: { onConflict: 'matview_group' } });
        if (heartbeatError) return { data: null, error: { message: heartbeatError } };
        completed = Number(args.p_target_version); lastCompleted = args.p_now; onComplete();
      }
      return { data: true, error: null };
    }
    return null;
  };
  return {
    _controlRpc: control,
    _setRankingClock(value) { clock = value; if (!clockInitialized) { dirtyAt = clock(); clockInitialized = true; } },
    _setCompleteListener(fn) { onComplete = fn; },
    _markRankingEvent() { if (requested === completed) dirtyAt = clock(); requested++; },
    rpcCalls,
    upsertCalls,
    workQueries,
    async rpc(name, args) {
      const control = this._controlRpc(name, args); if (control) return control;
      rpcCalls.push(name);
      if (rpcErrors[name]) return { error: { message: rpcErrors[name] } };
      return { error: null };
    },
    from(table) {
      if (table === 'app_config') return { select: () => ({ eq: (_column, key) => ({ maybeSingle: async () => ({ data: { value: key === 'ranking_shadow_decoupled_6765' ? independent : 'on' }, error: null }) }) }) };
      if (table === "training_date_work") {
        // #5911: statusopslaget select().eq(tick_date).in(status).limit(1).
        const q = { filters: [] };
        workQueries.push(q);
        const b = {
          select() { return b; },
          eq(col, val) { q.filters.push(["eq", col, val]); return b; },
          in(col, vals) { q.filters.push(["in", col, vals]); return b; },
          async limit() {
            if (workError) return { data: null, error: { message: workError } };
            const ticks = q.filters.find((f) => f[0] === "in" && f[1] === "tick_date")?.[2] ?? [];
            const statuses = q.filters.find((f) => f[0] === "in" && f[1] === "status")?.[2] ?? [];
            return { data: workRows.filter((r) => ticks.includes(r.tick_date) && statuses.includes(r.status)).slice(0, 1), error: null };
          },
        };
        return b;
      }
      assert.equal(table, "matview_refresh_heartbeat");
      return {
        async upsert(row, opts) {
          upsertCalls.push({ row, opts });
          if (heartbeatError) return { error: { message: heartbeatError } };
          return { error: null };
        },
      };
    },
  };
}

test("#5900: cron, finalization and training share one active refresh and one fresh follow-up", async () => {
  const supabase = createMockSupabase();
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let active = 0;
  let peak = 0;
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    const call = ++calls;
    peak = Math.max(peak, ++active);
    if (call === 1) await firstGate;
    active--;
    return { error: null };
  };
  const fixedNow = new Date("2026-10-03T10:00:00Z");
  const first = refreshRankingMatviewsSafe(supabase, { nowFn: () => fixedNow });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const cron = refreshRankingMatviewsGated(supabase, { now: fixedNow, heartbeatNowFn: () => fixedNow, clock: () => 0 });
  const training = refreshRankingsAfterTrainingSettlement({ supabase, now: fixedNow, heartbeatNowFn: () => fixedNow, clock: () => 0 });
  const finalization = requestRankingMatviewRefresh(supabase, { nowFn: () => fixedNow, clock: () => COALESCE_WINDOW_MS + 1 });
  const recovery = refreshRankingMatviewsSafe(supabase, { nowFn: () => fixedNow });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  // Release even on failure, so a failed assertion cannot hang the suite.
  releaseFirst();
  const outcomes = await Promise.all([first, cron, training, finalization, recovery]);
  assert.deepEqual(outcomes, [true, true, true, 'coalesced', true]);
  assert.equal(peak, 1, "the five refresh sources must never overlap RPCs");
  assert.equal(calls, ALL_RPCS.length * 2, "requests after the first snapshot share one new pass");
  assert.equal(supabase.upsertCalls.length, 2);
});

test("#5900: a queued gated pass rechecks training when it finally starts", async () => {
  const workRows = [];
  const supabase = createMockSupabase({ workRows });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    if (++calls === 1) await gate;
    return { error: null };
  };
  const now = new Date("2026-10-03T17:59:00Z");
  let elapsed = 0;
  const first = refreshRankingMatviewsSafe(supabase, { nowFn: () => now });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const pending = refreshRankingMatviewsGated(supabase, { now, clock: () => elapsed,
    heartbeatNowFn: () => now, logger: quietLogger });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  workRows.push({ tick_date: "2026-10-03", status: "pending" });
  elapsed = 60 * 1000;
  release();
  assert.equal(await first, true);
  assert.equal(await pending, "deferred", "training began while the pass waited for admission");
  assert.equal(calls, ALL_RPCS.length, "no second pass competes with training");
});

test("#5900: queued training-close retains its settlement date across midnight", async () => {
  const workRows = [];
  const supabase = createMockSupabase({ workRows });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    if (++calls === 1) await gate;
    return { error: null };
  };
  const now = new Date("2026-10-03T21:59:00Z");
  let elapsed = 0;
  const first = refreshRankingMatviewsSafe(supabase, { nowFn: () => now });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const pending = refreshRankingsAfterTrainingSettlement({ supabase, now, clock: () => elapsed,
    heartbeatNowFn: () => now, logger: quietLogger });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  workRows.push({ tick_date: "2026-10-03", status: "partial" });
  elapsed = 60 * 1000;
  release();
  assert.equal(await first, true);
  assert.equal(await pending, "deferred", "midnight cannot release an unfinished requested settlement date");
  assert.equal(calls, ALL_RPCS.length);
});

test("#5900: merging a new-day training close cannot discard the pending previous date", async () => {
  const workRows = [];
  const supabase = createMockSupabase({ workRows });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    if (++calls === 1) await gate;
    return { error: null };
  };
  const beforeMidnight = new Date("2026-10-03T21:59:00Z");
  let elapsed = 0;
  const first = refreshRankingMatviewsSafe(supabase, { nowFn: () => beforeMidnight });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const options = { clock: () => elapsed, heartbeatNowFn: () => beforeMidnight, logger: quietLogger };
  const previousDate = refreshRankingsAfterTrainingSettlement({ supabase, now: beforeMidnight, ...options });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  workRows.push({ tick_date: "2026-10-03", status: "partial" });
  elapsed = 60 * 1000;
  const newDate = refreshRankingsAfterTrainingSettlement({ supabase, now: new Date("2026-10-03T22:01:00Z"), ...options });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  release();
  assert.equal(await first, true);
  assert.equal(await previousDate, "deferred");
  assert.equal(await newDate, "deferred");
  assert.equal(calls, ALL_RPCS.length);
});

for (const safeOverride of [false, true]) {
test(`#5900: queue waiting does not restart an expired maximum training deferral (Safe override=${safeOverride})`, async () => {
  __resetRankingRefreshStateForTests();
  const now = new Date("2026-10-03T18:30:00Z");
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-03", status: "pending" }] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    if (++calls === 1) await gate;
    return { error: null };
  };
  const first = refreshRankingMatviewsSafe(supabase, { nowFn: () => now });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  let clock = 0;
  const opts = { now, clock: () => clock, heartbeatNowFn: () => now, logger: quietLogger };
  assert.equal(await refreshRankingMatviewsGated(supabase, opts), "deferred");
  clock = MAX_DEFER_MS;
  const expired = refreshRankingMatviewsGated(supabase, opts);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const safe = safeOverride ? refreshRankingMatviewsSafe(supabase, { nowFn: () => now }) : null;
  release();
  assert.equal(await first, true);
  assert.equal(await expired, true, "the already expired interval survives queue waiting");
  if (safe) assert.equal(await safe, true);
  assert.equal(calls, ALL_RPCS.length * 2);
  assert.equal(await refreshRankingMatviewsGated(supabase, opts), "deferred", "the clock resets after a real pass");
});
}

test("#5900: finalization timer cannot overlap a refresh slower than its window", async () => {
  const supabase = createMockSupabase();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let completed;
  const followUpDone = new Promise((resolve) => { completed = resolve; });
  let active = 0;
  let peak = 0;
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    peak = Math.max(peak, ++active);
    if (++calls === 1) await gate;
    active--;
    return { error: null };
  };
  supabase._setCompleteListener(() => { if (supabase.upsertCalls.length === 2) completed(); });
  const { timers, setTimer } = fakeTimers();
  let clock = 0;
  const nowFn = () => new Date("2026-10-03T10:00:00Z");
  const options = { clock: () => clock, nowFn, setTimer, logger: quietLogger };
  const first = requestRankingMatviewRefresh(supabase, options);
  assert.equal(await first, 'coalesced');
  timers[0].fn();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  clock = 1_000;
  assert.equal(await requestRankingMatviewRefresh(supabase, options), "coalesced");
  clock = COALESCE_WINDOW_MS;
  timers[1].fn();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  release();
  await followUpDone;
  assert.equal(peak, 1);
  assert.equal(calls, ALL_RPCS.length * 2);
});

test("#5900: a failed pass does not consume the successful pending pass's heartbeat", async () => {
  const supabase = createMockSupabase();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  supabase.rpc = async (name, args) => {
    const response = coordinatorReply(supabase, name, args); if (response) return response;
    const control = coordinatorReply(supabase, name, args); if (control) return control;
    supabase.rpcCalls.push(name);
    if (++calls === 1) { await gate; return { error: { message: "upstream" } }; }
    return { error: null };
  };
  const nowFn = () => new Date("2026-10-03T10:00:00Z");
  const first = refreshRankingMatviewsSafe(supabase, { nowFn });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const pending = refreshRankingMatviewsSafe(supabase, { nowFn });
  release();
  assert.equal(await first, false);
  assert.equal(await pending, true);
  assert.equal(supabase.upsertCalls.length, 1);
  assert.equal(supabase.upsertCalls[0].row.refreshed_at, nowFn().toISOString());
});

test("refreshRankingMatviewsSafe — alle lykkes: kalder alle RPC'er + upserter heartbeat", async () => {
  const supabase = createMockSupabase();
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });

  assert.equal(result, true);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  assert.equal(supabase.upsertCalls.length, 1);
  assert.equal(supabase.upsertCalls[0].row.matview_group, "ranking");
  assert.equal(supabase.upsertCalls[0].opts.onConflict, "matview_group");
  assert.equal(captured.length, 0);
});

test("refreshRankingMatviewsSafe — én RPC fejler: de andre kaldes stadig, heartbeat springes over, Sentry rapporteres", async () => {
  const supabase = createMockSupabase({ rpcErrors: { refresh_team_race_points_mv: "boom" } });
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });

  assert.equal(result, false);
  // Best-effort pr. matview: alle RPC'er kaldes, uanset om en tidligere fejlede.
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  assert.equal(supabase.upsertCalls.length, 0, "heartbeat må IKKE opdateres hvis ikke alle lykkedes");
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /1\/5 matview-refresh fejlede/);
  assert.equal(captured[0].ctx.extra.failures.length, 1);
  assert.equal(captured[0].ctx.extra.failures[0].label, "team_race_points_mv");
});

test("refreshRankingMatviewsSafe — alle RPC'er lykkes men completion/heartbeat fejler: returnerer false", async () => {
  const supabase = createMockSupabase({ heartbeatError: "connection reset" });
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });

  assert.equal(result, false, "completion uden fenced heartbeat maa ikke rapporteres som faerdig");
  assert.equal(supabase.upsertCalls.length, 1);
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /completion not acknowledged/);
});

test("refreshRankingMatviewsSafe — uden captureExceptionFn kaster den ikke (best-effort virker uden DI)", async () => {
  const supabase = createMockSupabase({ rpcErrors: { refresh_global_rank_mv: "boom" } });
  const result = await refreshRankingMatviewsSafe(supabase);
  assert.equal(result, false);
});

test("#5647 refreshRankingMatviewsSafe — ungdoms-rytterranglisten refreshes SIDST, efter de fire seniorviews", async () => {
  const supabase = createMockSupabase();
  await refreshRankingMatviewsSafe(supabase);
  assert.equal(supabase.rpcCalls.at(-1), "refresh_youth_rider_rankings_mv");
  assert.deepEqual(supabase.rpcCalls.slice(0, 4), ALL_RPCS.slice(0, 4));
});

test("#5647 refreshRankingMatviewsSafe — mangler ungdoms-RPC'en (migration ikke applied): seniorviews refreshes stadig, heartbeat springes over", async () => {
  const supabase = createMockSupabase({
    rpcErrors: { refresh_youth_rider_rankings_mv: "Could not find the function public.refresh_youth_rider_rankings_mv" },
  });
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });
  assert.equal(result, false);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  assert.equal(supabase.upsertCalls.length, 0);
  assert.equal(captured[0].ctx.extra.failures[0].label, "youth_rider_rankings_mv");
});

test("#5647 forward-guard — migrationen bag ungdoms-refresh-RPC'en findes og holder matviewet lukket for anon/authenticated", () => {
  const file = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "database", "2026-09-25-4620-youth-rider-rankings-mv.sql");
  assert.ok(fs.existsSync(file), "youth_rider_rankings_mv-migrationen mangler");
  const sql = fs.readFileSync(file, "utf8").replace(/--[^\n]*/g, " ");
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.refresh_youth_rider_rankings_mv\(\)/i);
  assert.match(sql, /ra\.squad\s*<>\s*'senior'/i, "matviewet må kun tælle ungdomsløb");
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.youth_rider_rankings_mv\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// FORWARD-GUARD (#4866): timeout-budgettet for denne kodesti
//
// Rod-årsagen 5/9 var ikke JS-logik, men en manglende rolle-indstilling i
// databasen: service_role havde ingen rolconfig og arvede authenticator-
// sessionens statement_timeout=8s, så refresh_team_race_points_mv 500'ede.
// Der findes derfor ikke noget "forkert kald" at teste imod i JS — kaldet
// (supabase.rpc) er identisk før og efter fixet. Det der KAN gå tabt igen er
// koblingen: migrationen slettes/omskrives, eller kodestien flyttes til en
// anden transport, og så er 60s-loftet væk uden at nogen opdager det.
//
// Valgt guard = statisk kontrakt-test (ikke en runtime-mock): den læser
// migrationsfilen + kildefilen og kræver at BEGGE stadig beskriver aftalen. En
// runtime-test kunne kun mocke supabase.rpc og ville hverken se rolconfig i
// prod eller opdage at migrationen forsvandt — den ville være grøn i præcis
// den situation vi vil fanges i. SQL-kommentarer strippes før matchning, så
// header-prosa ikke kan snyde testen grøn.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TIMEOUT_MIGRATION = path.join(
  REPO_ROOT,
  "database",
  "2026-09-05-4866-service-role-statement-timeout.sql",
);

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

test("#4866 forward-guard — migrationen der giver service_role sit eget statement_timeout findes og er intakt", () => {
  assert.ok(
    fs.existsSync(TIMEOUT_MIGRATION),
    `Migrationen ${path.basename(TIMEOUT_MIGRATION)} mangler. Uden den arver service_role ` +
      `authenticator-sessionens statement_timeout=8s, og matview-refreshene 500'er igen (#4866).`,
  );

  const statements = stripSqlComments(fs.readFileSync(TIMEOUT_MIGRATION, "utf8"));
  const match = statements.match(
    /ALTER\s+ROLE\s+service_role\s+SET\s+statement_timeout\s*(?:=|TO)\s*'?(\d+)\s*(s|min|ms)?'?/i,
  );
  assert.ok(
    match,
    "Migrationen skal indeholde en faktisk ALTER ROLE service_role SET statement_timeout-sætning " +
      "(ikke kun i en kommentar).",
  );

  const [, rawValue, unit = "ms"] = match;
  const seconds = unit === "min" ? Number(rawValue) * 60 : unit === "s" ? Number(rawValue) : Number(rawValue) / 1000;
  assert.ok(
    seconds >= 30,
    `service_role's statement_timeout er sat til ${rawValue}${unit} (${seconds}s). Målt maksimum for ` +
      `refresh_*_mv lå på 5,3s med cancels over 8s — under 30s er marginen for tynd (#4866).`,
  );

  // Spiller-vendte roller må IKKE flyttes af denne migration: anon (3s) og
  // authenticated (8s) er bevidste værn mod at en enkelt klient-query æder DB'en.
  assert.doesNotMatch(
    statements,
    /ALTER\s+ROLE\s+(anon|authenticated)\b/i,
    "Denne migration må kun røre service_role — anon/authenticated er spiller-vendte lofter (#4866).",
  );
});

test("#4866 forward-guard — kildefilen dokumenterer at den afhænger af service_role-timeouten", () => {
  const source = fs.readFileSync(new URL("./refreshRankingMatviews.js", import.meta.url), "utf8");

  assert.match(
    source,
    /2026-09-05-4866-service-role-statement-timeout\.sql/,
    "refreshRankingMatviews.js skal pege på migrationen den afhænger af, så koblingen ikke går tabt " +
      "ved næste refactor (#4866).",
  );
  assert.match(
    source,
    /service_role/,
    "Kommentaren skal forklare at kaldene kører som service_role — det er dét der bestemmer loftet (#4866).",
  );
  // Den gamle påstand ("loftet er 8s") må ikke stå tilbage som sandhed for denne
  // kodesti: den var netop den fejlantagelse der gjorde 5/9-timeouten usynlig.
  assert.match(
    source,
    /IKKE\s+8s\s+længere/i,
    "Kommentaren skal eksplicit sige at 8s-loftet ikke længere gælder denne kodesti (#4866).",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5911: aftenafregningen har forrang for rangliste-refreshen.
const EVENING = new Date("2026-10-01T18:30:00Z"); // 20:30 Copenhagen (CEST), 1/10
const MIDDAY = new Date("2026-10-01T10:00:00Z"); // 12:00 Copenhagen
const quietLogger = { log() {}, warn() {} };

test("#5911 gate — dagens afregning har pending-hold kl. 20.30: refresh holdes tilbage", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-01", status: "pending" }] });
  const result = await refreshRankingMatviewsGated(supabase, { now: EVENING, clock: () => 0, logger: quietLogger });
  assert.equal(result, "deferred");
  assert.deepEqual(supabase.rpcCalls, []);
  assert.deepEqual(supabase.workQueries[0].filters, [
    ["in", "tick_date", ["2026-10-01"]],
    ["in", "status", ["pending", "partial"]],
  ]);
});

test("#5911 gate — efter midnat gater gårsdagens uafsluttede afregning indtil kl. 03", async () => {
  __resetRankingRefreshStateForTests();
  const rows = [{ tick_date: "2026-10-01", status: "partial" }];
  const night = new Date("2026-10-01T23:30:00Z"); // 01:30 Copenhagen 2/10
  const supabase = createMockSupabase({ workRows: rows });
  assert.equal(await refreshRankingMatviewsGated(supabase, { now: night, clock: () => 0, logger: quietLogger }), "deferred");
  assert.deepEqual(supabase.workQueries[0].filters[0], ["in", "tick_date", ["2026-10-01"]]);
  // Kl. 03 er vinduet lukket: ingen opslag, refresh som normalt.
  const morning = new Date("2026-10-02T01:00:00Z"); // 03:00 Copenhagen
  const later = createMockSupabase({ workRows: rows });
  assert.equal(await refreshRankingMatviewsGated(later, { now: morning, logger: quietLogger }), true);
  assert.equal(later.workQueries.length, 0);
});

test("#5911 gate — partial tæller også som igangværende afregning", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-01", status: "partial" }] });
  assert.equal(await isTrainingSettlementInProgress(supabase, { now: EVENING }), true);
});

test("#5911 gate — alle hold complete/needs_reconciliation: refresh kører", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({
    workRows: [
      { tick_date: "2026-10-01", status: "complete" },
      { tick_date: "2026-10-01", status: "needs_reconciliation" },
      { tick_date: "2026-09-30", status: "pending" }, // gårsdagens rest gater ikke
    ],
  });
  const result = await refreshRankingMatviewsGated(supabase, { now: EVENING, logger: quietLogger });
  assert.equal(result, true);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
});

test("#5911 gate — før kl. 20 slås status ikke op og refreshen kører som før", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-01", status: "pending" }] });
  const result = await refreshRankingMatviewsGated(supabase, { now: MIDDAY, logger: quietLogger });
  assert.equal(result, true);
  assert.equal(supabase.workQueries.length, 0);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
});

test("#5911 gate — fail-safe: fejler statusopslaget, refreshes som før", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workError: "connection reset" });
  const warnings = [];
  const result = await refreshRankingMatviewsGated(supabase, { now: EVENING, logger: { log() {}, warn: (m) => warnings.push(m) } });
  assert.equal(result, true);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  assert.match(warnings[0], /refreshing anyway/);
});

test("#5911 gate — loft: efter MAX_DEFER_MS i træk refreshes alligevel, så en hængende afregning ikke fryser ranglisten", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-01", status: "pending" }] });
  let t = 1_000;
  const opts = { now: EVENING, clock: () => t, logger: quietLogger };
  assert.equal(await refreshRankingMatviewsGated(supabase, opts), "deferred");
  t += MAX_DEFER_MS - 1;
  assert.equal(await refreshRankingMatviewsGated(supabase, opts), "deferred");
  assert.deepEqual(supabase.rpcCalls, []);
  t += 1;
  assert.equal(await refreshRankingMatviewsGated(supabase, opts), true);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  // Loftet nulstilles efter en refresh: næste tick holdes tilbage igen.
  assert.equal(await refreshRankingMatviewsGated(supabase, opts), "deferred");
});

test("#5911 træningslukning — sidste hold færdigt: én ubetinget refresh", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-01", status: "complete" }] });
  const result = await refreshRankingsAfterTrainingSettlement({ supabase, now: EVENING, logger: quietLogger });
  assert.equal(result, true);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
});

test("#5911 træningslukning — hold stadig i gang: ingen refresh endnu", async () => {
  __resetRankingRefreshStateForTests();
  const supabase = createMockSupabase({ workRows: [{ tick_date: "2026-10-01", status: "partial" }] });
  const result = await refreshRankingsAfterTrainingSettlement({ supabase, now: EVENING, logger: quietLogger });
  assert.equal(result, "deferred");
  assert.deepEqual(supabase.rpcCalls, []);
});

test("#5911 træningslukning — kaster aldrig, heller ikke med en defekt klient", async () => {
  const result = await refreshRankingsAfterTrainingSettlement({ supabase: {}, now: EVENING, logger: quietLogger });
  assert.equal(result, false);
});

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, ms) { const t = { fn, ms, unref() { t.unrefed = true; } }; timers.push(t); return t; },
  };
}

test('#5692: publication schedules one background pass for five close finishes', async () => {
  const supabase = {}, calls = [];
  const { timers, setTimer } = fakeTimers();
  let clock = 0;
  const options = { clock: () => clock, setTimer, refresh: async () => { calls.push('refresh'); return true; }, logger: quietLogger };
  for (let i = 0; i < 5; i++) {
    assert.equal(await requestRankingMatviewRefresh(supabase, options), 'coalesced');
    clock += 5_000;
  }
  assert.equal(calls.length, 0, 'result publication never waits for global computation');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, COALESCE_WINDOW_MS);
  assert.equal(timers[0].unrefed, true);
  timers[0].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
});

test('#5692: a later finish schedules another bounded background pass', async () => {
  const client = {}, calls = [];
  const { timers, setTimer } = fakeTimers();
  const options = { clock: () => 0, setTimer, refresh: async () => { calls.push('refresh'); return true; }, logger: quietLogger };
  await requestRankingMatviewRefresh(client, options);
  timers[0].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await requestRankingMatviewRefresh(client, options), 'coalesced');
  assert.equal(calls.length, 1);
  assert.equal(timers.length, 2);
  timers[1].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
});

test('#5692: wakeup state is per client and a background exception is contained', async () => {
  const { timers, setTimer } = fakeTimers();
  const options = { clock: () => 0, setTimer, refresh: async () => { throw new Error('fixture'); }, logger: quietLogger };
  assert.equal(await requestRankingMatviewRefresh({}, options), 'coalesced');
  assert.equal(await requestRankingMatviewRefresh({}, options), 'coalesced');
  assert.equal(timers.length, 2);
  timers.forEach(timer => timer.fn()); await new Promise(resolve => setImmediate(resolve));
});

test('#5692: background finalization wakeup still respects training while within its bounded deferral', async () => {
  __resetRankingRefreshStateForTests();
  const db = createMockSupabase({ workRows: [{ tick_date: '2026-10-01', status: 'pending' }] });
  const { timers, setTimer } = fakeTimers();
  assert.equal(await requestRankingMatviewRefresh(db, { clock: () => 0, nowFn: () => EVENING, setTimer, logger: quietLogger }), 'coalesced');
  timers[0].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(db.rpcCalls, []);
});

test('#6765: unchanged ticks drain shadow work without a legacy refresh', async () => {
  const calls = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: 'on' }, error: null }) }) }) }),
    async rpc(name) { calls.push(name); return { data: name==='get_ranking_shadow_metrics'?{queue_length:0}:name==='check_ranking_shadow_parity'?{status:'equal'}:{ pending: false, pending_age_ms: 0, last_completed_at: FIXED_NOW.toISOString() }, error: null }; },
  };
  assert.equal(await rawGated(db, { now: FIXED_NOW, clock: () => 0, heartbeatNowFn: () => FIXED_NOW, logger: quietLogger }), true);
  assert.deepEqual(calls, ['get_ranking_refresh_work_state','get_ranking_shadow_metrics','apply_ranking_deltas','check_ranking_shadow_parity']);
});
test('#6765: Safe forwards its injected nowFn into daily shadow cadence', async () => {
  const db=createMockSupabase();
  const legacyControl=db._controlRpc;
  let parityCalls=0;
  db._controlRpc=(name,args)=>{
    if(name==='apply_ranking_deltas') return {data:{pending:false},error:null};
    if(name==='check_ranking_shadow_parity') {parityCalls++;return {data:{status:'equal'},error:null};}
    return legacyControl(name,args);
  };
  let now=new Date('2026-10-04T10:00:00Z');
  const options={nowFn:()=>now,testNowFn:()=>now,clock:()=>0};
  assert.equal(await rawSafe(db,options),true);
  now=new Date('2026-10-05T10:00:00Z');
  assert.equal(await rawSafe(db,options),true);
  assert.equal(parityCalls,2,'a full injected day elapses independently of host time');
});
test('#6765: time spent in legacy refresh is included in parity peak admission',async()=>{
  const db=createMockSupabase();const control=db._controlRpc;
  let elapsed=0,parityCalls=0;
  db._controlRpc=(name,args)=>{
    if(name==='apply_ranking_deltas') return {data:{pending:false},error:null};
    if(name==='check_ranking_shadow_parity'){parityCalls++;return {data:{status:'equal'},error:null};}
    return control(name,args);
  };
  const rpc=db.rpc.bind(db);
  db.rpc=async(name,args)=>{if(name.startsWith('refresh_')) elapsed+=1000;return rpc(name,args);};
  const now=new Date('2026-10-19T16:59:59Z');
  assert.equal(await rawSafe(db,{now,clock:()=>elapsed,testNowFn:()=>now}),true);
  assert.equal(parityCalls,0);
});

// ─────────────────────────────────────────────────────────────────────────────
// #7664: team_race_points_mv refreshes med hash join (funktions-scoped SET).
//
// Planner-indstillingen sidder paa refresh_team_race_points_mv(boolean). En senere
// CREATE OR REPLACE af den overload uden SET-klausulen nulstiller den stille, og
// refreshen falder tilbage til den dyre merge join uden at noget fejler. Testene
// herunder fanger begge veje: migrationen forsvinder, eller en nyere migration
// regenererer funktionen uden at genanvende indstillingen.
const PLAN_MIGRATION_7664 = "2026-11-04-7664-team-race-points-mv.sql";
const DATABASE_DIR = path.join(REPO_ROOT, "database");
const readPlanMigration7664 = () => fs.readFileSync(path.join(DATABASE_DIR, PLAN_MIGRATION_7664), "utf8");

test("#7664 forward-guard — migrationen saetter hash-join-planen paa den overload der udfoerer REFRESH", () => {
  const sql = stripSqlComments(readPlanMigration7664());
  assert.match(sql, /ALTER\s+FUNCTION\s+public\.refresh_team_race_points_mv\(boolean\)\s+SET\s+enable_mergejoin\s*(?:=|TO)\s*off/i);
  assert.match(sql, /ALTER\s+FUNCTION\s+public\.refresh_team_race_points_mv\(boolean\)\s+SET\s+work_mem\s*(?:=|TO)\s*'\d+MB'/i);
  // Matview-definitionen skal vaere uroert: ingen DROP/CREATE af matviewet.
  assert.doesNotMatch(sql, /(DROP|CREATE)\s+MATERIALIZED\s+VIEW/i);
  assert.doesNotMatch(sql, /REFRESH\s+MATERIALIZED\s+VIEW/i, "migrationen maa ikke selv refreshe i prod");
});

test("#7664 PGlite — migrationen er idempotent, saetter indstillingerne og refreshen giver samme rangliste", async () => {
  const db = new PGlite();
  try {
    // Minimal kopi af prod-formen: tabellerne, matviewet og boolean-overloaden
    // som 2026-10-06-5692-ranking-refresh-events.sql genererer den.
    await db.exec(`
      CREATE TABLE races (id int PRIMARY KEY, season_id int, name text, squad text);
      CREATE TABLE riders (id int PRIMARY KEY, team_id int);
      CREATE TABLE race_results (id serial PRIMARY KEY, race_id int, rider_id int, prize_money bigint);
      CREATE MATERIALIZED VIEW public.team_race_points_mv AS
        SELECT ra.season_id, ri.team_id, rr.race_id, ra.name AS race_name, SUM(rr.prize_money) AS race_points
        FROM public.race_results rr
        JOIN public.races ra ON ra.id = rr.race_id
        JOIN public.riders ri ON ri.id = rr.rider_id
        WHERE ri.team_id IS NOT NULL AND ra.squad = 'senior'
        GROUP BY ra.season_id, ri.team_id, rr.race_id, ra.name;
      CREATE UNIQUE INDEX team_race_points_mv_pk ON public.team_race_points_mv (season_id, team_id, race_id);
      CREATE FUNCTION public.refresh_team_race_points_mv(p_concurrently boolean) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $body$ BEGIN
        IF p_concurrently IS DISTINCT FROM true THEN RAISE EXCEPTION 'Concurrent refresh is required'; END IF;
        REFRESH MATERIALIZED VIEW CONCURRENTLY public.team_race_points_mv; END; $body$;
      INSERT INTO races VALUES (1, 1, 'Loeb A', 'senior'), (2, 1, 'Loeb B', 'senior'), (3, 1, 'Loeb U', 'u23');
      INSERT INTO riders VALUES (1, 10), (2, 10), (3, 20), (4, NULL);
      INSERT INTO race_results (race_id, rider_id, prize_money) VALUES
        (1, 1, 5), (1, 2, 3), (1, 3, 7), (1, 4, 9), (2, 1, NULL), (2, 3, 2), (3, 1, 100);
    `);

    const migration = readPlanMigration7664();
    await db.exec(migration);
    await db.exec(migration); // auto-migrate-sikker: anden koersel er en no-op.

    const { rows: [fn] } = await db.query(
      "SELECT proconfig FROM pg_proc WHERE oid = 'public.refresh_team_race_points_mv(boolean)'::regprocedure");
    assert.ok(fn.proconfig.includes("enable_mergejoin=off"), `proconfig: ${fn.proconfig}`);
    assert.ok(fn.proconfig.some((c) => c.startsWith("work_mem=")), `proconfig: ${fn.proconfig}`);
    assert.ok(fn.proconfig.some((c) => c.startsWith("search_path=")), "eksisterende search_path skal bevares");

    // Indstillingen er funktions-scoped: sessionen udenfor er uroert.
    const { rows: [outside] } = await db.query("SELECT current_setting('enable_mergejoin') AS v");
    assert.equal(outside.v, "on");

    // Nyt resultat, refresh gennem funktionen (CONCURRENTLY under de nye indstillinger).
    await db.exec("INSERT INTO race_results (race_id, rider_id, prize_money) VALUES (2, 2, 4)");
    await db.query("SELECT public.refresh_team_race_points_mv(true)");

    const { rows: diff } = await db.query(`
      WITH fresh AS (
        SELECT ra.season_id, ri.team_id, rr.race_id, ra.name AS race_name, SUM(rr.prize_money) AS race_points
        FROM race_results rr JOIN races ra ON ra.id = rr.race_id JOIN riders ri ON ri.id = rr.rider_id
        WHERE ri.team_id IS NOT NULL AND ra.squad = 'senior'
        GROUP BY ra.season_id, ri.team_id, rr.race_id, ra.name),
      mv AS (SELECT season_id, team_id, race_id, race_name, race_points FROM public.team_race_points_mv)
      SELECT (SELECT count(*) FROM (SELECT * FROM fresh EXCEPT ALL SELECT * FROM mv) a)::int AS fresh_minus_mv,
             (SELECT count(*) FROM (SELECT * FROM mv EXCEPT ALL SELECT * FROM fresh) b)::int AS mv_minus_fresh,
             (SELECT count(*) FROM mv)::int AS mv_rows`);
    assert.deepEqual(diff[0], { fresh_minus_mv: 0, mv_minus_fresh: 0, mv_rows: 4 });
  } finally {
    await db.close();
  }
});
