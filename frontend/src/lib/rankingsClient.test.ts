import test from "node:test";
import assert from "node:assert/strict";
import { createRankingsClient } from "./rankingsClient.ts";

test("signed-out requests fail without network access", async () => {
  let calls = 0;
  const client = createRankingsClient({ baseUrl: "https://api.example", headers: async () => null,
    fetcher: async () => { calls++; throw new Error("unexpected network"); } });
  const result = await client.getGlobalRank("team");
  assert.equal(calls, 0);
  assert.equal(result.data, null);
  assert.match(result.error!.message, /signed in/i);
});

test("transport preserves single/list/count shapes and encodes filters", async () => {
  const calls: URL[] = [];
  const client = createRankingsClient({ baseUrl: "https://api.example", headers: async () => ({ Authorization: "Bearer test" }),
    fetcher: async (input, init) => {
      const url = new URL(String(input)); calls.push(url);
      assert.deepEqual(init?.headers, { Authorization: "Bearer test" });
      return Response.json(url.pathname.endsWith("race-count") ? { count: 12 } : { data: [{ team_id: "team", global_rank: 2 }] });
    } });
  assert.deepEqual((await client.getGlobalRank("team")).data, { team_id: "team", global_rank: 2 });
  assert.equal((await client.fetchGlobalRanks()).length, 1);
  assert.equal((await client.getRaceCount("team")).count, 12);
  await client.getRiderRankings("season", ["r1", "r2"]);
  assert.equal(calls.at(-1)!.searchParams.get("rider_ids"), "r1,r2");
  await client.getTopRiderRankings("season");
  assert.equal(calls.at(-1)!.searchParams.get("top"), "5");
  await client.getRaceDayPoints(["race-1", "race-2"]);
  assert.equal(calls.at(-1)!.searchParams.get("race_ids"), "race-1,race-2");
});

test("empty lists remain empty, absent global rank is null", async () => {
  const client = createRankingsClient({ baseUrl: "", headers: async () => ({}), fetcher: async () => Response.json({ data: [] }) });
  assert.deepEqual(await client.fetchRiderRankings("empty"), []);
  assert.equal((await client.getGlobalRank("missing")).data, null);
});

test("network, HTTP and malformed-success failures reach existing error handling", async () => {
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => Response.json({ error: "Denied" }, { status: 403 }), async () => Response.json({ ok: true })]) {
    const client = createRankingsClient({ baseUrl: "", headers: async () => ({}), fetcher });
    assert.ok((await client.getRiderRankings("season")).error);
    await assert.rejects(client.fetchGlobalRanks());
    assert.equal((await client.getRaceCount("team")).count, null);
  }
});

test("honours preserves two lists and treats an undeployed endpoint separately from a server failure", async () => {
  const clientFor = (status: number, body: unknown) => createRankingsClient({ baseUrl: "", headers: async () => ({}), fetcher: async () => Response.json(body, { status }) });
  const honours = { points: [{ rider_id: "r", points: 12 }], wins: [] };
  assert.deepEqual((await clientFor(200, { data: honours }).getSeasonHonours("s")).data, honours);
  const missing = await clientFor(404, {}).getSeasonHonours("s");
  assert.equal((missing.error as Error & { code?: string }).code, "PGRST202");
  const failed = await clientFor(500, {}).getSeasonHonours("s");
  assert.ok(failed.error);
  assert.equal((failed.error as Error & { code?: string }).code, undefined);
});

// #5186 - a 4xx/5xx from our own backend is a contract failure, not an empty
// result: reportError must fire before the fallback to { data: null, error }
// so the UI can still show empty/retry while the failure stays visible.
test("reports a 400 exactly once with path+status, rows() contract unchanged", async () => {
  const calls: Array<{ error: Error; context: { path: string; status?: number } }> = [];
  const client = createRankingsClient({
    baseUrl: "", headers: async () => ({}),
    fetcher: async () => Response.json({ error: "Bad request" }, { status: 400 }),
    reportError: (error, context) => { calls.push({ error, context }); },
  });
  const result = await client.getRiderRankings("season");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, { path: "/api/rankings/riders", status: 400 });
  assert.ok(calls[0].error instanceof Error);
  assert.equal(result.data, null);
  assert.ok(result.error);
});

test("reports a 500", async () => {
  const calls: Array<{ path: string; status?: number }> = [];
  const client = createRankingsClient({
    baseUrl: "", headers: async () => ({}),
    fetcher: async () => Response.json({}, { status: 500 }),
    reportError: (_error, context) => { calls.push(context); },
  });
  await client.getRiderRankings("season");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { path: "/api/rankings/riders", status: 500 });
});

test("does not report a 401 (session expired, owned by the auth flow)", async () => {
  const calls: unknown[] = [];
  const client = createRankingsClient({
    baseUrl: "", headers: async () => ({}),
    fetcher: async () => Response.json({}, { status: 401 }),
    reportError: (_error, context) => { calls.push(context); },
  });
  await client.getRiderRankings("season");
  assert.equal(calls.length, 0);
});

test("does not report a 404 on honours (staggered-deploy contract), PGRST202 still holds", async () => {
  const calls: unknown[] = [];
  const client = createRankingsClient({
    baseUrl: "", headers: async () => ({}),
    fetcher: async () => Response.json({}, { status: 404 }),
    reportError: (_error, context) => { calls.push(context); },
  });
  const result = await client.getSeasonHonours("season");
  assert.equal(calls.length, 0);
  assert.equal((result.error as Error & { code?: string }).code, "PGRST202");
});

test("does not report a transport failure (fetch throws)", async () => {
  const calls: unknown[] = [];
  const client = createRankingsClient({
    baseUrl: "", headers: async () => ({}),
    fetcher: async () => { throw new Error("offline"); },
    reportError: (_error, context) => { calls.push(context); },
  });
  await client.getRiderRankings("season");
  assert.equal(calls.length, 0);
});

test("missing reportError dependency does not crash", async () => {
  const client = createRankingsClient({
    baseUrl: "", headers: async () => ({}),
    fetcher: async () => Response.json({}, { status: 400 }),
  });
  const result = await client.getRiderRankings("season");
  assert.equal(result.data, null);
  assert.ok(result.error);
});
