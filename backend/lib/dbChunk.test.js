import { test } from "node:test";
import assert from "node:assert/strict";
import { selectInChunks, fetchAllPaged, runWithRetry } from "./dbChunk.js";
import { isTransientSupabaseError } from "./supabaseErrorNormalize.js";

const noSleep = { sleepFn: async () => {} };

// Minimal PostgREST-builder: await giver næste svar fra `responses`.
function fakeSupabase(responses) {
  const calls = [];
  const builder = () => {
    const b = {
      select() { return b; }, in(col, ids) { calls.push(ids.length); return b; },
      order() { return b; }, range() { return b; },
      then(resolve, reject) { return Promise.resolve(responses.shift()).then(resolve, reject); },
    };
    return b;
  };
  return { supabase: { from: () => builder() }, calls };
}

test("CYCLINGZONE-9A: 'Project not specified' er forbigående", () => {
  assert.equal(isTransientSupabaseError({ message: "Project not specified." }), true);
  assert.equal(isTransientSupabaseError({ message: "permission denied for table race_entries" }), false);
});

test("selectInChunks: forbigående fejl retry'es og giver data", async () => {
  const { supabase, calls } = fakeSupabase([
    { data: null, error: { message: "Project not specified." } },
    { data: [{ id: 1 }], error: null },
  ]);
  const res = await selectInChunks({ supabase, table: "t", columns: "id", inColumn: "id", ids: ["a"], retryOpts: noSleep });
  assert.deepEqual(res, { data: [{ id: 1 }], error: null });
  assert.equal(calls.length, 2, "frisk builder pr. forsøg");
});

test("selectInChunks: ikke-forbigående fejl returneres straks som {error}, ingen retry", async () => {
  const { supabase, calls } = fakeSupabase([{ data: null, error: { message: "permission denied", code: "42501" } }]);
  const res = await selectInChunks({ supabase, table: "t", columns: "id", inColumn: "id", ids: ["a"], retryOpts: noSleep });
  assert.equal(res.data, null);
  assert.equal(res.error.message, "permission denied");
  assert.equal(res.error.code, "42501", "koden bevares til kalderen");
  assert.equal(calls.length, 1);
});

test("selectInChunks: vedvarende forbigående fejl opgives efter retries og returneres", async () => {
  const err = { data: null, error: { message: "Project not specified." } };
  const { supabase, calls } = fakeSupabase([err, err, err]);
  const res = await selectInChunks({ supabase, table: "t", columns: "id", inColumn: "id", ids: ["a"], retryOpts: noSleep });
  assert.equal(res.data, null);
  assert.match(res.error.message, /Project not specified/);
  assert.equal(calls.length, 3, "1 forsøg + 2 retries");
});

test("fetchAllPaged: forbigående fejl på en side retry'es", async () => {
  const responses = [{ data: null, error: { message: "fetch failed" } }, { data: [{ id: 1 }], error: null }];
  let n = 0;
  const query = () => { n++; const b = { range: () => b, then: (r, j) => Promise.resolve(responses.shift()).then(r, j) }; return b; };
  const res = await fetchAllPaged(query, { retryOpts: noSleep });
  assert.deepEqual(res, { data: [{ id: 1 }], error: null });
  assert.equal(n, 2);
});

test("runWithRetry: {data, error}-kontrakt", async () => {
  assert.deepEqual(await runWithRetry(async () => ({ data: [1], error: null }), noSleep), { data: [1], error: null });
});
