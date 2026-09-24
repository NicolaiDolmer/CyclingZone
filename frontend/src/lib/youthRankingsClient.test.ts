import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyYouthStandingNames,
  createYouthRankingsClient,
  missingYouthNameIds,
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

// #5631: backend-PR #5665 sender KUN youth_season_standings' egne kolonner
// (backend/lib/youthStandings.js YOUTH_STANDINGS_COLUMNS) - intet holdnavn,
// intet pool_index. Samme form her, så testen fanger det prod ser.
const BACKEND_ROWS = [
  { season_id: "s1", squad: "u23", league_division_id: 902, team_id: "t-x", total_points: 12, wins: 0, podiums: 1, races: 2, rank_in_pool: 1, updated_at: "2026-09-20T18:00:00Z" },
  { season_id: "s1", squad: "u23", league_division_id: 901, team_id: "t-y", total_points: 20, wins: 1, podiums: 1, races: 2, rank_in_pool: 1, updated_at: "2026-09-20T18:00:00Z" },
];

test("missingYouthNameIds finder hold og grupper serveren ikke har navngivet", () => {
  const pools = normalizeYouthStandings({ data: [...BACKEND_ROWS, ROWS[0]] }) ?? [];
  const ids = missingYouthNameIds(pools);
  assert.deepEqual(ids.teamIds.sort(), ["t-x", "t-y"]);
  // Gruppe 21 har pool_index men ingen label, så den slås også op.
  assert.deepEqual(ids.poolIds.sort((a, b) => a - b), [21, 901, 902]);
});

test("applyYouthStandingNames fylder navn og gruppe ind og sorterer grupperne efter det opslåede pool_index", () => {
  const pools = normalizeYouthStandings({ data: BACKEND_ROWS }) ?? [];
  const named = applyYouthStandingNames(pools, {
    teams: { "t-x": "Hold X", "t-y": "Hold Y" },
    pools: { "901": { index: 1, label: null }, "902": { index: 0, label: null } },
  });
  assert.deepEqual(named.map((p) => [p.id, p.index]), [[902, 0], [901, 1]]);
  assert.equal(named[0].rows[0].teamName, "Hold X");
  assert.equal(groupLetter(named[1].index), "B");
  // Serverens egne værdier vinder over opslaget.
  const own = applyYouthStandingNames(normalizeYouthStandings({ data: [ROWS[0]] }) ?? [], {
    teams: { "t-b": "Forkert" }, pools: { "21": { index: 7, label: "Label" } },
  });
  assert.equal(own[0].rows[0].teamName, "Hold B");
  assert.equal(own[0].index, 1);
  assert.equal(own[0].label, "Label");
});

test("getYouthStandings slår navne op for et svar i backend-formen", async () => {
  const lookups: { teamIds: string[]; poolIds: number[] }[] = [];
  const client = createYouthRankingsClient({
    baseUrl: "",
    headers: async () => ({ Authorization: "Bearer x" }),
    request: async () => ({ ok: true, status: 200, data: { data: BACKEND_ROWS } }),
    lookupNames: async (ids) => {
      lookups.push(ids);
      return { teams: { "t-x": "Hold X", "t-y": "Hold Y" }, pools: { "901": { index: 0, label: null }, "902": { index: 1, label: null } } };
    },
  });
  const result = await client.getYouthStandings({ squad: "u23" });
  assert.equal(result.status, "ok");
  assert.equal(lookups.length, 1);
  const pools = result.status === "ok" ? result.pools : [];
  assert.deepEqual(pools.map((p) => groupLetter(p.index)), ["A", "B"]);
  assert.deepEqual(pools.map((p) => p.rows[0].teamName), ["Hold Y", "Hold X"]);
});

test("getYouthStandings: fejlet navneopslag giver stadig stillingen, og fejlen rapporteres", async () => {
  const reports: string[] = [];
  const client = createYouthRankingsClient({
    baseUrl: "",
    headers: async () => ({ Authorization: "Bearer x" }),
    request: async () => ({ ok: true, status: 200, data: { data: BACKEND_ROWS } }),
    lookupNames: async () => { throw new Error("boom"); },
    reportError: (_e, ctx) => { reports.push(ctx.path); },
  });
  const result = await client.getYouthStandings({ squad: "u23" });
  assert.equal(result.status, "ok");
  assert.equal(result.status === "ok" && result.pools[0].rows[0].teamName, null);
  assert.deepEqual(reports, ["/api/rankings/youth/standings#names"]);
});

test("getYouthStandings springer opslaget over når serveren allerede sender navne og grupper", async () => {
  let called = 0;
  const client = createYouthRankingsClient({
    baseUrl: "",
    headers: async () => ({ Authorization: "Bearer x" }),
    request: async () => ({ ok: true, status: 200, data: { data: [{ team_id: "t-a", team_name: "A", league_division_id: 20, pool_index: 0, pool_label: "A", races: 1 }] } }),
    lookupNames: async () => { called += 1; return { teams: {}, pools: {} }; },
  });
  assert.equal((await client.getYouthStandings({ squad: "u23" })).status, "ok");
  assert.equal(called, 0);
});
