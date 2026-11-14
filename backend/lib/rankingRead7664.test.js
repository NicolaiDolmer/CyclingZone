// #7664: ranglisterne laeser skyggetabellerne bag kontakten.
//  1. Kildevalget: kun begge kontakter taendt + en sund koe giver "shadow".
//  2. Slukket = samme tabeller som i dag, rute for rute (optagelse af .from()).
//  3. Taendt = hver rangliste-rute laeser skyggen; global_rank_mv er uaendret.
//  4. Forsidens top 5: samme omfang og raekkefoelge som rytterranglisten.
//  5. Den fulde genberegning samles i et vindue, kun naar skyggen laeses.
//  6. Samme tal: skyggetabellerne mod de gamle matview-definitioner for
//     flere etaper samme dag, et etapeloeb med troejer, holdskifte og rettelse.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import {
  SHADOW_READ_TABLES, SHADOW_READ_MAX_LAG_S, SOURCE_CACHE_TTL_MS, LEGACY_HOLD_MS_7664,
  resolveRankingReadSource, rankingReadMiddleware, createRankingReadClient, createRankingFreshnessRouter,
  currentRankingReadSource, pickDashboardTopRiders, readDashboardTopRiders7664, __resetRankingReadCacheForTests,
  DASHBOARD_SHADOW_TIMEOUT_MS,
} from "./rankingRead7664.js";
import { clearFlagStageCache } from "./featureStage.js";
import { refreshRankingMatviewsGated, __resetRankingRefreshStateForTests } from "./refreshRankingMatviews.js";
import { createRankingsRouter } from "../routes/rankings.ts";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const SEASON = "00000000-0000-0000-0000-000000000003";
const TEAM = "11111111-1111-4111-8111-111111111111";
const RIDER = "22222222-2222-4222-8222-222222222222";

function reset() {
  __resetRankingReadCacheForTests();
  __resetRankingRefreshStateForTests();
  clearFlagStageCache();
}

// A recording Supabase fake: every builder resolves to an empty page.
function recordingClient({ flags = {}, metrics = { queue_length: 0, oldest_age_s: null }, metricsError = null, ready = { ready: true }, readyError = null } = {}) {
  const tables = [], rpcs = [];
  const builder = (table) => {
    const b = {
      select: () => b, eq: (column, key) => { b._key = key; return b; }, in: () => b, or: () => b, order: () => b,
      limit: () => b, range: () => b, not: () => b, abortSignal: () => b,
      maybeSingle: async () => (table === "app_config"
        ? { data: b._key in flags ? { value: flags[b._key] } : null, error: null }
        : { data: null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0, status: 200 }).then(resolve, reject),
    };
    return b;
  };
  return {
    tables, rpcs,
    from(table) { if (table !== "app_config") tables.push(table); return builder(table); },
    async rpc(name) {
      rpcs.push(name);
      if (name === "get_ranking_shadow_read_ready") return readyError ? { data: null, error: { message: readyError } } : { data: ready, error: null };
      if (name === "get_ranking_shadow_metrics") return metricsError ? { data: null, error: { message: metricsError } } : { data: metrics, error: null };
      return { data: null, error: null };
    },
  };
}
const BOTH_ON = { ranking_shadow_decoupled_6765: "on", ranking_shadow_enabled: "on" };

test("#7664 source: off unless both switches are on and the shadow queue is healthy", async () => {
  const cases = [
    [{}, "legacy"],
    [{ ranking_shadow_decoupled_6765: "off", ranking_shadow_enabled: "on" }, "legacy"],
    [{ ranking_shadow_decoupled_6765: "on", ranking_shadow_enabled: "off" }, "legacy"],
    [BOTH_ON, "shadow"],
    [{ ranking_shadow_decoupled_6765: "beta", ranking_shadow_enabled: "on" }, "shadow"],
  ];
  for (const [flags, expected] of cases) {
    reset();
    const client = recordingClient({ flags });
    const value = await resolveRankingReadSource(client, { now: () => NOW });
    assert.equal(value.source, expected, JSON.stringify(flags));
    // Off never touches the shadow queue.
    if (expected === "legacy") assert.deepEqual(client.rpcs, []);
  }
});

test("#7664 source: current_as_of follows the queue; a stalled or failing queue falls back to legacy", async () => {
  reset();
  let client = recordingClient({ flags: BOTH_ON });
  assert.deepEqual(await resolveRankingReadSource(client, { now: () => NOW }),
    { source: "shadow", currentAsOf: new Date(NOW).toISOString() });
  reset();
  client = recordingClient({ flags: BOTH_ON, metrics: { queue_length: 3, oldest_age_s: 90 } });
  assert.equal((await resolveRankingReadSource(client, { now: () => NOW })).currentAsOf, new Date(NOW - 90_000).toISOString());
  reset();
  client = recordingClient({ flags: BOTH_ON, metrics: { queue_length: 3, oldest_age_s: SHADOW_READ_MAX_LAG_S + 1 } });
  assert.equal((await resolveRankingReadSource(client, { now: () => NOW })).source, "legacy");
  reset();
  const captured = [];
  client = recordingClient({ flags: BOTH_ON, metricsError: "boom" });
  const value = await resolveRankingReadSource(client, { now: () => NOW, captureExceptionFn: (e, c) => captured.push(c) });
  assert.equal(value.source, "legacy");
  assert.equal(captured[0].tags.lib, "rankingRead7664");
});

