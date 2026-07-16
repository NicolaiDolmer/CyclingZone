import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBestValueTrendWindow, valueTrendDirection } from "./riderValueTrend.js";

test("pickBestValueTrendWindow: foretrækker 14-dages-vinduet", () => {
  const w7 = { delta: 100, pct: 1, actualDaysAgo: 7, snapshotDate: "2026-07-09" };
  const w14 = { delta: 300, pct: 3, actualDaysAgo: 14, snapshotDate: "2026-07-02" };
  assert.deepEqual(pickBestValueTrendWindow({ 7: w7, 14: w14 }), w14);
});

test("pickBestValueTrendWindow: falder tilbage til 7 dage når 14 mangler", () => {
  const w7 = { delta: 100, pct: 1, actualDaysAgo: 7, snapshotDate: "2026-07-09" };
  assert.deepEqual(pickBestValueTrendWindow({ 7: w7, 14: null }), w7);
});

test("pickBestValueTrendWindow: null når intet vindue har data (ingen fabrikation)", () => {
  assert.equal(pickBestValueTrendWindow({ 7: null, 14: null }), null);
  assert.equal(pickBestValueTrendWindow(null), null);
  assert.equal(pickBestValueTrendWindow(undefined), null);
});

test("valueTrendDirection: up/down/flat + null uden vindue", () => {
  assert.equal(valueTrendDirection({ delta: 500 }), "up");
  assert.equal(valueTrendDirection({ delta: -500 }), "down");
  assert.equal(valueTrendDirection({ delta: 0 }), "flat");
  assert.equal(valueTrendDirection(null), null);
});
