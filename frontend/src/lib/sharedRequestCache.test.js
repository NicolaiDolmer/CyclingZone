import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestCache, SHARED_KEYS, SHARED_TTL_MS } from "./sharedRequestCache.js";

// #5089: enheds-test af det delte request-lag. Selve fan-out-tallet maales i
// tests/e2e/5089-rider-card-request-count.spec.js; her verificeres den adfaerd
// tallet HVILER paa: in-flight-dedupe, TTL, at fejl ikke caches, og at en
// mutation kan rydde en enkelt noegle.

function counter(value = "ok") {
  let calls = 0;
  return {
    get calls() { return calls; },
    loader: async () => { calls += 1; return value; },
  };
}

test("samtidige kald paa samme noegle deler EET loader-kald", async () => {
  const cache = createRequestCache();
  let resolveLoader;
  let calls = 0;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { resolveLoader = resolve; });
  };

  const a = cache.get("k", loader);
  const b = cache.get("k", loader);
  const c = cache.get("k", loader);
  resolveLoader("payload");

  assert.deepEqual(await Promise.all([a, b, c]), ["payload", "payload", "payload"]);
  assert.equal(calls, 1, "tre samtidige mounts maa kun koste eet netvaerkskald");
});

test("efterfoelgende kald inden for TTL rammer cachen", async () => {
  let clock = 1000;
  const cache = createRequestCache({ now: () => clock });
  const c = counter();

  assert.equal(await cache.get("k", c.loader, 5000), "ok");
  clock += 4999;
  assert.equal(await cache.get("k", c.loader, 5000), "ok");
  assert.equal(c.calls, 1);
});

test("kald efter TTL henter forfra", async () => {
  let clock = 1000;
  const cache = createRequestCache({ now: () => clock });
  const c = counter();

  await cache.get("k", c.loader, 5000);
  clock += 5001;
  await cache.get("k", c.loader, 5000);
  assert.equal(c.calls, 2);
});

test("en fejl caches ikke — naeste kalder proever igen", async () => {
  const cache = createRequestCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    if (calls === 1) throw new Error("network");
    return "ok";
  };

  await assert.rejects(() => cache.get("k", loader), /network/);
  assert.equal(await cache.get("k", loader), "ok");
  assert.equal(calls, 2);
});

test("invalidate rydder kun den ene noegle", async () => {
  const cache = createRequestCache();
  const a = counter("a");
  const b = counter("b");

  await cache.get("a", a.loader);
  await cache.get("b", b.loader);
  cache.invalidate("a");
  await cache.get("a", a.loader);
  await cache.get("b", b.loader);

  assert.equal(a.calls, 2, "invalideret noegle skal hentes forfra");
  assert.equal(b.calls, 1, "urelateret noegle maa ikke rammes");
});

test("clear rydder alt", async () => {
  const cache = createRequestCache();
  const c = counter();
  await cache.get("k", c.loader);
  cache.clear();
  await cache.get("k", c.loader);
  assert.equal(c.calls, 2);
  assert.equal(cache.stats().size, 1);
});

test("hver global noegle har sin egen TTL", () => {
  // #5089 lagde de tre foerste ind; #4983 lagde selectionReminder til. Listen er
  // eksplicit, saa en ny noegle uden TTL fanges her og ikke i prod.
  assert.deepEqual(
    Object.keys(SHARED_KEYS).sort(),
    ["deadlineDayStatus", "scoutingMe", "selectionReminder", "transferListings"],
  );
  for (const key of Object.keys(SHARED_KEYS)) {
    assert.ok(SHARED_TTL_MS[key] > 0, `${key} mangler en TTL`);
    assert.ok(SHARED_TTL_MS[key] <= 60_000, `${key} har for lang TTL til at vaere sikker uden invalidering`);
  }
});
