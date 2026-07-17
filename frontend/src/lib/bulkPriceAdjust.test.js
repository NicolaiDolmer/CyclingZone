import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAdjustedPrice, previewBulkPriceAdjust, MIN_ASKING_PRICE } from "./bulkPriceAdjust.js";

// #2451: bulk price editor — "+10% on all marked" relative adjustment is the
// feature that makes bulk faster than sequential per-rider edits, so its math
// is covered directly (no component mount needed).

test("computeAdjustedPrice — percent mode rounds to nearest integer", () => {
  assert.equal(computeAdjustedPrice(1000, { mode: "percent", value: 10 }), 1100);
  assert.equal(computeAdjustedPrice(999, { mode: "percent", value: 10 }), 1099); // 1098.9 → round
  assert.equal(computeAdjustedPrice(1000, { mode: "percent", value: -25 }), 750);
});

test("computeAdjustedPrice — amount mode adds a flat CZ$ delta", () => {
  assert.equal(computeAdjustedPrice(5000, { mode: "amount", value: 500 }), 5500);
  assert.equal(computeAdjustedPrice(5000, { mode: "amount", value: -500 }), 4500);
});

test("computeAdjustedPrice — set mode ignores the current price entirely", () => {
  assert.equal(computeAdjustedPrice(5000, { mode: "set", value: 3000 }), 3000);
  assert.equal(computeAdjustedPrice(1, { mode: "set", value: 3000 }), 3000);
});

test("computeAdjustedPrice — clamps to MIN_ASKING_PRICE, never zero/negative", () => {
  assert.equal(computeAdjustedPrice(100, { mode: "percent", value: -100 }), MIN_ASKING_PRICE);
  assert.equal(computeAdjustedPrice(100, { mode: "amount", value: -1000 }), MIN_ASKING_PRICE);
  assert.equal(computeAdjustedPrice(100, { mode: "set", value: -50 }), MIN_ASKING_PRICE);
  assert.equal(computeAdjustedPrice(100, { mode: "set", value: 0 }), MIN_ASKING_PRICE);
});

test("computeAdjustedPrice — non-finite/missing adjustment value is a no-op", () => {
  assert.equal(computeAdjustedPrice(1000, { mode: "percent", value: NaN }), 1000);
  assert.equal(computeAdjustedPrice(1000, {}), 1000);
  assert.equal(computeAdjustedPrice(1000, undefined), 1000);
});

test("computeAdjustedPrice — unknown mode is a no-op (defensive default)", () => {
  assert.equal(computeAdjustedPrice(1000, { mode: "bogus", value: 10 }), 1000);
});

test("previewBulkPriceAdjust — builds from/to/changed per listing, skips non-numeric prices", () => {
  const listings = [
    { id: "a", asking_price: 1000 },
    { id: "b", asking_price: 2000 },
    { id: "c", asking_price: null },
    { id: "d" },
  ];
  const preview = previewBulkPriceAdjust(listings, { mode: "percent", value: 10 });
  assert.deepEqual(preview, [
    { id: "a", from: 1000, to: 1100, changed: true },
    { id: "b", from: 2000, to: 2200, changed: true },
  ]);
});

test("previewBulkPriceAdjust — zero-value adjustment marks nothing changed", () => {
  const listings = [{ id: "a", asking_price: 1000 }];
  const preview = previewBulkPriceAdjust(listings, { mode: "amount", value: 0 });
  assert.equal(preview[0].changed, false);
  assert.equal(preview[0].to, 1000);
});

test("previewBulkPriceAdjust — empty/missing listings array returns empty preview", () => {
  assert.deepEqual(previewBulkPriceAdjust([], { mode: "set", value: 100 }), []);
  assert.deepEqual(previewBulkPriceAdjust(undefined, { mode: "set", value: 100 }), []);
});
