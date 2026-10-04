import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createRankingsRouter } from "./rankings.ts";
import { refreshRankingMatviewsSafe } from "../lib/refreshRankingMatviews.js";

// Opt-in REAL PostgreSQL 17 + PostgREST integration. These variables are only
// test-tool locations, never a production DB URL. No mock proves DB concurrency.
// All files/cluster state stay in the lane's explicitly supplied scratch folder.
const pgBin = process.env.RANKING_TEST_PG_BIN;
const restBin = process.env.RANKING_TEST_POSTGREST;
const scratch = process.env.RANKING_TEST_SCRATCH;
const TEAM = "20000000-0000-4000-8000-000000000001"; // synthetic fixture
const SEASON = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-04T10:00:00Z");
const views = ["rider_rankings_mv", "team_standings_ext_mv", "team_race_points_mv", "global_rank_mv", "youth_rider_rankings_mv"];

const delay = () => new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) => server.close(err => err ? reject(err) : resolveClose()));
  return address.port;
}

async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay();
  }
  assert.fail("isolated DB did not reach the observed barrier");
}

function observeChild(child: ChildProcess) {
  let output = "";
  child.stdout?.on("data", chunk => { output += String(chunk); });
  child.stderr?.on("data", chunk => { output += String(chunk); });
  const stopped = once(child, "exit");
  // Attach immediately so a spawn failure cannot become an unhandled rejection.
  stopped.catch(err => { output += `process error: ${String(err)}`; });
  return { child, stopped, output: () => output };
}

