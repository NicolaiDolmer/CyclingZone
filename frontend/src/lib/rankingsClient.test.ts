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
