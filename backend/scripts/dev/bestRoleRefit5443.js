// Development-only adapter. Production valuation dispatch remains unchanged.
import { bestRoleForAbilities } from "../../lib/riderValueRefresh.js";
import { predictBaseValueV4 } from "../../lib/riderCareerNpv.js";
import { DISPLAY_RECIPE_KEYS, roleOutputRaw } from "../../lib/weights/displayRecipes.js";

export function candidateValue(rider, abilities, model, forcedRole = null) {
  const role = forcedRole ?? bestRoleForAbilities(abilities).best_role;
  if (!role) return null;
  // The legacy dispatch selects valuation_type. Adapt only the input object;
  // the existing NPV engine owns caps, growth, survival, premium and rounding.
  return predictBaseValueV4({...rider, valuation_type: role}, abilities,
    {...model, type_source: undefined, weights_source: "display_recipes"});
}

export function refitBestRole(samples, source) {
  const residuals = Object.fromEntries(DISPLAY_RECIPE_KEYS.map(key => [key, []]));
  const {a, b, c = 0, alpha} = source.fit;
  if (alpha !== 1) throw new Error("Best-role refit requires display-only alpha=1");
  const observations = [];
  for (const sample of samples) {
    const role = bestRoleForAbilities(sample.abilities).best_role;
    if (!role || !Number.isFinite(sample.e_prize) || sample.e_prize < 0) throw new Error("Invalid simulation sample");
    const output = roleOutputRaw(sample.abilities, role);
    const y = Math.log(Math.max(1, sample.e_prize));
    const curve = a + b * output + c * output ** 2;
    residuals[role].push(y - curve);
    observations.push({role, y, curve});
  }
  if (observations.length < 3) throw new Error("At least three simulation samples required");
  const fitted = Object.fromEntries(Object.entries(residuals).filter(([, rows]) => rows.length)
    .map(([key, rows]) => [key, rows.reduce((s, v) => s + v, 0) / rows.length]));
  const floor = Math.min(...Object.values(fitted));
  const offsets = Object.fromEntries(DISPLAY_RECIPE_KEYS.map(key => [key, fitted[key] ?? floor]));
  const mean = observations.reduce((s, x) => s + x.y, 0) / observations.length;
  const total = observations.reduce((s, x) => s + (x.y - mean) ** 2, 0);
  const error = observations.reduce((s, x) => s + (x.y - x.curve - offsets[x.role]) ** 2, 0);
  return {...source, type_source: "best_role", weights_source: "display_recipes",
    fit: {...source.fit, offset: offsets, n_samples: observations.length, r2_log: total ? 1 - error / total : 0},
    refit: {calibration: "pending_owner_target", counts: Object.fromEntries(Object.entries(residuals).map(([k,v])=>[k,v.length])),
      unsampled_roles: DISPLAY_RECIPE_KEYS.filter(key => !residuals[key].length)}};
}
