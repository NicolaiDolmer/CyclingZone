import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as refresh from "./riderValueRefresh.js";
import { DISPLAY_RECIPES, DISPLAY_RECIPE_ABILITIES, DISPLAY_RECIPE_KEYS, ratingForRole } from "./weights/displayRecipes.js";
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

// Fast, seeded PRNG (mulberry32) — deterministic across runs/machines, no
// external dependency. Only used to generate ability fixtures below.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAbilities(rng) {
  return Object.fromEntries(DISPLAY_RECIPE_ABILITIES.map((key) => [key, Math.floor(rng() * 100)]));
}

// Ejer-regel 17/9 (#5351): skiftet til bedste rolle må ALDRIG vise en lavere
// rating end rytterens egen primærtype ville have vist. best_role_rating er
// per definition maksimum over DISPLAY_RECIPE_KEYS, så denne test er en
// forward-guard — den fanger en fremtidig regression hvor bestRoleForAbilities
// stopper med at inkludere primærtypen i sit eget maks (fx en indsnævret
// rolle-liste eller en anden null-håndtering end ratingForRole selv bruger).
test("ejer-regel 17/9 (#5351): best_role_rating falder aldrig under primærtypens rating", () => {
  const rng = mulberry32(20260917);
  const abilitySets = [abilities, ...Array.from({ length: 20 }, () => randomAbilities(rng))];
  for (const ab of abilitySets) {
    const best = refresh.bestRoleForAbilities(ab);
    for (const primaryType of DISPLAY_RECIPE_KEYS) {
      const primaryRating = ratingForRole(ab, primaryType);
      assert.notEqual(primaryRating, null, "fixture skal dække alle recipe-evner");
      assert.ok(
        best.best_role_rating >= primaryRating,
        `best_role_rating ${best.best_role_rating} < ${primaryType}-rating ${primaryRating}`
      );
    }
  }
});

// Alle 8 roller skal kunne blive best_role — ikke kun de tungeste/første i
// listen. For hver DISPLAY_RECIPE-nøgle konstrueres et evne-sæt hvor netop den
// rolles egne evner er høje og alt andet er lavt; ratingForRole (den samme
// funktion produktionskoden bruger) verificerer direkte at rollen faktisk
// topper — ingen egen indexOf(max)-genberegning som orakel.
test("alle 8 roller kan blive best_role", () => {
  for (const recipe of DISPLAY_RECIPES) {
    const ab = Object.fromEntries(DISPLAY_RECIPE_ABILITIES.map((key) => [key, 0]));
    for (const ability of Object.keys(recipe.weights)) ab[ability] = 90;

    const targetRating = ratingForRole(ab, recipe.key);
    for (const otherKey of DISPLAY_RECIPE_KEYS) {
      if (otherKey === recipe.key) continue;
      assert.ok(
        targetRating > ratingForRole(ab, otherKey),
        `${recipe.key}-fixture skal dominere ${otherKey}`
      );
    }

    assert.deepEqual(refresh.bestRoleForAbilities(ab), { best_role: recipe.key, best_role_rating: targetRating });
  }
});
