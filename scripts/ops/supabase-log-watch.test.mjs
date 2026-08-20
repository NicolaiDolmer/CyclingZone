// scripts/ops/supabase-log-watch.test.mjs
// Regression tests for the pure classification logic (#4014).
// Run: node --test scripts/ops/supabase-log-watch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFindings } from "./supabase-log-watch.mjs";

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
