import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createRankingsRouter } from "./rankings.ts";

const SEASON = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000001";
const RIDER = "30000000-0000-4000-8000-000000000001";
const RACE = "40000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;

async function fixture(t: test.TestContext, rows: Row[] = [], dbError = false, displayRows: Row[] = []) {
  const requests: { url: URL; method: string; body: Record<string, unknown> | null }[] = [];
  const reported: unknown[] = [];
  const supabase = createClient("https://database.example", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method || "GET";
      requests.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      if (dbError) return new Response(JSON.stringify({ message: "private database detail", code: "42501" }), { status: 403 });
      if (url.pathname.endsWith("/rpc/get_season_honours")) return Response.json({ points: rows, wins: [] });
      let selected = rows.filter(row => ["season_id", "team_id"].every(key => {
        const filter = url.searchParams.get(key);
        return !filter || row[key] === filter.slice(3);
      }));
      for (const key of ["rider_id", "race_id"]) {
        const filter = url.searchParams.get(key);
        if (filter) selected = selected.filter(row => filter.slice(4, -1).split(",").includes(String(row[key])));
      }
      const count = selected.length;
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 1000);
      const columns = url.searchParams.get("select")!.split(",");
      const page = selected.slice(offset, offset + limit).map(row => Object.fromEntries(columns.filter(k => k in row).map(k => [k, row[k]])));
      return new Response(method === "HEAD" ? null : JSON.stringify(page), {
        headers: { "content-type": "application/json", "content-range": `0-${Math.max(0, count - 1)}/${count}` },
      });
    } },
  });
  const app = express();
  app.use("/api/rankings", createRankingsRouter({ supabase, reportError: error => reported.push(error),
    viewerClient: authorization => createClient("https://viewer.example", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization }, fetch: async (input, init) => {
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer valid");
        const url = new URL(String(input));
        assert.equal(url.pathname, "/rest/v1/riders");
        assert.equal(url.searchParams.get("order"), "lastname.asc,id.asc");
        return Response.json(displayRows);
      } },
    }),
    requireAuth: (req, res, next) => {
      if (req.headers.authorization === "Bearer denied") { res.status(403).json({ error: "Forbidden" }); return; }
      if (req.headers.authorization !== "Bearer valid") { res.status(401).json({ error: "Unauthorized" }); return; }
      next();
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (path: string, token = "valid") => fetch(`http://127.0.0.1:${address.port}/api/rankings${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { call, requests, reported };
}

const paths = ["/global", `/riders?season_id=${SEASON}`, `/standings?season_id=${SEASON}`, `/race-points?season_id=${SEASON}`, `/race-count?team_id=${TEAM}`];
for (const path of paths) {
  test(`${path}: auth rejects before database access`, async t => {
    const f = await fixture(t);
    assert.equal((await f.call(path, "")).status, 401);
    assert.equal((await f.call(path, "denied")).status, 403);
    assert.equal(f.requests.length, 0);
  });
  test(`${path}: empty data is a successful response`, async t => {
    const f = await fixture(t);
    const response = await f.call(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), path.startsWith("/race-count") ? { count: 0 } : { data: [] });
  });
}

test("global list preserves null ranks, excludes unselected fields and paginates beyond 1000", async t => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ team_id: String(i), global_rank: i === 1000 ? null : i + 1, secret: "hidden" }));
  const f = await fixture(t, rows);
  const response = await f.call("/global");
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.length, 1001);
  assert.deepEqual(data.at(-1), { team_id: "1000", global_rank: null });
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].url.searchParams.get("order"), "global_rank.asc.nullslast,team_id.asc");
});

test("global team filter returns only requested team", async t => {
  const f = await fixture(t, [{ team_id: TEAM, global_rank: 2 }, { team_id: "other", global_rank: 1 }]);
  assert.deepEqual(await (await f.call(`/global?team_id=${TEAM}`)).json(), { data: [{ team_id: TEAM, global_rank: 2 }] });
});

test("rider scope and top five use fixed projection and limit", async t => {
  const f = await fixture(t, [{ season_id: SEASON, rider_id: RIDER, points: "80" }]);
  assert.equal((await f.call(`/riders?season_id=${SEASON}&rider_ids=${RIDER}`)).status, 200);
  assert.equal(f.requests[0].url.searchParams.get("rider_id"), `in.(${RIDER})`);
  await f.call(`/riders?season_id=${SEASON}&top=5`);
  assert.equal(f.requests[1].url.searchParams.get("limit"), "5");
  assert.equal(f.requests[1].url.searchParams.get("order"), "points.desc,rider_id.asc");
});

test("race points filter race IDs and count spans seasons without fetching payload", async t => {
  const f = await fixture(t, [{ team_id: TEAM, race_id: RACE, race_points: 12, season_id: SEASON }, { team_id: TEAM, race_id: "other", race_points: 9, season_id: "other" }]);
  const points = await (await f.call(`/race-points?race_ids=${RACE}`)).json();
  assert.deepEqual(points, { data: [{ team_id: TEAM, race_id: RACE, race_points: 12 }] });
  assert.deepEqual(await (await f.call(`/race-count?team_id=${TEAM}`)).json(), { count: 2 });
  assert.equal(f.requests.at(-1)?.method, "HEAD");
  assert.equal(f.requests.at(-1)?.url.searchParams.has("season_id"), false);
});

test("invalid, ambiguous, oversized or arbitrary query filters are rejected", async t => {
  const f = await fixture(t);
  for (const path of ["/riders", "/standings?season_id=no", "/race-points", "/global?select=*", "/global?team_id=no", `/riders?season_id=${SEASON}&top=6`, `/riders?season_id=${SEASON}&top=5&rider_ids=${RIDER}`, `/race-points?race_ids=${Array(101).fill(RACE).join(",")}`, `/race-count?team_id=${TEAM}&season_id=${SEASON}`]) {
    assert.equal((await f.call(path)).status, 400, path);
  }
  assert.equal(f.requests.length, 0);
});

test("database failures are reported without leaking database details", async t => {
  const f = await fixture(t, [], true);
  const response = await f.call("/global");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to load rankings" });
  assert.equal(f.reported.length, 1);
});

test("honours filters through viewer RLS before either top-five selection", async t => {
  const visible = Array.from({ length: 6 }, (_, i) => ({ id: `visible-${i}`, firstname: "Ada", lastname: String(i), nationality_code: "DEN", team_id: TEAM, team: { name: "Team", is_ai: false } }));
  const stats = [{ rider_id: "hidden-intake", points: 999, stage_wins: 99, season_id: SEASON },
    ...visible.map((rider, i) => ({ rider_id: rider.id, points: 80 - i, stage_wins: 6 - i, season_id: SEASON }))];
  const f = await fixture(t, stats, false, visible);
  assert.equal((await f.call(`/honours?season_id=${SEASON}`, "")).status, 401);
  assert.equal((await f.call(`/honours?season_id=${SEASON}`, "denied")).status, 403);
  assert.equal(f.requests.length, 0);
  const response = await f.call(`/honours?season_id=${SEASON}`);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  for (const list of [data.points, data.wins]) {
    assert.equal(list.length, 5);
    assert.deepEqual(list.map((row: Row) => row.rider_id), visible.slice(0, 5).map(row => row.id));
    assert.equal(list[0].team_name, "Team");
    assert.equal(list[0].firstname, "Ada");
  }
  assert.equal(f.requests[0].url.pathname, "/rest/v1/rider_rankings_mv");
  assert.equal(f.requests[0].url.searchParams.get("season_id"), `eq.${SEASON}`);
});
