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
function recordingClient({ flags = {}, metrics = { queue_length: 0, oldest_age_s: null }, metricsError = null } = {}) {
  const tables = [], rpcs = [];
  const builder = (table) => {
    const b = {
      select: () => b, eq: (column, key) => { b._key = key; return b; }, in: () => b, or: () => b, order: () => b,
      limit: () => b, range: () => b, not: () => b,
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
  assert.equal(client.rpcs.length, 1);
  t += 2;
  await resolveRankingReadSource(client, { now: () => t });
  assert.equal(client.rpcs.length, 2);
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
async function routeTables(flags) {
  reset();
  const client = recordingClient({ flags });
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
  assert.equal(await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: 4 }), null);
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

test("#7664 dashboard without a pool pages past retired leaders until five riders are found", async () => {
  reset();
  const ranked = Array.from({ length: 120 }, (_, i) => ({ rider_id: `r${String(i).padStart(3, "0")}`, points: 1000 - i }));
  const retired = new Set(ranked.slice(0, 60).map((row) => row.rider_id));
  const client = recordingClient({ flags: BOTH_ON });
  const from = client.from.bind(client);
  client.from = (table) => {
    if (table === "ranking_rider_season") {
      const b = { select: () => b, eq: () => b, order: () => b,
        range: async (lo, hi) => ({ data: ranked.slice(lo, hi + 1), error: null }) };
      return b;
    }
    if (table === "riders") {
      let ids = [];
      const b = { select: () => b, in: (_c, v) => { ids = v; return b; },
        eq: async () => ({ data: ids.filter((id) => !retired.has(id)).map((id) => ({ id, firstname: id, team: null })), error: null }) };
      return b;
    }
    return from(table);
  };
  const top = await readDashboardTopRiders7664(client, { seasonId: SEASON, leagueDivisionId: null, source: { source: "shadow", currentAsOf: null } });
  assert.deepEqual(top.map((row) => row.rider_id), ["r060", "r061", "r062", "r063", "r064"]);
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

test("#7664 same numbers: shadow tables equal the legacy definitions across race-day scenarios", async (t) => {
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
