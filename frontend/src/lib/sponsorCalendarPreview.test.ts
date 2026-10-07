import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSponsorCalendarPreview } from "./sponsorCalendarPreview.ts";
import { projectOffer } from "./sponsorOfferProjection.js";

test("missing next calendar uses the current pool, never the old fallback divisor", () => {
  const preview = resolveSponsorCalendarPreview({ byTier: {}, fallbackDays: 60 }, 1, 140, 1);
  assert.deepEqual(preview, { count: 140, estimated: true });
  const offer = { guaranteedBase: 772800, guaranteedFraction: .92, raceDayShare: .08 };
  const projected = projectOffer(offer, preview.count);
  assert.equal(projected.rate, 480);
  assert.equal(projected.raceDayPool, 67200);
});
test("published next calendar takes precedence over current calendar", () => {
  assert.deepEqual(resolveSponsorCalendarPreview({ byTier: { 1: 155 } }, 1, 140, 1), { count: 155, estimated: false });
});
test("a missing calendar is unknown, including another division and new clubs", () => {
  const cases: Parameters<typeof resolveSponsorCalendarPreview>[] = [[{}, 2, 140, 1], [{ fallbackDays: 60 }, 1, null, 1], [null, null, 140, null]];
  for (const args of cases) {
    assert.deepEqual(resolveSponsorCalendarPreview(...args), { count: null, estimated: true });
  }
});
test("invalid next counts cannot become a zero or negative payout divisor", () => {
  for (const count of [0, -1, Infinity, NaN]) {
    assert.deepEqual(resolveSponsorCalendarPreview({ byTier: { 1: count } }, 1, 140, 1), { count: 140, estimated: true });
  }
});
