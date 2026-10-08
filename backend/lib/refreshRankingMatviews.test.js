import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function createMockSupabase({ rpcErrors = {}, heartbeatError = null, workRows = [], workError = null } = {}) {
  const rpcCalls = [];
  const upsertCalls = [];
  const workQueries = [];
  let requested = 1, completed = 0, target = null, clock = () => 0, dirtyAt = 0, clockInitialized = false, lastCompleted = null, onComplete = () => {};
  const control = (name, args) => {
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

test('#5692: unchanged ticks perform only the cheap durable state check', async () => {
  const calls = [];
  const db = { async rpc(name) { calls.push(name); return { data: { pending: false, pending_age_ms: 0, last_completed_at: FIXED_NOW.toISOString() }, error: null }; } };
  assert.equal(await rawGated(db, { now: FIXED_NOW, clock: () => 0, heartbeatNowFn: () => FIXED_NOW, logger: quietLogger }), true);
  assert.deepEqual(calls, ['get_ranking_refresh_work_state']);
});
