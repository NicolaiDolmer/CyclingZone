import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as refresh from "./riderValueRefresh.js";
import { DISPLAY_RECIPE_ABILITIES, DISPLAY_RECIPE_KEYS, ratingForRole } from "./weights/displayRecipes.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const baseline = read("./riderTypesBaseline.json");
const model = read("./riderValuationModelV4.json");
const abilities = Object.fromEntries(DISPLAY_RECIPE_ABILITIES.map((key) => [key, 40]));

test("best role uses the maximum displayed rating, stable recipe order on ties", () => {
  assert.equal(typeof refresh.bestRoleForAbilities, "function");
  for (const bump of DISPLAY_RECIPE_ABILITIES) {
    const row = { ...abilities, [bump]: 80 };
    const ratings = DISPLAY_RECIPE_KEYS.map((key) => ratingForRole(row, key));
    const max = Math.max(...ratings);
    assert.deepEqual(refresh.bestRoleForAbilities(row), {
      best_role: DISPLAY_RECIPE_KEYS[ratings.indexOf(max)], best_role_rating: max,
    });
  }
  assert.deepEqual(refresh.bestRoleForAbilities(abilities), { best_role: DISPLAY_RECIPE_KEYS[0], best_role_rating: 40 });
});

test("missing abilities stay null while zero remains a real rating", () => {
  assert.equal(typeof refresh.bestRoleForAbilities, "function");
  for (const row of [null, {}, { sprint: null, acceleration: "", positioning: true }]) {
    assert.deepEqual(refresh.bestRoleForAbilities(row), { best_role: null, best_role_rating: null });
  }
  assert.deepEqual(refresh.bestRoleForAbilities({ sprint: 0 }), { best_role: "sprinter", best_role_rating: 0 });
});

test("refresh persists role-only changes, dry run never writes, second run is a no-op", async () => {
  const rider = { id: "fixture-a", birthdate: "2004-01-01", age: 24, potentiale: 4, valuation_type: "tt" };
  const money = refresh.recomputeRiderValue(rider, abilities, baseline, model);
  const state = { riders: [{ ...rider, ...money, best_role: null, best_role_rating: null }],
    rider_derived_abilities: [{ rider_id: rider.id, ...abilities }] };
  const db = createFakeSupabase(state);
  const options = { baseline, youthBaseline: null, model, seasonNumber: 3 };
  const before = structuredClone(state.riders);
  const dry = await refresh.refreshChangedRiderValues(db, { ...options, dryRun: true });
  assert.equal(dry.changed, 1);
  assert.deepEqual(state.riders, before);
  assert.equal(dry.updates[0].best_role_rating, 40);
  await refresh.refreshChangedRiderValues(db, options);
  assert.equal(state.riders[0].best_role_rating, 40);
  assert.equal(state.riders[0].base_value, before[0].base_value);
  assert.equal(state.riders[0].current_production_value, before[0].current_production_value);
  assert.equal((await refresh.refreshChangedRiderValues(db, options)).written, 0);
});

test("missing valuation inputs do not block a valid best-role cache", () => {
  const updates = refresh.selectChangedValueUpdates([{ id: "fixture-no-age" }],
    new Map([["fixture-no-age", abilities]]), baseline, model);
  assert.deepEqual(updates, [{ id: "fixture-no-age", best_role: DISPLAY_RECIPE_KEYS[0], best_role_rating: 40 }]);
});