test("#5692 real RPC: plain refresh blocks readers; concurrent overload serves last committed data", {
  skip: !pgBin || !restBin || !scratch ? "requires isolated PostgreSQL 17/PostgREST binaries and lane scratch" : false,
  timeout: 60_000,
}, async t => {
  assert.ok(pgBin && restBin && scratch);
  const version = execFileSync(join(pgBin, "postgres.exe"), ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  assert.match(version, /PostgreSQL\) 17\./, "do not substitute PGlite or another major version");
  const runDir = mkdtempSync(join(resolve(scratch), "ranking-5692-"));
  const cluster = join(runDir, "cluster");
  const dbPort = await freePort();
  const restPort = await freePort();
  execFileSync(join(pgBin, "initdb.exe"), ["-D", cluster, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { windowsHide: true });
  const postgres = observeChild(spawn(join(pgBin, "postgres.exe"), ["-D", cluster, "-h", "127.0.0.1", "-p", String(dbPort)], { windowsHide: true }));
  const psqlArgs = ["-X", "-q", "-A", "-t", "-h", "127.0.0.1", "-p", String(dbPort), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  const sql = (statement: string) => execFileSync(join(pgBin, "psql.exe"), [...psqlArgs, "-c", statement], { encoding: "utf8", windowsHide: true }).trim();
  t.after(async () => {
    if (postgres.child.exitCode === null) {
      execFileSync(join(pgBin, "pg_ctl.exe"), ["-D", cluster, "stop", "-m", "immediate", "-w"], { windowsHide: true });
    }
    await postgres.stopped;
  });
  await eventually(async () => {
    try { return sql("SELECT 1") === "1"; } catch { return false; } // expected startup probe
  });
  sql(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE authenticator LOGIN NOINHERIT; GRANT service_role TO authenticator;
    GRANT USAGE ON SCHEMA public TO service_role;
    CREATE TABLE public.fixture_source(id integer PRIMARY KEY, total integer);
    INSERT INTO public.fixture_source VALUES (1, 7);
    CREATE FUNCTION public.fixture_gate() RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
    BEGIN PERFORM pg_advisory_xact_lock(5692001); RETURN true; END; $$;
    CREATE FUNCTION public.fixture_limits() RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM set_config('lock_timeout', CASE WHEN current_setting('request.method', true) IN ('GET','HEAD') THEN '100ms' ELSE '10s' END, true);
      PERFORM set_config('statement_timeout', '20s', true);
    END; $$;
    GRANT EXECUTE ON FUNCTION public.fixture_limits() TO service_role;
    CREATE TABLE public.matview_refresh_heartbeat(matview_group text PRIMARY KEY, refreshed_at timestamptz);
    GRANT ALL ON public.matview_refresh_heartbeat TO service_role;
    CREATE MATERIALIZED VIEW public.team_race_points_mv AS
      SELECT '${SEASON}'::uuid AS season_id, '${TEAM}'::uuid AS team_id,
        ('40000000-0000-4000-8000-' || lpad(id::text, 12, '0'))::uuid AS race_id,
        total AS race_points FROM public.fixture_source WHERE public.fixture_gate();
    CREATE UNIQUE INDEX team_race_points_mv_pk ON public.team_race_points_mv(season_id,team_id,race_id);
    ${views.filter(view => view !== "team_race_points_mv").map(view => `
      CREATE MATERIALIZED VIEW public.${view} AS SELECT id,total FROM public.fixture_source;
      CREATE UNIQUE INDEX ${view}_pk ON public.${view}(id);`).join("\n")}
    ${views.map(view => `
      GRANT SELECT ON public.${view} TO service_role;
      CREATE FUNCTION public.refresh_${view}() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_catalog AS $$ BEGIN REFRESH MATERIALIZED VIEW public.${view}; END; $$;
      REVOKE ALL ON FUNCTION public.refresh_${view}() FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.refresh_${view}() TO service_role;`).join("\n")}
  `);
  const configPath = join(runDir, "postgrest.conf");
  writeFileSync(configPath, [
    `db-uri = "postgresql://authenticator@127.0.0.1:${dbPort}/postgres"`,
    'db-schemas = "public"', 'db-anon-role = "service_role"',
    'db-pre-request = "public.fixture_limits"', 'server-host = "127.0.0.1"',
    `server-port = ${restPort}`, 'db-pool = 5',
  ].join("\n"));
  const postgrest = observeChild(spawn(restBin, [configPath], { windowsHide: true }));
  t.after(async () => {
    if (postgrest.child.exitCode === null) postgrest.child.kill();
    await postgrest.stopped;
  });
  const restUrl = `http://127.0.0.1:${restPort}`;
  await eventually(async () => {
    try { return (await fetch(`${restUrl}/`)).ok; } catch { return false; } // expected startup probe
  });
  // Real HTTP transport; remove only the synthetic Supabase auth headers because
  // this loopback fixture impersonates service_role through db-anon-role.
  const client = createClient(restUrl, "local-fixture", { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (input, init) => {
      const url = String(input).replace("/rest/v1/", "/");
      const headers = new Headers(init?.headers);
      headers.delete("Authorization"); headers.delete("apikey");
      return fetch(url, { ...init, headers });
    },
  } });
  const reported: unknown[] = [];
  const app = express();
  app.use("/api/rankings", createRankingsRouter({ supabase: client, requireAuth: (_req, _res, next) => next(), reportError: err => reported.push(err), viewerClient: () => client }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const count = () => fetch(`http://127.0.0.1:${address.port}/api/rankings/race-count?team_id=${TEAM}`);

  async function duringRefresh(legacy: boolean) {
    const holder = observeChild(spawn(join(pgBin!, "psql.exe"), psqlArgs, { windowsHide: true }));
    holder.child.stdin!.write("BEGIN; SELECT pg_advisory_xact_lock(5692001);\n\\echo BARRIER_HELD\n");
    await eventually(async () => holder.output().includes("BARRIER_HELD"));
    // The baseline changes only the call signature back to the original no-arg
    // RPC, against the real DB. It is not a simulated lock or a mock transport.
    const refreshClient = legacy ? { rpc: (name: string) => client.rpc(name), from: client.from.bind(client) } : client;
    const refreshing = refreshRankingMatviewsSafe(refreshClient, { nowFn: () => NOW });
    try {
      await eventually(async () => sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE '%refresh_team_race_points_mv%'") === "1");
      const mode = sql("SELECT CASE WHEN bool_or(mode='AccessExclusiveLock') THEN 'AccessExclusiveLock' ELSE 'ExclusiveLock' END FROM pg_locks WHERE relation = 'public.team_race_points_mv'::regclass AND granted AND mode IN ('AccessExclusiveLock','ExclusiveLock')");
      const rows = await client.from("team_race_points_mv").select("race_id,race_points").eq("team_id", TEAM).order("race_id");
      const response = await count();
      const body = await response.json();
      return { mode, rows, status: response.status, body };
    } finally {
      holder.child.stdin!.end("ROLLBACK;\n\\q\n");
      await holder.stopped;
      assert.equal(await refreshing, true, "all five RPC commits must succeed");
    }
  }

  sql("INSERT INTO public.fixture_source VALUES (2,9)");
  const before = await duringRefresh(true);
  t.diagnostic(`before: lock=${before.mode}, SELECT=${before.rows.error?.code}, route HTTP=${before.status}`);
  assert.equal(before.mode, "AccessExclusiveLock");
  assert.equal(before.rows.error?.code, "55P03");
  assert.equal(before.status, 500, "reproduce CYCLINGZONE-65 through the real rankings router");
  assert.equal(reported.length, 1);
  assert.equal(sql("SELECT count(*) FROM public.team_race_points_mv"), "2");

  // Restore the same old snapshot before the concurrent run. This local fixture
  // setup is not a production write, migration deployment or data repair.
  sql("DELETE FROM public.fixture_source WHERE id=2; SELECT public.refresh_team_race_points_mv(); INSERT INTO public.fixture_source VALUES (2,9)");
  const proposal = readFileSync(new URL("../../database/proposals/2026-10-05-5692-ranking-refresh.sql", import.meta.url), "utf8");
  sql(proposal); sql(proposal); // idempotence on an isolated throwaway DB only
  // Verify actual grants and mode enforcement, not just comments/source matches.
  assert.equal(sql("SELECT has_function_privilege('anon','public.refresh_team_race_points_mv(boolean)','EXECUTE')"), "f");
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.refresh_team_race_points_mv(boolean)','EXECUTE')"), "f");
  assert.equal(sql("SELECT has_function_privilege('service_role','public.refresh_team_race_points_mv(boolean)','EXECUTE')"), "t");
  await eventually(async () => {
    const result = await client.rpc("refresh_team_race_points_mv", { p_concurrently: false });
    return result.error?.code === "22023";
  });
  const after = await duringRefresh(false);
  t.diagnostic(`after: lock=${after.mode}, SELECT error=${after.rows.error?.code ?? "none"}, route HTTP=${after.status}`);
  assert.equal(after.mode, "ExclusiveLock");
  assert.equal(after.rows.error, null);
  assert.equal(after.rows.data?.length, 1, "refresh serves the last COMMITTED snapshot");
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, { count: 1 });
  assert.equal(reported.length, 1, "no new route error under concurrent refresh");
  const finished = await client.from("team_race_points_mv").select("race_id,race_points").order("race_id");
  assert.equal(finished.error, null);
  assert.deepEqual(finished.data, [
    { race_id: "40000000-0000-4000-8000-000000000001", race_points: 7 },
    { race_id: "40000000-0000-4000-8000-000000000002", race_points: 9 },
  ], "plain and concurrent refresh produce identical values");
  assert.equal(sql("SELECT refreshed_at = '2026-10-04T10:00:00Z'::timestamptz FROM public.matview_refresh_heartbeat WHERE matview_group='ranking'"), "t");
  sql("DROP INDEX public.team_race_points_mv_pk; INSERT INTO public.fixture_source VALUES (3,11)");
  assert.equal(await refreshRankingMatviewsSafe(client, {
    nowFn: () => new Date("2026-10-04T10:01:00Z"),
  }), false, "missing UNIQUE must fail instead of falling back to a blocking refresh");
  const unchanged = await count();
  assert.equal(unchanged.status, 200);
  assert.deepEqual(await unchanged.json(), { count: 2 });
  assert.equal(sql("SELECT refreshed_at = '2026-10-04T10:00:00Z'::timestamptz FROM public.matview_refresh_heartbeat WHERE matview_group='ranking'"), "t");
  t.diagnostic(`${version}; real PostgREST: before=AccessExclusiveLock/55P03/HTTP500; after=ExclusiveLock/no read error/HTTP200; old snapshot preserved, identical final values`);
});
