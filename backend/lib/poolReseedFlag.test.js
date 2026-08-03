import test from "node:test";
import assert from "node:assert/strict";

import {
  POOL_RESEED_FLAG_KEY,
  POOL_RESEED_THRESHOLD_KEY,
  isPoolReseedEnabled,
  readPoolReseedThreshold,
} from "./poolReseedFlag.js";
import { DEFAULT_RESEED_THRESHOLD } from "./poolBalance.js";

function flagClient(value) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }),
        }),
      }),
    }),
  };
}

const errorClient = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
    }),
  }),
};

test("nøglerne er dem migrationen skriver", () => {
  assert.equal(POOL_RESEED_FLAG_KEY, "season_end_pool_reseed");
  assert.equal(POOL_RESEED_THRESHOLD_KEY, "season_end_pool_reseed_threshold");
});

test("isPoolReseedEnabled: fail-safe false ved fravær, fejl eller manglende klient", async () => {
  assert.equal(await isPoolReseedEnabled(null), false);
  assert.equal(await isPoolReseedEnabled(errorClient), false);
  assert.equal(await isPoolReseedEnabled(flagClient(undefined)), false);
  assert.equal(await isPoolReseedEnabled(flagClient("off")), false);
});

test("isPoolReseedEnabled: true KUN ved eksplicit true/'on'", async () => {
  assert.equal(await isPoolReseedEnabled(flagClient(true)), true);
  assert.equal(await isPoolReseedEnabled(flagClient("on")), true);
  assert.equal(await isPoolReseedEnabled(flagClient(false)), false);
  assert.equal(await isPoolReseedEnabled(flagClient("ON")), false);
});

test("readPoolReseedThreshold: læser tal og streng-tal fra app_config", async () => {
  assert.equal(await readPoolReseedThreshold(flagClient(8)), 8);
  assert.equal(await readPoolReseedThreshold(flagClient("14")), 14);
  assert.equal(await readPoolReseedThreshold(flagClient(2.5)), 2.5);
});

test("readPoolReseedThreshold: ugyldig værdi kan ikke gøre tærsklen 0 (= re-seed alt)", async () => {
  for (const bad of [undefined, null, 0, -3, "abc", true, {}]) {
    assert.equal(
      await readPoolReseedThreshold(flagClient(bad)),
      DEFAULT_RESEED_THRESHOLD,
      `værdien ${JSON.stringify(bad)} skulle falde tilbage til default`,
    );
  }
  assert.equal(await readPoolReseedThreshold(errorClient), DEFAULT_RESEED_THRESHOLD);
  assert.equal(await readPoolReseedThreshold(null), DEFAULT_RESEED_THRESHOLD);
});
