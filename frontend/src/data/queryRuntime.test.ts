import { QueryObserver } from "@tanstack/react-query";
import test from "node:test";
import assert from "node:assert/strict";
import { createDataRuntime, privateKey } from "./queryRuntime.ts";

test("same viewer refresh keeps generation; viewer and team changes remove old data", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  runtime.setTeam("team-a");
  const first = runtime.scope();
  runtime.client.setQueryData(privateKey(first, "list"), ["private"]);
  runtime.setViewer("viewer-a");
  assert.equal(runtime.scope().generation, first.generation);
  runtime.setTeam("team-b");
  assert.equal(runtime.client.getQueryCache().getAll().length, 0);
  assert.throws(() => runtime.assertCurrent(first), { name: "AbortError" });
  runtime.setViewer(null);
  assert.equal(runtime.scope().viewerId, null);
  assert.equal(runtime.scope().teamId, null);
});

test("scope clear cancels a late read without republishing private data", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  const old = runtime.scope();
  let finish!: (value: string[]) => void;
  const pending = runtime.client.fetchQuery({
    queryKey: privateKey(old, "list"),
    queryFn: async ({ signal }) => {
      void signal;
      const result = await new Promise<string[]>(resolve => { finish = resolve; });
      runtime.assertCurrent(old);
      return result;
    },
  }).catch(error => error);
  runtime.setViewer("viewer-b");
  finish(["old-private"]);
  await pending;
  assert.equal(runtime.client.getQueryCache().getAll().length, 0);
});

test("concurrent observers deduplicate reads and no retry is added on failure", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  let calls = 0;
  let finish!: (value: string[]) => void;
  const options = { queryKey: privateKey(runtime.scope(), "list"), queryFn: () => {
    calls += 1;
    return new Promise<string[]>(resolve => { finish = resolve; });
  }};
  const first = runtime.client.fetchQuery(options);
  const second = runtime.client.fetchQuery(options);
  finish(["same"]);
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  let failures = 0;
  await assert.rejects(runtime.client.fetchQuery({ queryKey: ["failure"], queryFn: () => {
    failures += 1;
    throw new Error("no retry");
  }}));
  assert.equal(failures, 1);
  runtime.client.clear();
});

test("separate runtime factories isolate SSR requests", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const first = createDataRuntime();
  const second = createDataRuntime();
  first.client.setQueryData(["private"], ["a"]);
  assert.equal(second.client.getQueryData(["private"]), undefined);
  first.client.clear();
  second.client.clear();
});

test("a read that started before a write cannot publish after it", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  const scope = runtime.scope();
  const revision = await runtime.beforeRead(new AbortController().signal);
  const finish = runtime.beginWrite(scope);
  assert.throws(() => runtime.assertReadCurrent(scope, revision), { name: "AbortError" });
  let started = false;
  const next = runtime.beforeRead(new AbortController().signal).then(() => { started = true; });
  await Promise.resolve();
  assert.equal(started, false);
  finish();
  await next;
  assert.equal(started, true);
});

test("continuous realtime invalidations share an active read and perform one trailing resync", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a"); runtime.setTeam("team-a");
  const scope = runtime.scope();
  const key = privateKey(scope, "auctions");
  const signals: AbortSignal[] = [];
  const responses: Array<(value: string[]) => void> = [];
  const observer = new QueryObserver(runtime.client, {
    queryKey: key, staleTime: 0,
    queryFn: ({ signal }) => { signals.push(signal); return new Promise<string[]>(resolve => { responses.push(resolve); }); },
  });
  const unsubscribe = observer.subscribe(() => {});
  const first = runtime.resync(scope);
  runtime.resync(scope); runtime.resync(scope);
  assert.equal(responses.length, 1);
  assert.equal(signals[0].aborted, false);
  responses[0](["first"]);
  await first;
  assert.equal(responses.length, 2);
  assert.equal(signals[1].aborted, false);
  responses[1](["latest"]);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(runtime.client.getQueryData(key), ["latest"]);
  unsubscribe(); runtime.client.clear();
});
