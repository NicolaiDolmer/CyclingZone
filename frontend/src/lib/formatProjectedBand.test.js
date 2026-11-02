import { test } from "node:test";
import assert from "node:assert/strict";
import { formatProjectedBand } from "./formatProjectedBand.js";

test("formatProjectedBand: lo === hi giver ét tal", () => {
  assert.equal(formatProjectedBand(15, 15), "15");
  assert.equal(formatProjectedBand(7, 7), "7");
});

test("formatProjectedBand: lo < hi giver interval", () => {
  assert.equal(formatProjectedBand(13, 16), "13–16");
});
