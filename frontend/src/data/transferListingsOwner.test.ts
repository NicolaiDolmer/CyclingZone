import test from "node:test";
import assert from "node:assert/strict";
import { createDataRuntime, privateKey } from "./queryRuntime.ts";
import { installTransferListingsQueryOwner } from "./transferListingsOwner.ts";
import { sharedRequestCache, invalidateTransferListings2176, transferListingsKeyForHeaders2176 } from "../lib/sharedRequestCache.js";

test("legacy listing readers and Query share one owner and mutation invalidation", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const runtime = createDataRuntime();
  runtime.setViewer("viewer-a");
  runtime.setTeam("team-a");
  const headers = { Authorization: "Bearer fixture-a" };
  const dispose = installTransferListingsQueryOwner(runtime, async () => headers);
  try {
    const legacyKey = await transferListingsKeyForHeaders2176(headers);
    const queryKey = privateKey(runtime.scope(), "transfer-listings");
    let requests = 0;
    const first = await sharedRequestCache.get(legacyKey, () => { requests += 1; return [{ id: "one" }]; });
    assert.deepEqual(runtime.client.getQueryData(queryKey), first);
    await sharedRequestCache.get(legacyKey, () => { requests += 1; return []; });
    assert.equal(requests, 1);
    invalidateTransferListings2176();
    assert.equal(runtime.client.getQueryState(queryKey)?.isInvalidated, true);
    await sharedRequestCache.get(legacyKey, () => { requests += 1; return [{ id: "two" }]; });
    assert.equal(requests, 2);
  } finally { dispose(); runtime.client.clear(); sharedRequestCache.clear(); }
});
