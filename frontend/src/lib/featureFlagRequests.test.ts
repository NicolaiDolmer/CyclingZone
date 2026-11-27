import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAnonymousFlags } from "./featureStage.ts";

test.beforeEach(() => invalidatePlayerReads());

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
import { invalidatePlayerReads, readAcademyMenuVisibility, readPlayerFeatureFlags } from "./featureFlagRequests.ts";

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

test("role invalidation prevents an old in-flight flag response from filling the cache", async (t) => {
  const old = Promise.withResolvers<Response>();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return requests === 1 ? old.promise : Response.json({ flags: { enabled: false } });
  });
  const headers = { Authorization: "Bearer viewer-a" };
  const beforeRoleChange = readPlayerFeatureFlags(headers);
  invalidatePlayerReads();
  assert.deepEqual(await readPlayerFeatureFlags(headers), { enabled: false });
  old.resolve(Response.json({ flags: { enabled: true } }));
  await beforeRoleChange;
  assert.deepEqual(await readPlayerFeatureFlags(headers), { enabled: false });
  assert.equal(requests, 2);
});

test("access-token refresh keeps a successful read in the same auth session", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return Response.json({ flags: { enabled: true } });
  });
  const auth = (sessionId: string, expiry: number) => {
    const claims = Buffer.from(JSON.stringify({ iss: "fixture", sub: "viewer-a", session_id: sessionId, exp: expiry })).toString("base64url");
    return { Authorization: `Bearer fixture.${claims}.signature` };
  };
  await readPlayerFeatureFlags(auth("session-a", 100));
  await readPlayerFeatureFlags(auth("session-a", 200));
  assert.equal(requests, 1);
  await readPlayerFeatureFlags(auth("session-b", 300));
  assert.equal(requests, 2);
});

test("academy visibility accepts true and false from an exact HTTP 200", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ visible: ++calls === 1 }));
  assert.equal(await readAcademyMenuVisibility({ Authorization: "Bearer academy-yes" }), true);
  assert.equal(await readAcademyMenuVisibility({ Authorization: "Bearer academy-no" }), false);
  assert.equal(calls, 2);
});

for (const status of [401, 404, 409, 500, 503, 202]) {
  test(`academy visibility treats HTTP ${status} as unknown and retries`, async (t) => {
    let calls = 0;
    const paths: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => {
      calls += 1;
      paths.push(url);
      return Response.json({ visible: calls !== 1, enabled: true }, { status: calls === 1 ? status : 200 });
    });
    const headers = { Authorization: "Bearer academy" };
    assert.equal(await readAcademyMenuVisibility(headers), null);
    assert.equal(await readAcademyMenuVisibility(headers), true);
    assert.equal(calls, 2);
    assert.ok(paths.every(url => url.endsWith("/api/academy/visibility")));
  });
}

test("academy visibility preserves unknown network and malformed-200 results and retries", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network disconnected");
    return Response.json(calls === 2 ? { visible: "false" } : { visible: false });
  });
  const headers = { Authorization: "Bearer academy" };
  assert.equal(await readAcademyMenuVisibility(headers), null);
  assert.equal(await readAcademyMenuVisibility(headers), null);
  assert.equal(await readAcademyMenuVisibility(headers), false);
  assert.equal(calls, 3);
});
