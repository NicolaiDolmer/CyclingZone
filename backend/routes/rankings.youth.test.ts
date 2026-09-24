// #5647 (Y7): GET /rankings/youth/standings og /rankings/youth/riders.
// Kontrakt: requireAuth foer alt, bag youth_squad_pages (409 naar slukket, ingen
// laesning af ungdomsdata), fast projektion/filtre/sortering, { data } som seniorruterne,
// default = aktiv saeson, og zod afviser alt andet end u23/junior og heltals-pool.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Request } from "express";
import { createClient } from "@supabase/supabase-js";
import { createRankingsRouter } from "./rankings.ts";

const SEASON = "00000000-0000-0000-0000-000000000004";
const OTHER_SEASON = "00000000-0000-0000-0000-000000000003";
const USER = "50000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;

interface Options {
  flag?: unknown;
  betaTester?: boolean;
  activeSeason?: string | null;
  standings?: Row[];
  riders?: Row[];
  dbError?: boolean;
  injectBeta?: boolean;
}

async function fixture(t: test.TestContext, opts: Options = {}) {
  const flag = "flag" in opts ? opts.flag : "on";
  const { betaTester = false, activeSeason = SEASON, standings = [], riders = [], dbError = false, injectBeta } = opts;
  const requests: URL[] = [];
  const reported: unknown[] = [];
  const reply = (init: RequestInit | undefined, rows: Row[]) => {
    const wantsObject = (new Headers(init?.headers).get("Accept") || "").includes("vnd.pgrst.object");
    const body = wantsObject ? (rows[0] ?? null) : rows;
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
    });
  };
  const project = (url: URL, rows: Row[]) => {
    const columns = (url.searchParams.get("select") || "").split(",");
    let selected = rows;
    for (const key of ["season_id", "squad", "league_division_id"]) {
      const filter = url.searchParams.get(key);
      if (filter) selected = selected.filter(row => String(row[key]) === filter.slice(3));
    }
    return selected.map(row => Object.fromEntries(columns.filter(k => k in row).map(k => [k, row[k]])));
  };
  const supabase = createClient("https://database.example", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      const table = url.pathname.replace("/rest/v1/", "");
      if (table === "app_config") return reply(init, flag === undefined ? [] : [{ value: flag }]);
      if (table === "users") return reply(init, [{ role: "manager", is_beta_tester: betaTester }]);
      if (dbError) return new Response(JSON.stringify({ message: "private database detail", code: "42501" }), { status: 403 });
      if (table === "seasons") return reply(init, activeSeason ? [{ id: activeSeason }] : []);
      if (table === "youth_season_standings") return reply(init, project(url, standings));
      if (table === "youth_rider_rankings_mv") return reply(init, project(url, riders));
      throw new Error(`unexpected table ${table}`);
    } },
  });
  const app = express();
  app.use("/api/rankings", createRankingsRouter({
    supabase,
    reportError: error => reported.push(error),
    viewerClient: () => { throw new Error("viewerClient not used by youth routes"); },
    ...(injectBeta === undefined ? {} : { isViewerBetaTester: async (_req: Request) => injectBeta }),
    requireAuth: (req, res, next) => {
      if (req.headers.authorization !== "Bearer valid") { res.status(401).json({ error: "Unauthorized" }); return; }
      Object.assign(req, { user: { id: USER } });
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
  const dataReads = () => requests.filter(url => /youth_|seasons/.test(url.pathname));
  return { call, requests, reported, dataReads };
}

const paths = ["/youth/standings?squad=u23", "/youth/riders?squad=junior"];

for (const path of paths) {
  test(`${path}: auth afviser foer enhver databaselaesning`, async t => {
    const f = await fixture(t);
    assert.equal((await f.call(path, "")).status, 401);
    assert.equal(f.requests.length, 0);
  });

  test(`${path}: flag slukket (eller manglende) giver 409 uden laesning af ungdomsdata`, async t => {
    for (const flag of ["off", undefined, false]) {
      const f = await fixture(t, { flag });
      const response = await f.call(path);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "youth_squad_pages_disabled" });
      assert.equal(f.dataReads().length, 0);
    }
  });

  test(`${path}: flag i beta - kun beta-testere kommer igennem`, async t => {
    assert.equal((await (await fixture(t, { flag: "beta", betaTester: false })).call(path)).status, 409);
    assert.equal((await (await fixture(t, { flag: "beta", betaTester: true })).call(path)).status, 200);
    // Injiceret beta-opslag (api.js' isViewerBetaTester) vinder over det lokale.
    assert.equal((await (await fixture(t, { flag: "beta", betaTester: false, injectBeta: true })).call(path)).status, 200);
  });

  test(`${path}: tom stilling er et gyldigt svar`, async t => {
    const response = await (await fixture(t)).call(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: [] });
  });

  test(`${path}: ingen aktiv saeson giver tom liste`, async t => {
    const f = await fixture(t, { activeSeason: null });
    assert.deepEqual(await (await f.call(path)).json(), { data: [] });
    assert.equal(f.requests.some(url => url.pathname.includes("youth_")), false);
  });

  test(`${path}: databasefejl giver 500 uden detaljer og rapporteres`, async t => {
    const f = await fixture(t, { dbError: true });
    const response = await f.call(path);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Unable to load rankings" });
    assert.equal(f.reported.length, 1);
  });
}

