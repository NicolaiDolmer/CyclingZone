// Race Engine v3 (#2224), slice S5 — peak_planner_enabled flag.
//
// Peak-plan-CRUD gates bag et selvstændigt app_config-flag (default OFF), så
// peaks IKKE kan skabes før Planner-UI'et + ejer-go — selv om race_engine_v3_scoring
// allerede er ON i prod (en oprettet plan ville ellers virke øjeblikkeligt). Ren
// enheds-test af fail-safe-defaulten via en fake supabase (samme mønster som
// featureStage-stien de øvrige flag deler).
import test from "node:test";
import assert from "node:assert/strict";

import { isPeakPlannerEnabled, PEAK_PLANNER_FLAG_KEY } from "./raceEngineFlag.js";

function fakeSupabase(value) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: value === undefined ? null : { value }, error: null }); },
      };
    },
  };
}

test("flag-nøglen er peak_planner_enabled", () => {
  assert.equal(PEAK_PLANNER_FLAG_KEY, "peak_planner_enabled");
});

test("fravær af flag-row → OFF (fail-safe: peaks ikke skabbare før launch)", async () => {
  assert.equal(await isPeakPlannerEnabled(fakeSupabase(undefined)), false);
});

test("'off' → false", async () => {
  assert.equal(await isPeakPlannerEnabled(fakeSupabase("off")), false);
});

test("'on' → true", async () => {
  assert.equal(await isPeakPlannerEnabled(fakeSupabase("on")), true);
});

test("legacy boolean true → true", async () => {
  assert.equal(await isPeakPlannerEnabled(fakeSupabase(true)), true);
});
