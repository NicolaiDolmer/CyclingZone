import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithRetry } from "./lazyWithRetry.js";

function chunkError() {
  return new TypeError(
    "Failed to fetch dynamically imported module: https://cycling-zone.vercel.app/assets/TeamPage-old.js",
  );
}

test("loadWithRetry — returnerer modulet ved succes (intet retry)", async () => {
  let calls = 0;
  const mod = { default: "X" };
  const result = await loadWithRetry(async () => {
    calls += 1;
    return mod;
  });
  assert.equal(result, mod);
  assert.equal(calls, 1);
});

test("loadWithRetry — ét retry redder en transient chunk-fejl", async () => {
  let calls = 0;
  const mod = { default: "X" };
  const result = await loadWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw chunkError();
    return mod;
  });
  assert.equal(result, mod);
  assert.equal(calls, 2);
});

test("loadWithRetry — vedvarende chunk-fejl kastes som genkendelig ChunkLoadError", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      loadWithRetry(async () => {
        calls += 1;
        throw chunkError();
      }),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      assert.match(err.message, /Failed to fetch dynamically imported module/i);
      return true;
    },
  );
  assert.equal(calls, 2); // initial + ét retry
});

test("loadWithRetry — ikke-chunk-fejl rethrows uden retry", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      loadWithRetry(async () => {
        calls += 1;
        throw new Error("ordinary render crash");
      }),
    /ordinary render crash/,
  );
  assert.equal(calls, 1);
});
