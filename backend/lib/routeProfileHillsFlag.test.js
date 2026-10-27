// #7290: kontakten route_profile_hills — kun s5_profiles_v3, fail closed, ingen markoer naar slukket.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUTE_PROFILE_HILLS_FLAG_KEY,
  ROUTE_PROFILE_HILLS_ROW_KEY,
  applyRouteProfileHills,
  isRouteProfileHillsEnabled,
  markStagesForProfileHills,
  routeProfileHillsActive,
} from "./routeProfileHillsFlag.js";

function fakeSupabase(value, { fail = false } = {}) {
  return {
    from(table) {
      assert.equal(table, "app_config");
      return {
        select: () => ({
          eq: (col, key) => {
            assert.equal(key, ROUTE_PROFILE_HILLS_FLAG_KEY);
            return { maybeSingle: async () => (fail ? { data: null, error: { message: "boom" } } : { data: value === undefined ? null : { value }, error: null }) };
          },
        }),
      };
    },
  };
}

test("flaget er slukket naar raekken mangler, er off eller opslaget fejler", async () => {
  assert.equal(await isRouteProfileHillsEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isRouteProfileHillsEnabled(fakeSupabase("off")), false);
  assert.equal(await isRouteProfileHillsEnabled(fakeSupabase("on", { fail: true })), false);
  assert.equal(await isRouteProfileHillsEnabled(fakeSupabase("on")), true);
});

test("kun s5_profiles_v3 (og senere) med taendt flag er aktiv", () => {
  assert.equal(routeProfileHillsActive({ enabled: true, rulesRevision: "s5_profiles_v3" }), true);
  for (const rev of ["legacy", "orders_gc_v3", "official_times_v5", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.equal(routeProfileHillsActive({ enabled: true, rulesRevision: rev }), false, String(rev));
  }
  assert.equal(routeProfileHillsActive({ enabled: false, rulesRevision: "s5_profiles_v3" }), false);
});

test("markoeren saettes kun naar aktiv; ellers er raekkerne byte-identiske", () => {
  const stages = [{ stage_number: 1 }, { stage_number: 2 }];
  const before = JSON.stringify(stages);
  assert.equal(markStagesForProfileHills(stages, { enabled: true, rulesRevision: "s5_profiles_v2" }), false);
  assert.equal(markStagesForProfileHills(stages, { enabled: false, rulesRevision: "s5_profiles_v3" }), false);
  assert.equal(JSON.stringify(stages), before);
  assert.equal(markStagesForProfileHills(stages, { enabled: true, rulesRevision: "s5_profiles_v3" }), true);
  assert.ok(stages.every((s) => s[ROUTE_PROFILE_HILLS_ROW_KEY] === true));
});

test("applyRouteProfileHills: laeser ikke flaget under aeldre revisioner og er fail closed", async () => {
  let calls = 0;
  const stages = [{ stage_number: 1 }];
  assert.equal(await applyRouteProfileHills({ supabase: null, stages, rulesRevision: "s5_profiles_v2", checkEnabled: async () => { calls++; return true; } }), false);
  assert.equal(calls, 0);
  assert.equal(await applyRouteProfileHills({ supabase: null, stages, rulesRevision: "s5_profiles_v3", checkEnabled: async () => { throw new Error("db"); } }), false);
  assert.equal(stages[0][ROUTE_PROFILE_HILLS_ROW_KEY], undefined);
  assert.equal(await applyRouteProfileHills({ supabase: null, stages, rulesRevision: "s5_profiles_v3", checkEnabled: async () => true }), true);
  assert.equal(stages[0][ROUTE_PROFILE_HILLS_ROW_KEY], true);
});
