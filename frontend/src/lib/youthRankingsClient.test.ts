import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createYouthRankingsClient,
  groupLetter,
  hasYouthResults,
  normalizeYouthStandings,
  poolForTeam,
  type YouthRequestResult,
} from "./youthRankingsClient.ts";

const ROWS = [
  { team_id: "t-b", team_name: "Hold B", league_division_id: 21, pool_index: 1, rank_in_pool: 2, total_points: 10, wins: 0, podiums: 1, races: 2 },
  { team_id: "t-a", team_name: "Hold A", league_division_id: 20, pool_index: 0, rank_in_pool: 1, total_points: 30, wins: 1, podiums: 2, races: 2 },
  { team_id: "t-c", teams: { name: "Hold C" }, league_division_id: 21, pool_index: 1, rank_in_pool: 1, total_points: "25", wins: 1, podiums: 1, races: 2 },
  { team_id: "t-d", team_name: "Hold D", league_division_id: null, rank_in_pool: null, total_points: 4, races: 1 },
];

test("normalizeYouthStandings grupperer pr. pulje, sorterer puljer efter pool_index og rækker efter serverens placering", () => {
  const pools = normalizeYouthStandings({ data: ROWS });
  assert.ok(pools);
  assert.deepEqual(pools.map((p) => p.id), [20, 21, null]);
  assert.deepEqual(pools[1].rows.map((r) => r.teamId), ["t-c", "t-b"]);
  // Holdnavn fra nested teams-embed og point som streng accepteres.
  assert.equal(pools[1].rows[0].teamName, "Hold C");
  assert.equal(pools[1].rows[0].points, 25);
});

test("normalizeYouthStandings afviser et svar uden data-array (kontraktfejl, ikke tom stilling)", () => {
  assert.equal(normalizeYouthStandings({ rows: [] }), null);
  assert.equal(normalizeYouthStandings(null), null);
  assert.deepEqual(normalizeYouthStandings({ data: [] }), []);
  // Rækker uden team_id springes over i stedet for at vælte siden.
  assert.deepEqual(normalizeYouthStandings({ data: [{ total_points: 3 }] }), []);
});

test("poolForTeam finder holdets egen gruppe; hold uden gruppe får ingen", () => {
  const pools = normalizeYouthStandings({ data: ROWS }) ?? [];
  assert.equal(poolForTeam(pools, "t-b")?.id, 21);
  assert.equal(poolForTeam(pools, "t-d"), null);
  assert.equal(poolForTeam(pools, null), null);
});

test("hasYouthResults er falsk før første ungdomsløb", () => {
  const before = normalizeYouthStandings({ data: [{ team_id: "t-a", league_division_id: 20, total_points: 0, races: 0 }] }) ?? [];
  assert.equal(hasYouthResults(before), false);
  assert.equal(hasYouthResults(normalizeYouthStandings({ data: ROWS }) ?? []), true);
});

test("groupLetter oversætter pool_index til gruppe-bogstav", () => {
  assert.equal(groupLetter(0), "A");
  assert.equal(groupLetter(8), "I");
  assert.equal(groupLetter(null), null);
  assert.equal(groupLetter(-1), null);
});

function clientWith(res: YouthRequestResult, calls: string[] = [], reports: number[] = []) {
  return createYouthRankingsClient({
    baseUrl: "https://api.test",
    headers: async () => ({ Authorization: "Bearer x" }),
    request: async (url) => { calls.push(url); return res; },
    reportError: (_e, ctx) => { reports.push(ctx.status ?? 0); },
  });
}

test("getYouthStandings sender squad og pool i query og returnerer puljerne", async () => {
  const calls: string[] = [];
  const client = clientWith({ ok: true, status: 200, data: { data: ROWS } }, calls);
  const result = await client.getYouthStandings({ squad: "u23", pool: 21 });
  assert.equal(calls[0], "https://api.test/api/rankings/youth/standings?squad=u23&pool=21");
  assert.equal(result.status, "ok");
  assert.equal(result.status === "ok" && result.pools.length, 3);
});

test("getYouthStandings: 409 = slukket, 404 = ikke deployet, 500 = fejl med telemetri", async () => {
  assert.equal((await clientWith({ ok: false, status: 409, data: null }).getYouthStandings({ squad: "junior" })).status, "disabled");
  assert.equal((await clientWith({ ok: false, status: 404, data: null }).getYouthStandings({ squad: "junior" })).status, "unavailable");
  const reports: number[] = [];
  const failed = await clientWith({ ok: false, status: 500, data: null }, [], reports).getYouthStandings({ squad: "junior" });
  assert.equal(failed.status, "error");
  assert.deepEqual(reports, [500]);
});

test("getYouthStandings uden session svarer fejl uden netværkskald", async () => {
  const calls: string[] = [];
  const client = createYouthRankingsClient({
    baseUrl: "",
    headers: async () => null,
    request: async (url) => { calls.push(url); return { ok: true, status: 200, data: { data: [] } }; },
  });
  assert.equal((await client.getYouthStandings({ squad: "u23" })).status, "error");
  assert.equal(calls.length, 0);
});
