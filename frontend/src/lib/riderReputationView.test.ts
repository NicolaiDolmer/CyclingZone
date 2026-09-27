import { test } from "node:test";
import assert from "node:assert/strict";
import { riderReputationBand, riderReputationBandKey, riderReputationValue } from "./riderReputationView.ts";

test("manglende omdømme er ukendt og vises ikke som nul", () => {
  const rider = { popularity: 24, reputation: null };
  assert.equal(riderReputationValue(rider, true), null);
  assert.equal(riderReputationBandKey(rider, true), null);
  assert.equal(riderReputationValue(rider, false), 24);
  assert.equal(riderReputationBand(null), null);
});
