import test from "node:test";
import assert from "node:assert/strict";
import { evaluateVariant, parseArgs } from "./rating-impact-5268.mjs";
import { DISPLAY_RECIPES } from "../../lib/weights/displayRecipes.js";

test("#5268: primary and best-role display modes are counted separately", () => {
  const abilities = Object.fromEntries([
    "sprint", "acceleration", "positioning", "flat", "durability", "time_trial",
    "tempo", "endurance", "recovery", "climbing", "descending", "punch",
    "cobblestone", "aggression", "tactics",
  ].map((key) => [key, 40]));
  abilities.aggression = 90;
  const entry = { riderId: "r1", age: 28, abilities, next: {
    aggression: 20, tactics: 40, teamwork: 90, leadership: 90,
  } };
  const riders = new Map([["r1", { id: "r1", team_id: "human", primary_type: "sprinter" }]]);
  const recipes = DISPLAY_RECIPES.map((r) => r.key === "baroudeur"
    ? { key: r.key, weights: { ...r.weights, teamwork: 8, leadership: 8 } }
    : r);
  const result = evaluateVariant([entry], new Set(["human"]), riders, recipes);
  assert.equal(result.scenarios.abilityOnly.primary.human.down, 0);
  assert.equal(result.scenarios.abilityOnly.best.human.down, 1);
  assert.equal(result.scenarios.recipeOnly.primary.human.down, 0);
  assert.equal(result.scenarios.combined.primary.human.down, 0);
  assert.equal(result.scenarios.combined.best.human.down, 0);
});

test("#5268: private search argument remains read-only", () => {
  assert.equal(parseArgs(["--search=balance-internals/candidates.json"]).searchPath,
    "balance-internals/candidates.json");
  assert.throws(() => parseArgs(["--apply"]), /Unknown argument/);
});
