import { test } from "node:test";
import assert from "node:assert/strict";
import { riderReputationBand, riderReputationBandKey, riderReputationValue } from "./riderReputationView.ts";

test("overgangen bevarer populariteten, når omdømme mangler", () => {
  const rider = { popularity: 24, reputation: null };
  assert.equal(riderReputationValue(rider, true), 24);
  assert.equal(riderReputationBandKey(rider, true), "reputation.band.known");
  assert.equal(riderReputationValue(rider, false), 24);
  assert.equal(riderReputationBand(null), null);
});

test("synligt omdømme falder aldrig under gammel popularitet", () => {
  const rider = { popularity: 82, reputation: 60 };
  assert.equal(riderReputationValue(rider, true), 82);
  assert.equal(riderReputationBandKey(rider, true), "reputation.band.star");
  assert.equal(riderReputationValue({ popularity: 24, reputation: 49 }, true), 49);
  assert.equal(riderReputationValue(rider, false), 82);
  assert.equal(riderReputationValue({ popularity: null, reputation: null }, true), null);
});