test("#7664 source: one lookup per client within the cache window", async () => {
  reset();
  const client = recordingClient({ flags: BOTH_ON });
  let t = NOW;
  await resolveRankingReadSource(client, { now: () => t });
  t += SOURCE_CACHE_TTL_MS - 1;
  await resolveRankingReadSource(client, { now: () => t });
  assert.deepEqual(client.rpcs, Array(1).fill(["get_ranking_shadow_read_ready", "get_ranking_shadow_metrics"]).flat());
  t += 2;
  await resolveRankingReadSource(client, { now: () => t });
  assert.deepEqual(client.rpcs, Array(2).fill(["get_ranking_shadow_read_ready", "get_ranking_shadow_metrics"]).flat());
});

test("#7664 read client: outside a request and when legacy, every table name is passed through unchanged", async () => {
  const client = recordingClient();
  const proxied = createRankingReadClient(client);
  for (const name of [...Object.keys(SHADOW_READ_TABLES), "global_rank_mv", "riders"]) proxied.from(name);
  assert.deepEqual(client.tables, [...Object.keys(SHADOW_READ_TABLES), "global_rank_mv", "riders"]);
  assert.equal(currentRankingReadSource().source, "legacy");
  await proxied.rpc("x");
  assert.deepEqual(client.rpcs, ["x"]);
});

