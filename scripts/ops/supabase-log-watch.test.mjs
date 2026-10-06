// scripts/ops/supabase-log-watch.test.mjs
// Regression tests for the pure classification logic (#4014).
// Run: node --test scripts/ops/supabase-log-watch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFindings } from "./supabase-log-watch.mjs";
import * as logWatch from "./supabase-log-watch.mjs";

const START = '2026-10-05T06:00:00Z', END = '2026-10-06T06:00:00Z';

test('log query uses the replacement endpoint and an explicit bounded window', async () => {
  const rows = await logWatch.queryLogs('synthetic-token', 'a'.repeat(20), START, END, async (url, options) => {
    assert.equal(url.pathname, '/v1/projects/' + 'a'.repeat(20) + '/analytics/endpoints/logs');
    assert.equal(url.searchParams.get('iso_timestamp_start'), START);
    assert.equal(url.searchParams.get('iso_timestamp_end'), END);
    assert.match(url.searchParams.get('sql'), /from logs/);
    assert.match(url.searchParams.get('sql'), /log_attributes\[/);
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ result: [{ source: 'edge_logs', bucket: '500 /api', cnt: '42' }], error: null }) };
  });
  assert.deepEqual(rows, [{ source: 'edge_logs', bucket: '500 /api', cnt: 42 }]);
});

test('HTTP 200 query errors and malformed rows cannot appear as a quiet log window', async () => {
  for (const body of [{ result: null, error: 'PRIVATE_QUERY_DETAIL' }, {}, { result: [{}] }, { result: [{ source: 'edge_logs', bucket: 'x', cnt: 'not-a-count' }] }]) {
    await assert.rejects(() => logWatch.queryLogs('synthetic-token', 'a'.repeat(20), START, END, async () => ({ ok: true, json: async () => body })), error => {
      assert.doesNotMatch(error.message, /PRIVATE_QUERY_DETAIL/);
      return true;
    });
  }
});

test('HTTP failures do not disclose response bodies and empty valid results stay valid', async () => {
  await assert.rejects(() => logWatch.queryLogs('synthetic-token', 'a'.repeat(20), START, END, async () => ({ ok: false, status: 410, text: async () => 'PRIVATE_BODY' })), error => {
    assert.match(error.message, /410/);
    assert.doesNotMatch(error.message, /PRIVATE_BODY/);
    return true;
  });
  assert.deepEqual(await logWatch.queryLogs('synthetic-token', 'a'.repeat(20), START, END, async () => ({ ok: true, json: async () => ({ result: [], error: null }) })), []);
});

test("no findings when current window is quiet and below thresholds", () => {
  const current = [{ source: "realtime_logs", bucket: "MalformedJWT", cnt: 5 }];
  const previous = [{ source: "realtime_logs", bucket: "MalformedJWT", cnt: 4 }];
  const result = computeFindings(current, previous, { errorThreshold: 200, newClassThreshold: 20 });
  assert.equal(result.hasFindings, false);
  assert.deepEqual(result.spikes, []);
  assert.deepEqual(result.newClasses, []);
});

test("flags a high-volume bucket as a spike even when it also existed yesterday", () => {
  const current = [{ source: "realtime_logs", bucket: "MalformedJWT", cnt: 7727 }];
  const previous = [{ source: "realtime_logs", bucket: "MalformedJWT", cnt: 7000 }];
  const result = computeFindings(current, previous, { errorThreshold: 200, newClassThreshold: 20 });
  assert.equal(result.spikes.length, 1);
  assert.equal(result.spikes[0].cnt, 7727);
  // Existed yesterday too, so it is NOT a "new class" finding.
  assert.equal(result.newClasses.length, 0);
});

test("flags a bucket that did not exist yesterday as a new error class", () => {
  const current = [{ source: "postgres_logs", bucket: "relation \"riders\" does not exist", cnt: 42 }];
  const previous = [];
  const result = computeFindings(current, previous, { errorThreshold: 200, newClassThreshold: 20 });
  assert.equal(result.newClasses.length, 1);
  assert.equal(result.spikes.length, 0);
  assert.equal(result.hasFindings, true);
});

test("does NOT flag a new-looking bucket below the new-class threshold (avoids one-off noise)", () => {
  const current = [{ source: "postgres_logs", bucket: "rare one-off error", cnt: 3 }];
  const previous = [];
  const result = computeFindings(current, previous, { errorThreshold: 200, newClassThreshold: 20 });
  assert.equal(result.hasFindings, false);
});

test("keys new-class detection on (source, bucket) pair, not bucket alone", () => {
  // Same bucket text but a different source should still count as "new" for that source.
  const current = [{ source: "postgrest_logs", bucket: "timeout", cnt: 30 }];
  const previous = [{ source: "edge_logs", bucket: "timeout", cnt: 30 }];
  const result = computeFindings(current, previous, { errorThreshold: 200, newClassThreshold: 20 });
  assert.equal(result.newClasses.length, 1);
  assert.equal(result.newClasses[0].source, "postgrest_logs");
});

test("sorts spikes and newClasses by count descending", () => {
  const current = [
    { source: "a", bucket: "low", cnt: 250 },
    { source: "b", bucket: "high", cnt: 900 },
  ];
  const result = computeFindings(current, [], { errorThreshold: 200, newClassThreshold: 20 });
  assert.equal(result.spikes[0].bucket, "high");
  assert.equal(result.spikes[1].bucket, "low");
});
