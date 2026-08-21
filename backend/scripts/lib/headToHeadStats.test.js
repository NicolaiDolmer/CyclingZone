// backend/scripts/lib/headToHeadStats.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { mean, median, percentile, spearmanCorrelation, sampleField, fmt, fmtPct } from "./headToHeadStats.js";

test("mean: tom liste giver null, ikke 0", () => {
  assert.equal(mean([]), null);
  assert.equal(mean([2, 4, 6]), 4);
});

test("median: ulige og lige laengde", () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("percentile: naermeste-rang, p0/p100 rammer yderpunkter", () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(percentile(values, 0), 10);
  assert.equal(percentile(values, 100), 50);
  assert.equal(percentile([], 50), null);
});

test("spearmanCorrelation: perfekt positiv sammenhaeng giver 1", () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [10, 20, 30, 40, 50];
  assert.equal(spearmanCorrelation(xs, ys), 1);
});

test("spearmanCorrelation: perfekt negativ sammenhaeng giver -1", () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [50, 40, 30, 20, 10];
  assert.equal(spearmanCorrelation(xs, ys), -1);
});

test("spearmanCorrelation: konstant side -> null (ikke 0)", () => {
  assert.equal(spearmanCorrelation([1, 1, 1], [1, 2, 3]), null);
});

test("spearmanCorrelation: under 2 par -> null", () => {
  assert.equal(spearmanCorrelation([1], [1]), null);
  assert.equal(spearmanCorrelation([], []), null);
});

test("spearmanCorrelation: haandterer lige vaerdier (tie-average-rang) uden at kaste", () => {
  const rho = spearmanCorrelation([1, 1, 2, 3], [1, 2, 2, 3]);
  assert.ok(Number.isFinite(rho));
  assert.ok(rho > 0);
});

test("sampleField: deterministisk ved samme rng-stroem, ingen mutation af pool", () => {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8];
  const poolCopy = [...pool];
  let seed = 42;
  const rng = () => {
    // simpel LCG, kun til test-determinisme
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const a = sampleField(rng, pool, 3);
  seed = 42;
  const b = sampleField(rng, pool, 3);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.deepEqual(pool, poolCopy);
});

test("sampleField: n > pool.length clamper til pool.length uden fejl", () => {
  const pool = [1, 2, 3];
  const rng = () => 0.5;
  const result = sampleField(rng, pool, 10);
  assert.equal(result.length, 3);
});

test("fmt/fmtPct: null -> n/a, tal formateres", () => {
  assert.equal(fmt(null), "n/a");
  assert.equal(fmt(1.23456, 2), "1.23");
  assert.equal(fmtPct(null), "n/a");
  assert.equal(fmtPct(0.256), "25.6%");
});