// The real rankings router behind the real middleware, as api.js mounts it.
async function routeTables(flags, options = {}) {
  reset();
  const client = recordingClient({ flags, ...options });
  const app = express();
  const requireAuth = (req, res, next) => { req.user = { id: "u" }; next(); };
  app.use("/rankings", createRankingFreshnessRouter({ supabase: client, requireAuth, reportError: () => {}, now: () => NOW }));
  app.use("/rankings", rankingReadMiddleware(client, { now: () => NOW }), createRankingsRouter({
    supabase: createRankingReadClient(client), requireAuth, reportError: (e) => { throw e; },
    viewerClient: () => client, isViewerBetaTester: async () => false,
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/rankings`;
  const perRoute = {};
  try {
    for (const path of [
      `/global`, `/global?team_id=${TEAM}`, `/riders?season_id=${SEASON}`, `/riders?season_id=${SEASON}&top=5`,
      `/riders?season_id=${SEASON}&rider_ids=${RIDER}`, `/standings?season_id=${SEASON}`, `/honours?season_id=${SEASON}`,
      `/race-points?season_id=${SEASON}`, `/race-points?race_ids=${RIDER}`, `/race-count?team_id=${TEAM}`,
    ]) {
      client.tables.length = 0;
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      perRoute[path] = [...client.tables];
    }
    const freshness = await (await fetch(base + "/freshness")).json();
    return { perRoute, freshness };
  } finally { server.close(); }
}

test("#7664 off = the exact tables of today, route by route; on = shadow tables, global unchanged", async () => {
  const off = await routeTables({});
  const today = {
    "/global": ["global_rank_mv"], [`/global?team_id=${TEAM}`]: ["global_rank_mv"],
    [`/riders?season_id=${SEASON}`]: ["rider_rankings_mv"], [`/riders?season_id=${SEASON}&top=5`]: ["rider_rankings_mv"],
    [`/riders?season_id=${SEASON}&rider_ids=${RIDER}`]: ["rider_rankings_mv"],
    [`/standings?season_id=${SEASON}`]: ["team_standings_ext_mv"],
    [`/honours?season_id=${SEASON}`]: ["rider_rankings_mv", "riders"],
    [`/race-points?season_id=${SEASON}`]: ["team_race_points_mv"], [`/race-points?race_ids=${RIDER}`]: ["team_race_points_mv"],
    [`/race-count?team_id=${TEAM}`]: ["team_race_points_mv"],
  };
  assert.deepEqual(off.perRoute, today);
  assert.deepEqual(off.freshness, { source: "legacy", current_as_of: null });

  const on = await routeTables(BOTH_ON);
  const mapped = Object.fromEntries(Object.entries(today).map(([path, tables]) =>
    [path, tables.map((name) => SHADOW_READ_TABLES[name] ?? name)]));
  assert.deepEqual(on.perRoute, mapped);
  assert.deepEqual(on.freshness, { source: "shadow", current_as_of: new Date(NOW).toISOString() });
});

test("#7664 dashboard: legacy returns null without a query; ranking order is points, then rider id", async () => {
  reset();
  const client = recordingClient();
  assert.equal(await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: 4, now: () => NOW }), null);
  assert.deepEqual(client.tables, []);

  const display = new Map([
    ["b", { firstname: "B", team: { name: "Hold A", is_ai: false } }],
    ["a", { firstname: "A", team: { name: "Hold B", is_ai: true } }],
    ["c", { firstname: "C", team: null }],
  ]);
  const stats = [
    { rider_id: "b", points: "40", stage_wins: "1", gc_wins: "0", classic_wins: "1" },
    { rider_id: "a", points: "40", stage_wins: "0", gc_wins: "1", classic_wins: "0" },
    { rider_id: "c", points: 70 },
    { rider_id: "retired", points: 999 },
  ];
  const top = pickDashboardTopRiders(stats, display, 2);
  assert.deepEqual(top.map((row) => row.rider_id), ["c", "a"]);
  assert.deepEqual(top[1], { rider_id: "a", firstname: "A", lastname: null, nationality_code: null, team_name: "Hold B", is_ai: true,
    points: 40, stage_wins: 0, gc_wins: 1, classic_wins: 0 });
  assert.deepEqual(pickDashboardTopRiders(stats, display).map((row) => row.rider_id), ["c", "a", "b"]);
});

// An honest PostgREST fake: it obeys the filters (eq/in), the order (with
// Postgres NULL placement: ASC puts NULL last, DESC puts NULL first unless
// nullsFirst says otherwise), limit and range. Without .order() it returns
// rows in a deliberately wrong order (reversed), so the code under test must
// ask the database for the order it relies on. Every read is recorded.
function honestClient(tables, { failOn = null, hangOn = null } = {}) {
  const reads = [];
  const compare = (orders) => (a, b) => {
    for (const { column, ascending, nullsFirst } of orders) {
      const x = a[column] ?? null, y = b[column] ?? null;
      if (x === y) continue;
      if (x === null) return nullsFirst ? -1 : 1;
      if (y === null) return nullsFirst ? 1 : -1;
      return (x < y ? -1 : 1) * (ascending ? 1 : -1);
    }
    return 0;
  };
  const matches = (row, filters) => filters.every(({ op, column, value }) =>
    op === "eq" ? row[column] === value : value.includes(row[column]));
  async function run(q) {
    reads.push(q);
    if (hangOn === q.table) {
      return new Promise((_, reject) => q.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error(`${q.table} aborted`), { name: "AbortError" }))));
    }
    if (failOn === q.table) return { data: null, error: { message: `${q.table} down` } };
    let rows = (tables[q.table] || []).filter((row) => matches(row, q.filters));
    rows = q.orders.length ? [...rows].sort(compare(q.orders)) : [...rows].reverse();
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) rows = rows.slice(0, q.limit);
    return { data: rows.map((row) => ({ ...row })), error: null };
  }
  const from = (table) => {
    const q = { table, select: null, filters: [], orders: [], limit: null, range: null, signal: null };
    const b = {
      select: (columns) => { q.select = columns; return b; },
      eq: (column, value) => { q.filters.push({ op: "eq", column, value }); return b; },
      in: (column, value) => { q.filters.push({ op: "in", column, value }); return b; },
      order: (column, { ascending = true, nullsFirst = !ascending } = {}) => { q.orders.push({ column, ascending, nullsFirst }); return b; },
      limit: (count) => { q.limit = count; return b; },
      range: (lo, hi) => { q.range = [lo, hi]; return b; },
      abortSignal: (signal) => { q.signal = signal; return b; },
      then: (resolve, reject) => run(q).then(resolve, reject),
    };
    return b;
  };
  return { reads, from, rpc: async () => ({ data: null, error: null }) };
}
const SHADOW = { source: "shadow", currentAsOf: null };
const OTHER_SEASON = "00000000-0000-0000-0000-000000000002";
const id4 = (prefix, i) => `${prefix}${String(i).padStart(4, "0")}`;
const riderRow = (id, { teamId = null, retired = false } = {}) =>
  ({ id, team_id: teamId, is_retired: retired, firstname: id, lastname: null, nationality_code: null, team: null });
// Reference computed independently of the code under test: every visible row,
// points DESC NULLS LAST, then rider id.
function expectedTop(statRows, visibleIds, limit = 5) {
  return statRows.filter((row) => visibleIds.has(row.rider_id))
    .sort((a, b) => ((b.points ?? -Infinity) - (a.points ?? -Infinity)) || (a.rider_id < b.rider_id ? -1 : 1))
    .slice(0, limit).map((row) => row.rider_id);
}

test("#7664 dashboard without a pool: database order, retired leaders skipped, other seasons and NULL points ignored", async () => {
  reset();
  // 120 riders with points, the 60 best retired; 10 riders without points
  // (NULL) and every rider with a much higher row in another season.
  const ranked = Array.from({ length: 120 }, (_, i) => ({ season_id: SEASON, rider_id: id4("r", i), points: 1000 - i }));
  const nulls = Array.from({ length: 10 }, (_, i) => ({ season_id: SEASON, rider_id: id4("n", i), points: null }));
  const other = ranked.map((row) => ({ ...row, season_id: OTHER_SEASON, points: 50_000 + row.points }));
  const riders = [...ranked, ...nulls].map((row, i) => riderRow(row.rider_id, { retired: i < 60 }));
  const client = honestClient({ ranking_rider_season: [...other, ...nulls, ...ranked], riders });
  const top = await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: null, source: SHADOW });
  assert.deepEqual(top.map((row) => row.rider_id), [id4("r", 60), id4("r", 61), id4("r", 62), id4("r", 63), id4("r", 64)]);
  assert.deepEqual(top.map((row) => row.points), [940, 939, 938, 937, 936]);
  for (const q of client.reads.filter((read) => read.table === "riders")) {
    assert.ok(q.filters.some((f) => f.column === "is_retired" && f.value === false), "retired riders are filtered in the database");
  }
});

// A pool: 24 teams in pool 1 and 24 in pool 2. Pool 1 holds `poolSize` riders;
// pool 2 and another season hold far higher points that must never leak in.
function poolTables({ poolSize, points, retired = new Set() }) {
  const teams = [
    ...Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, league_division_id: 1 })),
    ...Array.from({ length: 24 }, (_, i) => ({ id: `u${i}`, league_division_id: 2 })),
  ];
  const poolIds = Array.from({ length: poolSize }, (_, i) => id4("p", i));
  const outsiders = Array.from({ length: 200 }, (_, i) => id4("x", i));
  const riders = [
    ...poolIds.map((id, i) => riderRow(id, { teamId: `t${i % 24}`, retired: retired.has(id) })),
    ...outsiders.map((id, i) => riderRow(id, { teamId: `u${i % 24}` })),
  ];
  const stats = [
    ...poolIds.map((id, i) => ({ season_id: SEASON, rider_id: id, points: points(i), stage_wins: 0, gc_wins: 0, classic_wins: 0 })),
    ...outsiders.map((id, i) => ({ season_id: SEASON, rider_id: id, points: 10_000 + i })),
    ...poolIds.map((id) => ({ season_id: OTHER_SEASON, rider_id: id, points: 99_999 })),
  ];
  // Stored in a scrambled order so only the requested ORDER BY gives the right rows.
  const scrambled = stats.map((row, i) => [(i * 7919) % stats.length, row]).sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  return { poolIds, stats, tables: { teams, riders, ranking_rider_season: scrambled } };
}

test("#7664 dashboard with a pool: few small reads filtered and ordered in the database, same top 5 as a full scan", async () => {
  reset();
  // Prod 13/11: largest pool 1,072 riders. The three best riders of the pool
  // are retired, so a missing retired filter in the pool shows fewer than five.
  const points = (i) => (i * 37) % 501;
  const byPoints = Array.from({ length: 1072 }, (_, i) => [id4("p", i), points(i)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const retired = new Set(byPoints.slice(0, 3).map(([id]) => id));
  const { poolIds, stats, tables } = poolTables({ poolSize: 1072, points, retired });
  const client = honestClient(tables);
  const top = await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: 1, source: SHADOW });

  const visible = new Set(poolIds.filter((id) => !retired.has(id)));
  assert.deepEqual(top.map((row) => row.rider_id), expectedTop(stats.filter((row) => row.season_id === SEASON), visible));
  assert.equal(top.length, 5);

  const shadowReads = client.reads.filter((q) => q.table === "ranking_rider_season");
  assert.equal(shadowReads.length, Math.ceil(1069 / 100), "one read per 100 pool riders");
  for (const q of shadowReads) {
    assert.equal(q.limit, 5);
    assert.deepEqual(q.filters.find((f) => f.column === "season_id")?.value, SEASON);
    assert.ok(q.filters.find((f) => f.column === "rider_id").value.length <= 100);
    assert.deepEqual(q.orders, [{ column: "points", ascending: false, nullsFirst: false }, { column: "rider_id", ascending: true, nullsFirst: false }]);
  }
  const riderReads = client.reads.filter((q) => q.table === "riders");
  assert.equal(riderReads.filter((q) => q.filters.some((f) => f.column === "team_id")).every((q) => q.select === "id"), true);
  assert.deepEqual(riderReads.filter((q) => q.filters.some((f) => f.column === "id")).map((q) => q.filters.find((f) => f.column === "id").value.length), [5]);
});

test("#7664 dashboard: a rider without points (NULL) ranks after 0, in the database and in Node alike", async () => {
  reset();
  // Two bids: the first 100 riders (lowest ids) have NULL points, the second
  // bid has three riders with points and the rest on 0.
  const points = (i) => (i < 100 ? null : i < 103 ? 30 - i % 100 : 0);
  const { poolIds, stats, tables } = poolTables({ poolSize: 150, points });
  const top = await readDashboardTopRiders7664(honestClient(tables), { seasonId: SEASON, leagueDivisionId: 1, source: SHADOW });
  assert.deepEqual(top.map((row) => row.rider_id), [id4("p", 100), id4("p", 101), id4("p", 102), id4("p", 103), id4("p", 104)]);
  assert.deepEqual(top.map((row) => row.rider_id), expectedTop(stats.filter((row) => row.season_id === SEASON), new Set(poolIds)));
  // The pure merge agrees: NULL after 0 even when the NULL rider has the lower id.
  const display = new Map([["a", { firstname: "A" }], ["b", { firstname: "B" }]]);
  assert.deepEqual(pickDashboardTopRiders([{ rider_id: "a", points: null }, { rider_id: "b", points: 0 }], display).map((row) => row.rider_id), ["b", "a"]);
});

test("#7664 dashboard safety net: a failing shadow read is reported once and returns null (today's RPC)", async () => {
  for (const [failOn, leagueDivisionId] of [["ranking_rider_season", 1], ["riders", 1], ["teams", 1], ["ranking_rider_season", null]]) {
    reset();
    const client = honestClient(poolTables({ poolSize: 50, points: (i) => i }).tables, { failOn });
    const captured = [];
    const top = await readDashboardTopRiders7664(client, {
      seasonId: SEASON, leagueDivisionId, source: SHADOW,
      captureExceptionFn: (error, context) => captured.push({ error, context }),
    });
    assert.equal(top, null, `${failOn} / ${leagueDivisionId}`);
    assert.equal(captured.length, 1);
    assert.match(captured[0].error.message, /down/);
    assert.deepEqual(captured[0].context.tags, { lib: "rankingRead7664", path: "dashboard-top" });
  }
});

test("#7664 dashboard time limit: a hanging read gives up, aborts its reads and is reported once", async () => {
  assert.ok(DASHBOARD_SHADOW_TIMEOUT_MS <= 1500, "leaves half of the 3 s dashboard budget for today's RPC");
  for (const [hangOn, leagueDivisionId] of [["ranking_rider_season", 1], ["riders", 1], ["teams", 1], ["ranking_rider_season", null]]) {
    reset();
    const client = honestClient(poolTables({ poolSize: 250, points: (i) => i }).tables, { hangOn });
    const captured = [];
    const top = await readDashboardTopRiders7664(client, {
      seasonId: SEASON, leagueDivisionId, source: SHADOW, timeoutMs: 40,
      captureExceptionFn: (error, context) => captured.push({ error, context }),
    });
    assert.equal(top, null, `${hangOn} / ${leagueDivisionId}`);
    // The hanging read never settles, so any answer at all comes from the time limit.
    assert.equal(captured.length, 1);
    assert.match(captured[0].error.message, /exceeded 40 ms/);
    const hanging = client.reads.filter((q) => q.table === hangOn);
    assert.ok(hanging.length > 0 && hanging.every((q) => q.signal?.aborted), "every hanging read is aborted");
  }
  // A hanging source lookup (queue RPC with the switch on, or the flag lookup
  // itself, also with the switch off) is inside the same limit. The answer is
  // right anyway (today's RPC), so it is not reported as a shadow failure.
  for (const hang of ["rpc", "flags"]) {
    reset();
    const client = recordingClient({ flags: hang === "rpc" ? BOTH_ON : {} });
    if (hang === "rpc") client.rpc = () => new Promise(() => {});
    else client.from = () => { const b = { select: () => b, eq: () => b, maybeSingle: () => new Promise(() => {}) }; return b; };
    const captured = [];
    const top = await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: 1, timeoutMs: 40, now: () => NOW,
      captureExceptionFn: (error) => captured.push(error) });
    assert.equal(top, null, hang);
    assert.equal(captured.length, 0, hang);
  }
});

// A coordinator fake for the gated path: pending work of a given age.
function coordinatorClient({ flags, pendingAgeMs }) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "app_config");
      const b = { select: () => b, eq: (_c, key) => { b._key = key; return b; },
        maybeSingle: async () => ({ data: b._key in flags ? { value: flags[b._key] } : null, error: null }) };
      return b;
    },
    async rpc(name, args) {
      calls.push(name);
      if (name === "get_ranking_refresh_work_state") return { data: { pending: true, pending_age_ms: pendingAgeMs, last_completed_at: null }, error: null };
      if (name === "claim_ranking_refresh_work") return { data: { status: "claimed", token: args.p_token, target_version: "2" }, error: null };
      if (name === "renew_ranking_refresh_work" || name === "finish_ranking_refresh_work") return { data: true, error: null };
      if (name === "get_ranking_shadow_read_ready") return { data: { ready: true }, error: null };
      if (name === "get_ranking_shadow_metrics") return { data: { queue_length: 0 }, error: null };
      if (name === "apply_ranking_deltas") return { data: { pending: false }, error: null };
      if (name === "check_ranking_shadow_parity") return { data: { status: "equal" }, error: null };
      return { data: null, error: null };
    },
  };
}
const legacyPasses = (calls) => calls.filter((name) => name === "refresh_rider_rankings_mv").length;
const gated = (client) => refreshRankingMatviewsGated(client, {
  now: new Date(NOW), testNowFn: () => new Date(NOW), clock: () => 0, logger: { log() {}, info() {}, warn() {} },
});

test("#7664 hold: the full pass waits only while readers use the shadow tables", async () => {
  // Off: a fresh change runs the full pass at once, as today.
  reset();
  let client = coordinatorClient({ flags: {}, pendingAgeMs: 1000 });
  assert.equal(await gated(client), true);
  assert.equal(legacyPasses(client.calls), 1);
  // Decoupled but shadow writes off: readers stay on matviews, so no hold.
  reset();
  client = coordinatorClient({ flags: { ranking_shadow_decoupled_6765: "on", ranking_shadow_enabled: "off" }, pendingAgeMs: 1000 });
  await gated(client);
  assert.equal(legacyPasses(client.calls), 1);
  // On: a fresh change is held; the shadow still runs.
  reset();
  client = coordinatorClient({ flags: BOTH_ON, pendingAgeMs: 1000 });
  assert.equal(await gated(client), "deferred");
  assert.equal(legacyPasses(client.calls), 0);
  assert.ok(client.calls.includes("apply_ranking_deltas"));
  // On: once the window has passed, one full pass covers everything collected.
  reset();
  client = coordinatorClient({ flags: BOTH_ON, pendingAgeMs: LEGACY_HOLD_MS_7664 });
  assert.equal(await gated(client), true);
  assert.equal(legacyPasses(client.calls), 1);
});

// ── Samme tal: skyggen mod de gamle definitioner ───────────────────────────
const read = (path) => readFileSync(new URL("../../database/" + path, import.meta.url), "utf8");
const views = ["rider_rankings_mv", "youth_rider_rankings_mv", "team_standings_ext_mv", "team_race_points_mv"];
const definitions = views.map((name) => (name.startsWith("youth") ? read("2026-09-25-4620-youth-rider-rankings-mv.sql") : read("2026-09-25-5535-senior-only-result-aggregates.sql"))
  .match(new RegExp("CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\." + name + " AS\\s*([\\s\\S]*?);"))[1]);

// The real shadow migrations (and the #7664 readiness migration) on PGlite.
async function shadowDb(t) {
  const db = await PGlite.create(); t.after(() => db.close());
  await db.exec([
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
    "GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;",
    "CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);",
    "CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text);",
    "CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid);",
    "CREATE TABLE race_results(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,race_id uuid REFERENCES races(id) ON DELETE CASCADE,rider_id uuid REFERENCES riders(id) ON DELETE SET NULL,team_id uuid,points_earned integer,prize_money bigint,rank int,result_type text);",
    "CREATE INDEX idx_race_results ON race_results(race_id);",
    "CREATE FUNCTION fid(int) RETURNS uuid LANGUAGE SQL IMMUTABLE AS 'SELECT md5($1::text)::uuid';",
    "CREATE TABLE ranking_refresh_work_state(matview_group text,lease_token uuid,leased_version bigint,lease_expires_at timestamptz,requested_version bigint,completed_version bigint);",
    "INSERT INTO ranking_refresh_work_state VALUES('ranking',NULL,NULL,NULL,1,1);",
    // Two teams of six riders, one free agent.
    "INSERT INTO riders SELECT fid(i),CASE WHEN i=13 THEN NULL ELSE fid(100+i%2) END FROM generate_series(1,13) i;",
    // An ongoing stage race, two one-day races the same day, a youth race.
    "INSERT INTO races VALUES(fid(1001),fid(2001),'senior','stage_race','Etapeloeb'),(fid(1002),fid(2001),'senior','single','Klassiker 1'),(fid(1003),fid(2001),'senior','single','Klassiker 2'),(fid(1004),fid(2001),'u23','single','U23');",
    ...views.map((n, i) => "CREATE MATERIALIZED VIEW public." + n + " AS " + definitions[i] + ";"),
  ].join("\n"));
  await db.exec(read("2026-10-19-6765-incremental-rankings-shadow.sql"));
  await db.exec(read("2026-10-23-6765-ranking-shadow-contrib-transfers.sql"));
  await db.exec(read("2026-10-31-6765-ranking-shadow-codex-p1-p2.sql"));
  await db.exec(read("2026-11-13-7664-ranking-shadow-read-ready.sql"));
  return db;
}

test("#7664 same numbers: shadow tables equal the legacy definitions across race-day scenarios", async (t) => {
  const db = await shadowDb(t);
  await db.exec("UPDATE app_config SET value='\"on\"'::jsonb WHERE key='ranking_shadow_enabled';");
  const drain = async () => {
    for (let i = 0; i < 200; i++) {
      const r = await db.query("SELECT apply_ranking_deltas(200) v");
      if (!r.rows[0].v.pending) return;
    }
    assert.fail("queue did not drain");
  };
  const parity = async (label) => {
    for (let i = 0; i < views.length; i++) {
      const a = definitions[i], b = "SELECT * FROM " + SHADOW_READ_TABLES[views[i]];
      const r = await db.query("SELECT count(*)::int n FROM ((" + a + " EXCEPT ALL " + b + ") UNION ALL (" + b + " EXCEPT ALL " + a + ")) d");
      assert.equal(r.rows[0].n, 0, label + ": " + views[i]);
    }
    const rows = await db.query("SELECT count(*)::int n FROM ranking_rider_season");
    return rows.rows[0].n;
  };
  // rank 1..12 for every stage row plus the day's jersey holders.
  const stage = (race, stageNo) => `INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type)
    SELECT fid(${race}),fid(i),fid(100+i%2),(13-i)*${stageNo},(13-i)*1000,i,'stage' FROM generate_series(1,12) i;
    INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) VALUES
      (fid(${race}),fid(${1 + stageNo % 12}),fid(100+${(1 + stageNo % 12) % 2}),NULL,NULL,1,'leader'),
      (fid(${race}),fid(${2 + stageNo % 11}),NULL,5,NULL,1,'points_day'),
      (fid(${race}),fid(${3 + stageNo % 10}),NULL,5,NULL,1,'mountain_day'),
      (fid(${race}),fid(${4 + stageNo % 9}),NULL,NULL,NULL,1,'young_day');`;

  await drain();
  assert.equal(await parity("empty season"), 0);

  await t.test("several stages of a stage race the same day", async () => {
    for (const stageNo of [1, 2, 3]) {
      await db.exec(stage(1001, stageNo));
      await drain();
      assert.ok(await parity("stage " + stageNo) > 0);
    }
  });
  await t.test("two one-day races and a youth race in the same hour", async () => {
    await db.exec(stage(1002, 1) + stage(1003, 1) + stage(1004, 1));
    await drain();
    await parity("same hour");
  });
  await t.test("stage race finishes with final classifications", async () => {
    await db.exec(`INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type)
      SELECT fid(1001),fid(i),fid(100+i%2),100-i,50000-i*1000,i,'gc' FROM generate_series(1,12) i;
      INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) VALUES
      (fid(1001),fid(2),NULL,20,1000,1,'points'),(fid(1001),fid(3),NULL,20,1000,1,'mountain'),(fid(1001),fid(4),NULL,20,1000,1,'young'),
      (fid(1001),NULL,fid(100),30,5000,1,'team'),(fid(1001),NULL,fid(101),10,2000,2,'team');`);
    await drain();
    await parity("final classifications");
  });
  await t.test("rider changes team mid-season (holdskifte)", async () => {
    await db.exec("UPDATE riders SET team_id=fid(101) WHERE id=fid(2); UPDATE riders SET team_id=NULL WHERE id=fid(4); UPDATE riders SET team_id=fid(100) WHERE id=fid(13);");
    await drain();
    await parity("transfer");
  });
  await t.test("a result is corrected and a race is removed", async () => {
    await db.exec("UPDATE race_results SET points_earned=points_earned+7 WHERE race_id=fid(1002) AND rank<=3; DELETE FROM races WHERE id=fid(1003);");
    await drain();
    await parity("correction");
  });
});

// ── Genopbygning: læserne skifter først, når den er helt færdig (Codex P1) ──
test("#7664 rebuild: the switch waits for the database's own 'rebuild finished'; anything else stays on matviews", async () => {
  const cases = [
    // [svar fra get_ranking_shadow_read_ready, fejl, forventet kilde, rapporter]
    [{ ready: false, stage: "queued" }, null, "legacy", 0],
    [{ ready: false, stage: "rebuilding", watermark_id: "812" }, null, "legacy", 0],
    [{ ready: "true" }, null, "legacy", 0],
    [null, null, "legacy", 0],
    [null, "function get_ranking_shadow_read_ready() does not exist", "legacy", 1],
    [{ ready: true, ready_at: "2026-11-13T09:59:00Z" }, null, "shadow", 0],
  ];
  for (const [ready, readyError, expected, reports] of cases) {
    reset();
    const client = recordingClient({ flags: BOTH_ON, ready, readyError });
    const captured = [];
    const value = await resolveRankingReadSource(client, { now: () => NOW, captureExceptionFn: (e) => captured.push(e) });
    assert.equal(value.source, expected, JSON.stringify({ ready, readyError }));
    assert.equal(captured.length, reports);
    if (expected === "legacy") {
      assert.equal(value.currentAsOf, null, "no 'updated at' for the old numbers");
      assert.ok(!client.rpcs.includes("get_ranking_shadow_metrics"), "a young queue cannot override an unfinished rebuild");
      // The dashboard uses today's RPC: no shadow read at all.
      client.tables.length = 0;
      assert.equal(await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: 1, now: () => NOW }), null);
      assert.deepEqual(client.tables, []);
    }
  }
  // Freshness and every rankings route stay on today's tables during a rebuild.
  const during = await routeTables(BOTH_ON, { ready: { ready: false, stage: "rebuilding" } });
  assert.deepEqual(during.freshness, { source: "legacy", current_as_of: null });
  for (const tables of Object.values(during.perRoute)) {
    for (const name of tables) assert.ok(!Object.values(SHADOW_READ_TABLES).includes(name), name);
  }
  // The full matview pass is not held while readers are still on matviews.
  reset();
  const coordinator = coordinatorClient({ flags: BOTH_ON, pendingAgeMs: 1000 });
  const rpc = coordinator.rpc.bind(coordinator);
  coordinator.rpc = (name, args) => (name === "get_ranking_shadow_read_ready" ? { data: { ready: false }, error: null } : rpc(name, args));
  assert.equal(await gated(coordinator), true);
  assert.equal(legacyPasses(coordinator.calls), 1);
});

test("#7664 rebuild in the database: first enable, half-built, finished, re-enable after an off period", async (t) => {
  const db = await shadowDb(t);
  const ready = async () => (await db.query("SELECT get_ranking_shadow_read_ready() v")).rows[0].v;
  // Fixed clocks (AGENTS.md rule 16): queue age is measured against an injected p_now.
  const QUEUED_AT = "2026-11-13T10:00:00Z", METRICS_AT = "2026-11-13T10:00:02Z";
  const metrics = async () => (await db.query("SELECT get_ranking_shadow_metrics($1::timestamptz) v", [METRICS_AT])).rows[0].v;
  const step = async () => (await db.query("SELECT apply_ranking_deltas(1) v")).rows[0].v;
  const drain = async () => { for (let i = 0; i < 500; i++) if (!(await db.query("SELECT apply_ranking_deltas(200) v")).rows[0].v.pending) return; assert.fail("queue did not drain"); };
  const shadowRows = async () => (await db.query("SELECT count(*)::int n FROM ranking_rider_season")).rows[0].n;
  // The legacy definition itself (what a matview pass would publish), read directly.
  const legacyRows = async () => (await db.query("SELECT count(*)::int n FROM (" + definitions[0] + ") d")).rows[0].n;
  const results = (race, base) => `INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type)
    SELECT fid(${race}),fid(i),fid(100+i%2),${base}-i,1000,i,'stage' FROM generate_series(1,12) i;`;

  // Results exist while the shadow is off (nothing queued): the shadow is empty.
  await db.exec(results(1002, 50) + results(1003, 40) + results(1001, 30));
  assert.equal(await shadowRows(), 0);
  assert.equal((await ready()).ready, false, "fresh install is not confirmed");

  await t.test("first enable with empty shadow tables: not ready while the marker waits", async () => {
    await db.exec("UPDATE app_config SET value='\"on\"'::jsonb WHERE key='ranking_shadow_enabled';");
    await db.query("UPDATE ranking_dirty_log SET enqueued_at=$1::timestamptz", [QUEUED_AT]);
    const m = await metrics();
    assert.equal(Number(m.queue_length), 1);
    assert.equal(Number(m.oldest_age_s), 2, "the queue looks perfectly fresh (2 s old)");
    assert.deepEqual([(await ready()).ready, (await ready()).stage], [false, "queued"]);
  });
  await t.test("half rebuilt: the marker is expanded, some races done, others not", async () => {
    await step(); // claims the marker and expands it into one item per race
    assert.equal((await ready()).ready, false);
    await step(); // one race processed
    assert.ok(await shadowRows() > 0, "some numbers are in the shadow");
    assert.ok(await shadowRows() < await legacyRows() || (await metrics()).queue_length > 0);
    const r = await ready();
    assert.deepEqual([r.ready, r.stage], [false, "rebuilding"]);
  });
  await t.test("rebuild finished: now the readers may switch, and it stays so for normal work", async () => {
    await drain();
    const r = await ready();
    assert.equal(r.ready, true);
    assert.equal(await shadowRows(), await legacyRows());
    await db.exec("UPDATE race_results SET points_earned=points_earned+1 WHERE race_id=fid(1002) AND rank=1;");
    assert.ok(Number((await metrics()).queue_length) > 0);
    assert.equal((await ready()).ready, true, "ordinary changes do not reopen a finished rebuild");
    await drain();
  });
  await t.test("re-enable after an off period with stale numbers: back to not ready until rebuilt", async () => {
    await db.exec("UPDATE app_config SET value='\"off\"'::jsonb WHERE key='ranking_shadow_enabled';");
    await db.exec(results(1004, 90)); // skipped while off: the shadow is now stale
    await db.exec("UPDATE app_config SET value='\"on\"'::jsonb WHERE key='ranking_shadow_enabled';");
    assert.ok(await shadowRows() > 0, "old numbers are still in the shadow");
    assert.equal((await ready()).ready, false);
    await step();
    await step();
    assert.equal((await ready()).ready, false, "half rebuilt again");
    await drain();
    assert.equal((await ready()).ready, true);
    assert.equal(await shadowRows(), await legacyRows());
  });
});
