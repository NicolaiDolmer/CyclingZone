import test from "node:test";
import assert from "node:assert/strict";
import { DataError, parseApiResult, rows } from "./apiQuery.ts";
test("failed reads cannot become empty successful lists", () => {
  for (const result of [
    { ok: false, status: 429, data: null, limited: true, retryAt: 9000 },
    { ok: false, status: 401, data: null, unauthorized: true },
    { ok: false, status: 0, data: null, networkError: true },
    { ok: false, status: 503, data: null },
  ]) assert.throws(() => parseApiResult(result, rows), DataError);
});
test("invalid JSON shapes reject while genuine empty lists succeed", () => {
  assert.throws(() => parseApiResult({ ok: true, status: 200, data: null }, rows), DataError);
  assert.deepEqual(parseApiResult({ ok: true, status: 200, data: [] }, rows), []);
});
test("rate limit metadata is preserved without automatic retry", () => {
  try { parseApiResult({ ok: false, status: 429, limited: true, data: null, retryAt: 9000 }, rows); }
  catch (error) { assert.ok(error instanceof DataError); assert.equal(error.retryAt, 9000); assert.equal(error.kind, "limited"); }
});

test("initial rate limits remain silent while ordinary failures expose retry and cached data stays visible", async () => {
  const { readFailurePresentation } = await import("./apiQuery.ts");
  assert.equal(readFailurePresentation(new DataError("limited", 429, 9000), false), "waiting");
  assert.equal(readFailurePresentation(new DataError("unauthorized", 401), false), "waiting");
  assert.equal(readFailurePresentation(new DataError("http", 503), false), "error");
  assert.equal(readFailurePresentation(new DataError("limited", 429, 9000), true), "retain");
});