test("youth-ruterne afviser senior, ukendte trupper, ugyldig pool og ukendte parametre", async t => {
  const f = await fixture(t);
  for (const path of [
    "/youth/standings", "/youth/standings?squad=senior", "/youth/standings?squad=u19",
    "/youth/standings?squad=u23&pool=0", "/youth/standings?squad=u23&pool=abc", "/youth/standings?squad=u23&pool=-1",
    "/youth/standings?squad=u23&order=points", "/youth/riders?squad=u23&pool=1", "/youth/riders?squad=u23&season_id=nope",
  ]) {
    assert.equal((await f.call(path)).status, 400, path);
  }
  assert.equal(f.requests.length, 0);
});

test("youth/standings: aktiv saeson, trup- og gruppefilter, fast projektion og sortering", async t => {
  const standings = [
    { season_id: SEASON, squad: "u23", league_division_id: 7, team_id: "a", total_points: 84, wins: 2, podiums: 3, races: 1, rank_in_pool: 1, updated_at: "x", secret: "hidden" },
    { season_id: SEASON, squad: "u23", league_division_id: 8, team_id: "c", total_points: 40, wins: 1, podiums: 1, races: 1, rank_in_pool: 1, updated_at: "x" },
    { season_id: SEASON, squad: "junior", league_division_id: 9, team_id: "b", total_points: 777, wins: 1, podiums: 1, races: 1, rank_in_pool: 1, updated_at: "x" },
    { season_id: OTHER_SEASON, squad: "u23", league_division_id: 7, team_id: "old", total_points: 1, wins: 0, podiums: 0, races: 1, rank_in_pool: 1, updated_at: "x" },
  ];
  const f = await fixture(t, { standings });
  const { data } = await (await f.call("/youth/standings?squad=u23&pool=7")).json();
  assert.deepEqual(data, [{ season_id: SEASON, squad: "u23", league_division_id: 7, team_id: "a", total_points: 84, wins: 2, podiums: 3, races: 1, rank_in_pool: 1, updated_at: "x" }]);
  const read = f.requests.find(url => url.pathname.endsWith("/youth_season_standings"))!;
  assert.equal(read.searchParams.get("season_id"), `eq.${SEASON}`);
  assert.equal(read.searchParams.get("squad"), "eq.u23");
  assert.equal(read.searchParams.get("league_division_id"), "eq.7");
  assert.equal(read.searchParams.get("order"), "league_division_id.asc.nullslast,rank_in_pool.asc.nullslast,team_id.asc");
  const seasons = f.requests.find(url => url.pathname.endsWith("/seasons"))!;
  assert.equal(seasons.searchParams.get("status"), "eq.active");

  const all = await (await f.call("/youth/standings?squad=u23")).json();
  assert.deepEqual(all.data.map((r: Row) => r.team_id), ["a", "c"], "uden pool: alle U23-grupper, ingen juniorer, ingen gammel saeson");
});

test("youth/standings: eksplicit season_id springer opslaget af aktiv saeson over", async t => {
  const f = await fixture(t, { standings: [{ season_id: OTHER_SEASON, squad: "junior", team_id: "old" }] });
  const { data } = await (await f.call(`/youth/standings?squad=junior&season_id=${OTHER_SEASON}`)).json();
  assert.deepEqual(data.map((r: Row) => r.team_id), ["old"]);
  assert.equal(f.requests.some(url => url.pathname.endsWith("/seasons")), false);
});

test("youth/riders: seniorens kolonner + squad, filtreret paa trup, sorteret paa point", async t => {
  const riders = [
    { season_id: SEASON, squad: "u23", rider_id: "r1", points: 84, prize_earned: 0, stage_wins: 1, gc_wins: 1, secret: "hidden" },
    { season_id: SEASON, squad: "junior", rider_id: "r2", points: 777 },
  ];
  const f = await fixture(t, { riders });
  const { data } = await (await f.call("/youth/riders?squad=u23")).json();
  assert.deepEqual(data, [{ season_id: SEASON, rider_id: "r1", points: 84, prize_earned: 0, stage_wins: 1, gc_wins: 1, squad: "u23" }]);
  const read = f.requests.find(url => url.pathname.endsWith("/youth_rider_rankings_mv"))!;
  assert.equal(read.searchParams.get("select"),
    "season_id,rider_id,points,prize_earned,stage_wins,gc_wins,classic_wins,pts_wins,mtn_wins,young_wins,yellow_days,green_days,polka_days,white_days,top3,top10,squad");
  assert.equal(read.searchParams.get("squad"), "eq.u23");
  assert.equal(read.searchParams.get("order"), "points.desc,rider_id.asc");
});
