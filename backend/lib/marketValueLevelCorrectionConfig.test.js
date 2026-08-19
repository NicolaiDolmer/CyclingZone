// Tests for marketValueLevelCorrectionConfig.js (#3449/#3750)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readMinQualifiedTrades,
  readStabilityBand,
  readYouthAuctionStartRateOverride,
  readWageAnchorA,
  DEFAULT_MIN_QUALIFIED_TRADES,
  DEFAULT_STABILITY_BAND,
} from "./marketValueLevelCorrectionConfig.js";

function makeSupabase(valueByKey) {
  return {
    from(table) {
      assert.equal(table, "app_config");
      return {
        select() { return this; },
        eq(_col, key) {
          this._key = key;
          return this;
        },
        maybeSingle: async function () {
          if (!(this._key in valueByKey)) return { data: null, error: null };
          return { data: { value: valueByKey[this._key] }, error: null };
        },
      };
    },
  };
}

describe("readMinQualifiedTrades", () => {
  it("fail-safe DEFAULT_MIN_QUALIFIED_TRADES (40) ved manglende nøgle", async () => {
    assert.equal(await readMinQualifiedTrades(makeSupabase({})), DEFAULT_MIN_QUALIFIED_TRADES);
  });

  it("læser en gyldig konfigureret værdi", async () => {
    assert.equal(await readMinQualifiedTrades(makeSupabase({ market_value_level_correction_min_qualified_trades: 60 })), 60);
  });

  it("fail-safe ved ugyldig værdi (streng)", async () => {
    assert.equal(await readMinQualifiedTrades(makeSupabase({ market_value_level_correction_min_qualified_trades: "abe" })), DEFAULT_MIN_QUALIFIED_TRADES);
  });
});

describe("readStabilityBand", () => {
  it("fail-safe DEFAULT_STABILITY_BAND (0,15) ved manglende nøgle", async () => {
    assert.equal(await readStabilityBand(makeSupabase({})), DEFAULT_STABILITY_BAND);
  });

  it("læser en gyldig konfigureret værdi", async () => {
    assert.equal(await readStabilityBand(makeSupabase({ market_value_level_correction_stability_band: 0.2 })), 0.2);
  });

  it("fail-safe ved værdi uden for [0,0001;1]", async () => {
    assert.equal(await readStabilityBand(makeSupabase({ market_value_level_correction_stability_band: 1.5 })), DEFAULT_STABILITY_BAND);
  });
});

describe("readYouthAuctionStartRateOverride", () => {
  it("NULL (ikke fallback-konstant) ved manglende nøgle — 'ingen korrektion kørt endnu'", async () => {
    assert.equal(await readYouthAuctionStartRateOverride(makeSupabase({})), null);
  });

  it("læser en gyldig konfigureret override", async () => {
    assert.equal(await readYouthAuctionStartRateOverride(makeSupabase({ market_value_level_correction_youth_auction_start_rate: 0.3614 })), 0.3614);
  });

  it("NULL ved ugyldig værdi (uden for (0;1])", async () => {
    assert.equal(await readYouthAuctionStartRateOverride(makeSupabase({ market_value_level_correction_youth_auction_start_rate: 2 })), null);
  });
});

describe("readWageAnchorA", () => {
  it("NULL ved manglende nøgle — #3393-formlen er ikke shippet endnu", async () => {
    assert.equal(await readWageAnchorA(makeSupabase({})), null);
  });

  it("læser en gyldig konfigureret værdi", async () => {
    assert.equal(await readWageAnchorA(makeSupabase({ market_value_level_correction_wage_anchor_a: 28_534 })), 28_534);
  });
});
