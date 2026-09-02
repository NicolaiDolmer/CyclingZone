import test from "node:test";
import assert from "node:assert/strict";

import { SEASON_SIGNUP_FLAG_KEY, isSeasonSignupEnabled } from "./seasonSignupFlag.js";

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

test("nøglen er den migrationen skriver", () => {
  assert.equal(SEASON_SIGNUP_FLAG_KEY, "season_signup_enabled");
});

test("isSeasonSignupEnabled: fail-safe false ved fravær, fejl eller manglende klient (default/off)", async () => {
  assert.equal(await isSeasonSignupEnabled(null), false);
  assert.equal(await isSeasonSignupEnabled(errorClient), false);
  assert.equal(await isSeasonSignupEnabled(flagClient(undefined)), false);
  assert.equal(await isSeasonSignupEnabled(flagClient("off")), false);
});

test("isSeasonSignupEnabled: true ved eksplicit true/'on'", async () => {
  assert.equal(await isSeasonSignupEnabled(flagClient(true)), true);
  assert.equal(await isSeasonSignupEnabled(flagClient("on")), true);
  assert.equal(await isSeasonSignupEnabled(flagClient(false)), false);
  assert.equal(await isSeasonSignupEnabled(flagClient("ON")), false, "case-sensitiv — kun det lave 'on'");
});

test("isSeasonSignupEnabled: 'beta' kræver isBetaTester=true (samme evaluateFlagStage-kontrakt som øvrige flags)", async () => {
  assert.equal(await isSeasonSignupEnabled(flagClient("beta")), false, "default isBetaTester=false");
  assert.equal(await isSeasonSignupEnabled(flagClient("beta"), { isBetaTester: false }), false);
  assert.equal(await isSeasonSignupEnabled(flagClient("beta"), { isBetaTester: true }), true);
});
