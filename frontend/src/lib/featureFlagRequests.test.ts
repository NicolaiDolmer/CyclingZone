import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAnonymousFlags } from "./featureStage.ts";

test("simultaneous anonymous flag consumers share one network request", async (t) => {
  let requests = 0;
  const { promise: waitForResponse, resolve: respond } = Promise.withResolvers<void>();
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    await waitForResponse;
    return Response.json({ flags: { enabled: true } });
  });

  const firstRead = loadAnonymousFlags();
  const secondRead = loadAnonymousFlags();
  respond();

  assert.deepEqual(await Promise.all([firstRead, secondRead]), [
    { enabled: true },
    { enabled: true },
  ]);
  assert.equal(requests, 1);
});
import { readPlayerFeatureFlags } from "./featureFlagRequests.ts";

test("viewer tokens, refreshes and anonymous calls stay isolated", async (t) => {
  const requests: string[] = [];
  const { promise: waitForResponse, resolve: respond } = Promise.withResolvers<void>();
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    requests.push(authorization);
    await waitForResponse;
    return Response.json({ flags: { enabled: authorization === "Bearer viewer-a" } });
  });

  const results = [
    readPlayerFeatureFlags({ Authorization: "Bearer viewer-a" }),
    readPlayerFeatureFlags({ Authorization: "Bearer viewer-a" }),
    readPlayerFeatureFlags({ Authorization: "Bearer viewer-b" }),
    readPlayerFeatureFlags({ Authorization: "Bearer refreshed-a" }),
    loadAnonymousFlags(),
    loadAnonymousFlags(),
  ];
  respond();

  assert.deepEqual(await Promise.all(results), [true, true, false, false, false, false]
    .map((enabled) => ({ enabled })));
  assert.deepEqual(requests, ["Bearer viewer-a", "Bearer viewer-b", "Bearer refreshed-a", ""]);
});

test("later calls are fresh and degraded server responses stay unknown", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return Response.json({ flags: { enabled: true }, degraded: requests === 1 });
  });

  assert.equal(await loadAnonymousFlags(), null);
  assert.deepEqual(await loadAnonymousFlags(), { enabled: true });
  assert.equal(requests, 2);
});
