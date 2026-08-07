import test from "node:test";
import assert from "node:assert/strict";
import { isRaceDayEngineEnabled, RACE_DAY_ENGINE_FLAG_KEY } from "./raceDayEngineFlag.js";

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
  assert.equal(RACE_DAY_ENGINE_FLAG_KEY, "race_day_engine_enabled");
});

test("true når value er JSON-boolean true eller 'on'", async () => {
  assert.equal(await isRaceDayEngineEnabled(fakeSupabase(true)), true);
  assert.equal(await isRaceDayEngineEnabled(fakeSupabase("on")), true);
});

test("false ved false, manglende række eller DB-fejl (fail-safe) — hard invariant: flag off = uændret adfærd", async () => {
  assert.equal(await isRaceDayEngineEnabled(fakeSupabase(false)), false);
  assert.equal(await isRaceDayEngineEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isRaceDayEngineEnabled(fakeSupabase(true, new Error("boom"))), false);
});

test("exception under query eller ugyldig client → false (fail-safe)", async () => {
  assert.equal(await isRaceDayEngineEnabled({ from: () => { throw new Error("network"); } }), false);
  assert.equal(await isRaceDayEngineEnabled(null), false);
});

test("isRaceDayEngineEnabled: beta-stage kun for beta-testere", async () => {
  const betaClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await isRaceDayEngineEnabled(betaClient, { isBetaTester: true }), true);
  assert.equal(await isRaceDayEngineEnabled(betaClient, { isBetaTester: false }), false);
  assert.equal(await isRaceDayEngineEnabled(betaClient), false);
});
