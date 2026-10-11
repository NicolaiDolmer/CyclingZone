import test from "node:test";
import assert from "node:assert/strict";
import { isDevelopmentV2AgingEnabled, DEVELOPMENT_V2_AGING_FLAG_KEY } from "./developmentV2Flag.js";
import { isStageFlagKey } from "./stageFlagCatalog.js";

function fakeSupabase(value, error = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }),
        }),
      }),
    }),
  };
}

test("#6499: flag-nøglen er stabil og står i admin-tavlens katalog", () => {
  assert.equal(DEVELOPMENT_V2_AGING_FLAG_KEY, "development_v2_aging_enabled");
  assert.equal(isStageFlagKey(DEVELOPMENT_V2_AGING_FLAG_KEY), true);
});

test("#6499: tændt ved boolean true eller 'on'", async () => {
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase(true)), true);
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase("on")), true);
});

test("#6499: slukket som default — manglende række, false, 'off', DB-fejl, ugyldig klient", async () => {
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase(false)), false);
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase("off")), false);
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase(true, new Error("boom"))), false);
  assert.equal(await isDevelopmentV2AgingEnabled({ from: () => { throw new Error("network"); } }), false);
  assert.equal(await isDevelopmentV2AgingEnabled(null), false);
});

test("#6499: 'beta' tænder IKKE sæsonskiftet (ingen skyggedata at skrive; motoren kalder uden engineWrite)", async () => {
  assert.equal(await isDevelopmentV2AgingEnabled(fakeSupabase("beta")), false);
});
