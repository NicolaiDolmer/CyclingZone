// Tests for marketValueSweepConfig.js (#3448)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMarketValueSweepEnabled,
  readMarketValueGlobalWeight,
  readMarketValueWeeklyCap,
  DEFAULT_GLOBAL_WEIGHT,
  DEFAULT_WEEKLY_CAP,
} from "./marketValueSweepConfig.js";

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

describe("isMarketValueSweepEnabled", () => {
  it("false ved manglende nøgle (fail-safe)", async () => {
    assert.equal(await isMarketValueSweepEnabled(makeSupabase({})), false);
  });

  it("false ved 'off'", async () => {
    assert.equal(await isMarketValueSweepEnabled(makeSupabase({ market_value_sweep_enabled: "off" })), false);
  });

  it("true ved 'on'", async () => {
    assert.equal(await isMarketValueSweepEnabled(makeSupabase({ market_value_sweep_enabled: "on" })), true);
  });

  it("true ved boolean true (bagudkompat)", async () => {
    assert.equal(await isMarketValueSweepEnabled(makeSupabase({ market_value_sweep_enabled: true })), true);
  });

  it("false ved manglende supabase-client", async () => {
    assert.equal(await isMarketValueSweepEnabled(null), false);
  });
});

describe("readMarketValueGlobalWeight", () => {
  it("default 0.5 ved manglende nøgle", async () => {
    assert.equal(await readMarketValueGlobalWeight(makeSupabase({})), DEFAULT_GLOBAL_WEIGHT);
  });

  it("læser en gyldig sat værdi", async () => {
    assert.equal(await readMarketValueGlobalWeight(makeSupabase({ market_value_global_weight: 0.8 })), 0.8);
  });

  it("falder tilbage ved ugyldig værdi (uden for [0,1])", async () => {
    assert.equal(await readMarketValueGlobalWeight(makeSupabase({ market_value_global_weight: 1.5 })), DEFAULT_GLOBAL_WEIGHT);
    assert.equal(await readMarketValueGlobalWeight(makeSupabase({ market_value_global_weight: -0.1 })), DEFAULT_GLOBAL_WEIGHT);
  });

  it("falder tilbage ved ikke-numerisk værdi", async () => {
    assert.equal(await readMarketValueGlobalWeight(makeSupabase({ market_value_global_weight: "halv" })), DEFAULT_GLOBAL_WEIGHT);
  });

  it("accepterer numerisk streng", async () => {
    assert.equal(await readMarketValueGlobalWeight(makeSupabase({ market_value_global_weight: "0.7" })), 0.7);
  });
});

describe("readMarketValueWeeklyCap", () => {
  it("default 0.25 ved manglende nøgle", async () => {
    assert.equal(await readMarketValueWeeklyCap(makeSupabase({})), DEFAULT_WEEKLY_CAP);
  });

  it("læser en gyldig sat værdi (fx ejer-valgt ±15%)", async () => {
    assert.equal(await readMarketValueWeeklyCap(makeSupabase({ market_value_weekly_cap: 0.15 })), 0.15);
  });

  it("falder tilbage ved 0 (ville fastfryse alt uden en eksplicit hensigt)", async () => {
    assert.equal(await readMarketValueWeeklyCap(makeSupabase({ market_value_weekly_cap: 0 })), DEFAULT_WEEKLY_CAP);
  });

  it("falder tilbage ved værdi > 1", async () => {
    assert.equal(await readMarketValueWeeklyCap(makeSupabase({ market_value_weekly_cap: 2 })), DEFAULT_WEEKLY_CAP);
  });
});
