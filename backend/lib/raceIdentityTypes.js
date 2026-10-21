// Pure authoring contract for #6857. Null retains the existing generator behavior.
import { STAGE_PROFILE_TYPES, STAGE_FINALE_TYPES, SECTOR_KINDS } from "./stageProfileTypes.js";

export const RACE_IDENTITY_TYPES = Object.freeze([
  "sprinters", "climbers_gt_prelude", "hilly", "cobbles_benelux",
  "time_trial", "gravel", "mountains_first", "allround",
]);
export const SIGNATURE_KINDS = Object.freeze(["climb", "summit_finish", "itt", "prologue", "sector"]);
// Owner table A, #6857 (18 October): short stage races only; excludes Grand Tours.
export const TIER_IDENTITY_DISTRIBUTION = Object.freeze({
  1: Object.freeze({ sprinters: 2, climbers_gt_prelude: 3, hilly: 2, cobbles_benelux: 1, time_trial: 1, gravel: 1, mountains_first: 1, allround: 2 }),
  2: Object.freeze({ sprinters: 3, climbers_gt_prelude: 3, hilly: 3, cobbles_benelux: 2, time_trial: 2, gravel: 1, mountains_first: 2, allround: 3 }),
  3: Object.freeze({ sprinters: 3, climbers_gt_prelude: 2, hilly: 3, cobbles_benelux: 2, time_trial: 1, gravel: 1, mountains_first: 1, allround: 3 }),
  4: Object.freeze({ sprinters: 3, climbers_gt_prelude: 2, hilly: 3, cobbles_benelux: 2, time_trial: 2, gravel: 1, mountains_first: 1, allround: 3 }),
});

function fail(path, message) { throw new TypeError(`${path}: ${message}`); }
function object(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, "expected an object");
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, "unknown field");
}
function choice(value, path, values) { if (!values.includes(value)) fail(path, `expected one of ${values.join(", ")}`); }
function text(value, path) { if (typeof value !== "string" || !value.trim()) fail(path, "expected a non-empty string"); }
function number(value, path, { positive = false, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0) || value > max) fail(path, `expected a finite ${positive ? "positive" : "non-negative"} number${Number.isFinite(max) ? ` <= ${max}` : ""}`);
}
function boolean(value, path) { if (typeof value !== "boolean") fail(path, "expected a boolean"); }
function climb(value, path) {
  text(value.name, `${path}.name`);
  choice(value.category, `${path}.category`, ["HC", "1", "2", "3", "4"]);
  number(value.length_km, `${path}.length_km`, { positive: true });
  number(value.avg_gradient, `${path}.avg_gradient`, { positive: true, max: 100 });
  boolean(value.summit_finish, `${path}.summit_finish`);
}

/** Returns true, or throws TypeError with a field path. Never coerces or mutates. */
export function validateSignature(signature) {
  if (signature === null) return true;
  object(signature, "signature", ["features"]);
  if (!Array.isArray(signature.features) || signature.features.length < 1 || signature.features.length > 2) fail("signature.features", "expected 1-2 features");
  signature.features.forEach((feature, index) => {
    const path = `signature.features[${index}]`;
    object(feature, path, ["kind", "stage_hint", "name", "category", "length_km", "avg_gradient", "summit_finish", "band", "surface"]);
    choice(feature.kind, `${path}.kind`, SIGNATURE_KINDS);
    choice(feature.stage_hint, `${path}.stage_hint`, ["first", "last", "queen", "any"]);
    if (feature.kind === "climb" || feature.kind === "summit_finish") {
      object(feature, path, ["kind", "stage_hint", "name", "category", "length_km", "avg_gradient", "summit_finish"]);
      climb(feature, path);
      if (feature.kind === "summit_finish" && !feature.summit_finish) fail(`${path}.summit_finish`, "must be true for summit_finish");
    } else if (feature.kind === "itt" || feature.kind === "prologue") {
      object(feature, path, ["kind", "stage_hint", "band"]);
      choice(feature.band, `${path}.band`, ["flat", "hilly"]);
      if (feature.kind === "prologue" && feature.stage_hint !== "first") fail(`${path}.stage_hint`, "prologue must be first");
    } else {
      object(feature, path, ["kind", "stage_hint", "surface", "name", "length_km"]);
      choice(feature.surface, `${path}.surface`, SECTOR_KINDS);
      text(feature.name, `${path}.name`);
      number(feature.length_km, `${path}.length_km`, { positive: true });
    }
  });
  return true;
}

/** Full authored input only; derived segments/weather/elevation_profile are forbidden. */
export function validateAuthoredRoute(route) {
  if (route === null) return true;
  object(route, "authored_route", ["profile_type", "finale_type", "distance_km", "elevation_gain_m", "climbs", "sprints", "sectors"]);
  choice(route.profile_type, "authored_route.profile_type", STAGE_PROFILE_TYPES);
  choice(route.finale_type, "authored_route.finale_type", STAGE_FINALE_TYPES);
  number(route.distance_km, "authored_route.distance_km", { positive: true });
  number(route.elevation_gain_m, "authored_route.elevation_gain_m");
  for (const key of ["climbs", "sprints", "sectors"]) if (!Array.isArray(route[key])) fail(`authored_route.${key}`, "expected an array");
  route.climbs.forEach((item, index) => {
    const path = `authored_route.climbs[${index}]`;
    object(item, path, ["name", "category", "crest_km", "length_km", "avg_gradient", "summit_finish"]);
    climb(item, path);
    number(item.crest_km, `${path}.crest_km`, { max: route.distance_km });
    if (item.length_km > item.crest_km) fail(path, "climb starts before the route");
    if (item.summit_finish && item.crest_km !== route.distance_km) fail(`${path}.summit_finish`, "summit must coincide with finish");
  });
  route.sprints.forEach((item, index) => {
    const path = `authored_route.sprints[${index}]`;
    object(item, path, ["name", "km", "kind"]);
    text(item.name, `${path}.name`);
    choice(item.kind, `${path}.kind`, ["intermediate", "finish"]);
    number(item.km, `${path}.km`, { max: route.distance_km });
    if (item.kind === "finish" && item.km !== route.distance_km) fail(`${path}.km`, "finish sprint must coincide with finish");
  });
  route.sectors.forEach((item, index) => {
    const path = `authored_route.sectors[${index}]`;
    object(item, path, ["kind", "start_km", "length_km", "name"]);
    choice(item.kind, `${path}.kind`, SECTOR_KINDS);
    text(item.name, `${path}.name`);
    number(item.start_km, `${path}.start_km`, { max: route.distance_km });
    number(item.length_km, `${path}.length_km`, { positive: true });
    if (item.start_km + item.length_km > route.distance_km) fail(path, "sector ends after the route");
  });
  return true;
}
