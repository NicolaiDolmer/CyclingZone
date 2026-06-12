import test from "node:test";
import assert from "node:assert/strict";
import { isDailyTrainingEnabled, DAILY_TRAINING_FLAG_KEY } from "./dailyTrainingFlag.js";

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
  assert.equal(DAILY_TRAINING_FLAG_KEY, "daily_training_enabled");
});

test("true når value er JSON-boolean true", async () => {
  assert.equal(await isDailyTrainingEnabled(fakeSupabase(true)), true);
});

test("false ved false, manglende række eller DB-fejl (fail-safe)", async () => {
  assert.equal(await isDailyTrainingEnabled(fakeSupabase(false)), false);
  assert.equal(await isDailyTrainingEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isDailyTrainingEnabled(fakeSupabase(true, new Error("boom"))), false);
});

test("exception under query eller ugyldig client → false (fail-safe)", async () => {
  assert.equal(await isDailyTrainingEnabled({ from: () => { throw new Error("network"); } }), false);
  assert.equal(await isDailyTrainingEnabled(null), false);
});
