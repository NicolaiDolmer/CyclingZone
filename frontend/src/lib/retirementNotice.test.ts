import test from "node:test";
import assert from "node:assert/strict";
import { retirementBannerSeason } from "./retirementNotice.ts";

test("the retirement banner uses the response season despite a newer frontend season", () => {
  const response = { announced_retirement: true, retirement_after_season: 4 };
  assert.equal(retirementBannerSeason(response, 5), 4);
  assert.equal(retirementBannerSeason(response, 6), 4);
});

test("an unannounced retirement never produces a final-season banner", () => {
  assert.equal(retirementBannerSeason({ announced_retirement: false, retirement_after_season: 4 }, 5), null);
});

test("old backend responses retain the existing explicit frontend fallback", () => {
  assert.equal(retirementBannerSeason({ announced_retirement: true }, 5), 5);
  assert.equal(retirementBannerSeason({ announced_retirement: true }, null), null);
});

test("invalid response seasons cannot become a displayed season", () => {
  for (const value of [null, 0, -1, 4.5, "invalid"]) {
    assert.equal(retirementBannerSeason({ announced_retirement: true, retirement_after_season: value }, 5), 5);
  }
});
