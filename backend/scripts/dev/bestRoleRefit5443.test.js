import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { candidateValue, refitBestRole } from "./bestRoleRefit5443.js";
import { bestRoleForAbilities } from "../../lib/riderValueRefresh.js";
import { predictBaseValueV4 } from "../../lib/riderCareerNpv.js";
import { DISPLAY_RECIPE_ABILITIES, roleOutputRaw } from "../../lib/weights/displayRecipes.js";
const model = JSON.parse(readFileSync(new URL("../../lib/riderValuationModelV5.json", import.meta.url)));
const ab = Object.fromEntries(DISPLAY_RECIPE_ABILITIES.map(k => [k, 40]));
const rider = { primary_type: "tt", valuation_type: "gc", age: 25, potentiale: 4 };
test("candidate routes rounded best role through real NPV without mutating inputs", () => {
  const candidate = {...model, type_source: "best_role"};
  const before = JSON.stringify({rider, ab, candidate});
  const best = bestRoleForAbilities(ab).best_role;
  assert.equal(candidateValue(rider, ab, candidate), predictBaseValueV4({...rider, valuation_type: best}, ab, {...candidate, type_source: undefined}));
  assert.equal(JSON.stringify({rider, ab, candidate}), before);
  assert.equal(candidateValue(rider, {}, candidate), null);
});
test("offsets fitted by best role with display recipes and unchanged curve", () => {
  const samples = [20, 30, 40, 50].map(n => {
    const abilities = {...ab, sprint: n + 25, acceleration: n + 15};
    const role = bestRoleForAbilities(abilities).best_role;
    const output = roleOutputRaw(abilities, role);
    return {primary_type: "tt", abilities, e_prize: Math.exp(model.fit.a + model.fit.b * output + model.fit.c * output ** 2 + 0.7)};
  });
  const result = refitBestRole(samples, model);
  const role = bestRoleForAbilities(samples[0].abilities).best_role;
  assert.ok(Math.abs(result.fit.offset[role] - 0.7) < 1e-9);
  for (const key of ["a", "b", "c", "alpha"]) assert.equal(result.fit[key], model.fit[key]);
  assert.equal(result.type_source, "best_role");
  assert.ok(result.refit.unsampled_roles.length > 0);
});
