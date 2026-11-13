import test from "node:test";
import assert from "node:assert/strict";
import { QueryObserver } from "@tanstack/react-query";
import { createDataRuntime, viewerKey } from "./queryRuntime.ts";
import { buildGlobalRankData, globalRankQueryOptions, type GlobalRankData, type GlobalRankSources } from "./globalRankData.ts";

type Row = Record<string, unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

/** Sources whose rank read is controlled by the test, so in-flight timing is explicit. */
function controlledSources() {
  const pending: Array<ReturnType<typeof deferred<Row[]>>> = [];
  const sources: GlobalRankSources = {
    ranks: () => { const d = deferred<Row[]>(); pending.push(d); return d.promise; },
    weekly: async () => [],
    seasonStart: async () => [],
  };
  return { sources, pending };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("joins aggregates with both snapshots and hides inactive managers", () => {
  const data = buildGlobalRankData(
    [
      { team_id: "a", name: "Team A", division: 1, global_rank: "2", global_points: "100", active_recent: true },
      { team_id: "gone", name: "Gone", division: 2, global_rank: "1", active_recent: false },
      { team_id: "new", name: "New", division: 3, global_rank: "3", global_points: "40", active_recent: true, is_rookie: true },
    ],
    [{ team_id: "a", global_rank: 5 }],
    [{ team_id: "a", global_rank: 8 }],
  );
  assert.deepEqual(data.teams.map(row => row.team_id), ["a", "new"]);
  const [a, rookie] = data.teams;
  assert.equal(a.global_rank, 2);
  assert.equal(a.global_points, 100);
  assert.equal(a.banked_points, 0);
  assert.equal(a.movement, 3);
  assert.equal(a.places_gained, 6);
  // No snapshot row means "new" (null), never a made-up zero movement.
  assert.equal(rookie.movement, null);
  assert.equal(rookie.places_gained, null);
  assert.deepEqual(data.climbers.map(row => row.team_id), ["a"]);
  assert.deepEqual(data.bestNewManagers.map(row => row.team_id), ["new"]);
});

test("side panels keep the ten best in order and tolerate missing snapshot tables", () => {
  const ranks = Array.from({ length: 12 }, (_, i) => ({
    team_id: `t${i}`, name: `T${i}`, division: 1, global_rank: i + 1, global_points: 100 - i, active_recent: true, is_rookie: true,
  }));
  const start = ranks.map((row, i) => ({ team_id: row.team_id, global_rank: row.global_rank + i }));
  const data = buildGlobalRankData(ranks, null, start);
  assert.equal(data.climbers.length, 10);
  assert.deepEqual(data.climbers.slice(0, 2).map(row => row.places_gained), [11, 10]);
  assert.equal(data.bestNewManagers.length, 10);
  assert.equal(data.bestNewManagers[0].team_id, "t0");
  assert.ok(data.teams.every(row => row.movement === null));
  assert.deepEqual(buildGlobalRankData(null, null, null), { teams: [], climbers: [], bestNewManagers: [] });
});

test("the ranking key is per viewer, and stable while the team bootstrap resolves", async () => {
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  const before = viewerKey(runtime.scope(), "global-rank");
  runtime.setTeam("team-a");
  assert.deepEqual(viewerKey(runtime.scope(), "global-rank"), before, "team bootstrap must not move the key (no second read)");
  runtime.setViewer("viewer-b");
  const other = viewerKey(runtime.scope(), "global-rank");
  assert.notDeepEqual(other, before);
  assert.equal(other[2], "viewer-b");
  runtime.client.clear();
});

test("concurrent observers and a remount within the fresh window read once", async (t) => {
  // Freshness is judged from Date.now(); a frozen clock keeps the test deterministic.
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  const { sources, pending } = controlledSources();
  const options = globalRankQueryOptions(runtime, runtime.scope(), sources);
  const first = new QueryObserver(runtime.client, options);
  const second = new QueryObserver(runtime.client, options);
  const stopFirst = first.subscribe(() => {});
  const stopSecond = second.subscribe(() => {});
  await flush();
  assert.equal(pending.length, 1, "two observers share one in-flight read");
  pending[0].resolve([{ team_id: "a", name: "A", division: 1, global_rank: 1, active_recent: true }]);
  await flush();
  assert.equal((runtime.client.getQueryData(options.queryKey) as GlobalRankData).teams.length, 1);
  stopFirst(); stopSecond();
  // Coming back to the tab within the fresh window shows the cached answer without a new read.
  const again = new QueryObserver(runtime.client, { ...options, staleTime: 30_000 });
  const stopAgain = again.subscribe(() => {});
  await flush();
  assert.equal(pending.length, 1);
  assert.equal(again.getCurrentResult().data?.teams.length, 1);
  stopAgain();
  // After the fresh window a remount reads again (once), showing the cached answer meanwhile.
  t.mock.timers.tick(30_001);
  const later = new QueryObserver(runtime.client, { ...options, staleTime: 30_000 });
  const stopLater = later.subscribe(() => {});
  await flush();
  assert.equal(pending.length, 2);
  assert.equal(later.getCurrentResult().data?.teams.length, 1);
  stopLater();
  runtime.client.clear();
});

test("an answer that arrives after a team switch is discarded, never shown for the new team", async (t) => {
  // A discarded read still arms a long cleanup timer on the removed query; mock it so the test exits.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  runtime.setTeam("team-a");
  const oldScope = runtime.scope();
  const { sources, pending } = controlledSources();
  const oldOptions = globalRankQueryOptions(runtime, oldScope, sources);
  const read = runtime.client.fetchQuery(oldOptions).then(() => "published", (error: Error) => error.name);
  await flush();
  assert.equal(pending.length, 1);
  runtime.setTeam("team-b");
  pending[0].resolve([{ team_id: "a", name: "Old", division: 1, global_rank: 1, active_recent: true }]);
  assert.notEqual(await read, "published");
  assert.equal(runtime.client.getQueryData(oldOptions.queryKey), undefined);
  const newKey = globalRankQueryOptions(runtime, runtime.scope(), sources).queryKey;
  assert.notDeepEqual(newKey, oldOptions.queryKey);
  assert.equal(runtime.client.getQueryData(newKey), undefined);
  assert.equal(runtime.client.getQueryCache().getAll().length, 0);
  runtime.client.clear();
});

test("an answer that arrives after a viewer switch is discarded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  const { sources, pending } = controlledSources();
  const oldOptions = globalRankQueryOptions(runtime, runtime.scope(), sources);
  const read = runtime.client.fetchQuery(oldOptions).then(() => "published", (error: Error) => error.name);
  await flush();
  runtime.setViewer("viewer-b");
  pending[0].resolve([{ team_id: "a", name: "Private to A", division: 1, global_rank: 1, active_recent: true }]);
  assert.notEqual(await read, "published");
  assert.equal(runtime.client.getQueryCache().getAll().length, 0);
  runtime.client.clear();
});

test("a failed read stays an error without automatic retries, and a manual refetch recovers", async () => {
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  let calls = 0;
  let fail = true;
  const sources: GlobalRankSources = {
    ranks: async () => { calls += 1; if (fail) throw new Error("endpoint unavailable"); return [{ team_id: "a", name: "A", division: 1, global_rank: 1, active_recent: true }]; },
    weekly: async () => [],
    seasonStart: async () => [],
  };
  const observer = new QueryObserver(runtime.client, globalRankQueryOptions(runtime, runtime.scope(), sources));
  const stop = observer.subscribe(() => {});
  await flush(); await flush();
  assert.equal(calls, 1);
  assert.equal(observer.getCurrentResult().status, "error");
  assert.equal(observer.getCurrentResult().data, undefined);
  fail = false;
  await observer.refetch();
  assert.equal(calls, 2);
  assert.equal(observer.getCurrentResult().data?.teams.length, 1);
  stop();
  runtime.client.clear();
});
