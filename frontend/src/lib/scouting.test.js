import { test } from "node:test";
import assert from "node:assert/strict";
import { potentialLabelKey, scoutSortValue } from "./scouting.js";

// Estimat-beregningen (seededUnit/estimatePotentialRange) er flyttet til
// backend/lib/scouting.js (#1162) og testes i backend/lib/scouting.test.js.

// ── Labels ────────────────────────────────────────────────────────────────────

test("potentialLabelKey mapper midtpunkt til bånd", () => {
  assert.equal(potentialLabelKey({ lo: 5.5, hi: 6 }), "worldclass");
  assert.equal(potentialLabelKey({ lo: 4, hi: 5 }), "high");
  assert.equal(potentialLabelKey({ lo: 3, hi: 4 }), "solid");
  assert.equal(potentialLabelKey({ lo: 2, hi: 3 }), "rotation");
  assert.equal(potentialLabelKey({ lo: 1, hi: 2 }), "limited");
  assert.equal(potentialLabelKey(null), null);
});

test("potentialLabelKey: eksakt estimat (lo == hi) får også label", () => {
  assert.equal(potentialLabelKey({ lo: 5.5, hi: 5.5, exact: true }), "worldclass");
  assert.equal(potentialLabelKey({ lo: 3.5, hi: 3.5, exact: true }), "solid");
});

// ── Sortering ─────────────────────────────────────────────────────────────────

test("scoutSortValue: midtpunkt af estimatet; manglende estimat → 0", () => {
  assert.equal(scoutSortValue({ lo: 3, hi: 5 }), 4);
  assert.equal(scoutSortValue({ lo: 4.5, hi: 4.5, exact: true }), 4.5);
  assert.equal(scoutSortValue(null), 0);
  assert.equal(scoutSortValue(undefined), 0);
});
