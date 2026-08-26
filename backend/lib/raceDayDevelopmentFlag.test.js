import test from "node:test";
import assert from "node:assert/strict";
import { isRaceDayDevelopmentEnabled, RACE_DAY_DEVELOPMENT_FLAG_KEY } from "./raceDayDevelopmentFlag.js";
import { RACE_DAY_ENGINE_FLAG_KEY } from "./raceDayEngineFlag.js";

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

test("flag key er stabil", () => {
  assert.equal(RACE_DAY_DEVELOPMENT_FLAG_KEY, "race_day_development_enabled");
});

test("#4277: udviklings-flagget er en ANDEN nøgle end motor-flagget", () => {
  // Hele pointen med splittet. Skulle de to nogensinde kollapse til samme nøgle,
  // er "sluk udviklingen, behold recovery-konstanterne" umuligt igen.
  assert.notEqual(RACE_DAY_DEVELOPMENT_FLAG_KEY, RACE_DAY_ENGINE_FLAG_KEY);
});

test("true når value er JSON-boolean true eller 'on'", async () => {
  assert.equal(await isRaceDayDevelopmentEnabled(fakeSupabase(true)), true);
  assert.equal(await isRaceDayDevelopmentEnabled(fakeSupabase("on")), true);
});

test("false ved false, manglende række eller DB-fejl (fail-safe) — hard invariant: flag off = S2-adfærd for løbsdage", async () => {
  assert.equal(await isRaceDayDevelopmentEnabled(fakeSupabase(false)), false);
  assert.equal(await isRaceDayDevelopmentEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isRaceDayDevelopmentEnabled(fakeSupabase(true, new Error("boom"))), false);
});

test("exception under query eller ugyldig client → false (fail-safe)", async () => {
  assert.equal(await isRaceDayDevelopmentEnabled({ from: () => { throw new Error("network"); } }), false);
  assert.equal(await isRaceDayDevelopmentEnabled(null), false);
});

test("beta-stage kun for beta-testere", async () => {
  const betaClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await isRaceDayDevelopmentEnabled(betaClient, { isBetaTester: true }), true);
  assert.equal(await isRaceDayDevelopmentEnabled(betaClient, { isBetaTester: false }), false);
  assert.equal(await isRaceDayDevelopmentEnabled(betaClient), false);
});
