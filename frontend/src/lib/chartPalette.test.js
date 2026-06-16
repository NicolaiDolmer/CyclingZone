import { test } from "node:test";
import assert from "node:assert/strict";
import { CHART_PALETTE, chartColor } from "./chartPalette.js";

test("CHART_PALETTE has 9 categorical colors", () => {
  assert.equal(CHART_PALETTE.length, 9);
});

test("chartColor wraps by index", () => {
  assert.equal(chartColor(0), CHART_PALETTE[0]);
  assert.equal(chartColor(9), CHART_PALETTE[0]);
  assert.equal(chartColor(10), CHART_PALETTE[1]);
  assert.equal(chartColor(-1), CHART_PALETTE[8]);
});

test("colors are token-backed, no raw hex leaks", () => {
  for (const c of CHART_PALETTE) {
    assert.ok(/^rgb\(var\(--cz-chart-\d\)\)$/.test(c), c);
    assert.ok(!/#[0-9a-fA-F]{6}/.test(c), `raw hex in ${c}`);
  }
});
