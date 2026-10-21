import { test } from "node:test";
import assert from "node:assert/strict";
import { riderReputationBand, riderReputationBandKey, riderReputationProgress, riderReputationValue } from "./riderReputationView.ts";

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

test("fremdrift følger niveaugrænserne og stopper ved Legend", () => {
  assert.deepEqual(riderReputationProgress(3), { nextBand: "known", current: 3, target: 20, percent: 15 });
  assert.deepEqual(riderReputationProgress(32), { nextBand: "profile", current: 32, target: 45, percent: 48 });
  assert.equal(riderReputationProgress(90), null);
  assert.equal(riderReputationProgress(null), null);
});

test("fremdriftsteksten runder ned lige under hver niveaugrænse", () => {
  const cases: Array<[number, string, number, number]> = [
    [19.6, "unknown", 20, 19],
    [44.8, "known", 45, 44],
    [89.7, "star", 90, 89],
  ];
  for (const [score, band, target, expectedCurrent] of cases) {
    const progress = riderReputationProgress(score);
    assert.equal(riderReputationBand(score), band);
    assert.equal(progress?.target, target);
    assert.equal(progress?.current, expectedCurrent);
    assert.ok((progress?.current ?? target) < target);
  }
});
