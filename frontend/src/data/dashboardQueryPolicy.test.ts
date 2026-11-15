import test from "node:test";
import assert from "node:assert/strict";
import { QueryObserver } from "@tanstack/react-query";
import { createDataRuntime, privateKey, viewerKey, type DataScope } from "./queryRuntime.ts";
import { LIVE_RESOURCES, isScopeResource, cancelledWithoutData, settledList } from "./dashboardQueryPolicy.ts";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function scopedRuntime() {
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  runtime.setTeam("team-a");
  return runtime;
}

test("the live channel refreshes exactly the legacy loadAll resources of the current scope", async () => {
  const runtime = scopedRuntime();
  const scope = runtime.scope();
  const other: DataScope = { ...scope, viewerId: "viewer-b" };
  const keys = {
    core: privateKey(scope, "dashboard:core", "season-1"),
    team: viewerKey(scope, "team"),
    offers: privateKey(scope, "transfer-offers"),
    listings: privateKey(scope, "transfer-listings"),
    recent: viewerKey(scope, "dashboard:recent-results"),
    strip: privateKey(scope, "dashboard:today-stages"),
    otherViewer: privateKey(other, "dashboard:core", "season-1"),
  };
  for (const key of Object.values(keys)) runtime.client.setQueryData(key, { known: true });
  await runtime.client.invalidateQueries({ predicate: (query) => isScopeResource(query, scope, LIVE_RESOURCES) }, { cancelRefetch: false });
  const invalidated = (key: readonly unknown[]) => runtime.client.getQueryState(key)?.isInvalidated;
  assert.equal(invalidated(keys.core), true);
  assert.equal(invalidated(keys.team), true, "the team row carries the header balance");
  assert.equal(invalidated(keys.offers), true, "the shared offers key is refreshed for both pages");
  assert.equal(invalidated(keys.listings), false, "market listings keep their own freshness");
  assert.equal(invalidated(keys.recent), false, "push modules are not part of the live set");
  assert.equal(invalidated(keys.strip), false, "today's strip has its own minute refresh");
  assert.equal(invalidated(keys.otherViewer), false, "another viewer's entries are never touched");
  runtime.client.clear();
});

test("a failed refresh keeps the known core data and does not raise a page error", async () => {
  const runtime = scopedRuntime();
  const scope = runtime.scope();
  let calls = 0;
  const observer = new QueryObserver(runtime.client, {
    queryKey: privateKey(scope, "dashboard:core", null),
    queryFn: async () => { calls += 1; if (calls > 1) throw new Error("server down"); return { riders: [1, 2] }; },
  });
  const unsubscribe = observer.subscribe(() => {});
  await flush();
  assert.deepEqual(observer.getCurrentResult().data, { riders: [1, 2] });
  await observer.refetch();
  const result = observer.getCurrentResult();
  assert.equal(result.isError, true);
  assert.deepEqual(result.data, { riders: [1, 2] }, "known rows stay visible");
  assert.equal(calls, 2, "no automatic retry");
  unsubscribe();
  runtime.client.clear();
});

test("after a write, only the scope's reads cancelled without data are refetched", async () => {
  const runtime = scopedRuntime();
  const scope = runtime.scope();
  const reads: string[] = [];
  const pendingForever = () => new Promise<never>(() => {});
  const known = new QueryObserver(runtime.client, { queryKey: viewerKey(scope, "dashboard:signup"), queryFn: async () => { reads.push("signup"); return { signed_up: false }; } });
  const stopKnown = known.subscribe(() => {});
  await flush();
  let first = true;
  const cold = new QueryObserver(runtime.client, {
    queryKey: privateKey(scope, "dashboard:auctions"),
    queryFn: async () => { reads.push("auctions"); if (first) { first = false; return pendingForever(); } return []; },
  });
  const stopCold = cold.subscribe(() => {});
  await flush();
  const finish = runtime.beginWrite(scope);
  await flush();
  finish();
  await runtime.client.invalidateQueries({ predicate: (query) => cancelledWithoutData(query, scope) });
  await flush();
  assert.deepEqual(reads, ["signup", "auctions", "auctions"], "the cancelled cold read runs again, the known one does not");
  assert.deepEqual(cold.getCurrentResult().data, []);
  stopKnown();
  stopCold();
  runtime.client.clear();
});

test("list modules distinguish unknown, confirmed empty and failed-with-nothing-known", () => {
  const empty: string[] = [];
  assert.equal(settledList({ data: undefined, isError: false }, empty), null, "skeleton while unknown");
  assert.equal(settledList({ data: undefined, isError: true }, empty), empty, "empty state after a failure with nothing known");
  assert.deepEqual(settledList({ data: ["a"], isError: true }, empty), ["a"], "known rows survive a failed refresh");
});
