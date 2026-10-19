import test from "node:test";
import assert from "node:assert/strict";
import { RACE_IDENTITY_TYPES, SIGNATURE_KINDS, TIER_IDENTITY_DISTRIBUTION, validateSignature, validateAuthoredRoute } from "./raceIdentityTypes.js";

const climb = () => ({ kind: "climb", name: "Oude Kwaremberg", category: "2", length_km: 2.2, avg_gradient: 9.5, stage_hint: "queen", summit_finish: true });
const route = () => ({ profile_type: "cobbles", finale_type: "reduced_sprint", distance_km: 260, elevation_gain_m: 700, climbs: [], sprints: [{ name: "Finish", km: 260, kind: "finish" }], sectors: [{ kind: "cobbles", name: "Bospoort", start_km: 100, length_km: 2 }] });

test("vocabulary and allocation support every owner-approved short-race type", () => {
  assert.equal(RACE_IDENTITY_TYPES.length, 8);
  assert.deepEqual(SIGNATURE_KINDS, ["climb", "summit_finish", "itt", "prologue", "sector"]);
  assert.deepEqual(Object.values(TIER_IDENTITY_DISTRIBUTION).map(d => Object.values(d).reduce((a, b) => a + b, 0)), [13, 19, 16, 17]);
  assert.equal(TIER_IDENTITY_DISTRIBUTION[1].climbers_gt_prelude, 3);
  assert.ok(Object.isFrozen(TIER_IDENTITY_DISTRIBUTION[1]));
});

test("null preserves legacy behavior; all five signature kinds have valid forms", () => {
  assert.equal(validateSignature(null), true);
  assert.equal(validateAuthoredRoute(null), true);
  for (const feature of [climb(), { ...climb(), kind: "summit_finish" }, { kind: "itt", stage_hint: "last", band: "hilly" }, { kind: "prologue", stage_hint: "first", band: "flat" }, { kind: "sector", stage_hint: "any", surface: "cobbles", name: "Bospoort", length_km: 2 }]) {
    assert.equal(validateSignature({ features: [feature] }), true);
  }
  assert.equal(validateSignature({ features: [climb(), { kind: "itt", stage_hint: "last", band: "hilly" }] }), true);
});

test("signature rejects malformed values and typos with the offending field path", () => {
  for (const invalid of [undefined, false, [], {}, { features: [] }, { features: [climb(), climb(), climb()] }, { features: [null] }]) assert.throws(() => validateSignature(invalid), /signature/);
  for (const [field, value] of [["kind", "unknown"], ["stage_hint", "middle"], ["length_km", 0], ["length_km", "2"], ["avg_gradient", Infinity], ["avg_gradient", -1], ["category", "5"], ["name", " "], ["summit_finish", "yes"], ["typo", true]]) {
    assert.throws(() => validateSignature({ features: [{ ...climb(), [field]: value }] }), new RegExp(field));
  }
  assert.throws(() => validateSignature({ features: [{ kind: "itt", stage_hint: "last", band: "mountain" }] }), /band/);
  assert.throws(() => validateSignature({ features: [{ kind: "prologue", stage_hint: "last", band: "flat" }] }), /stage_hint/);
  assert.throws(() => validateSignature({ features: [{ ...climb(), kind: "summit_finish", summit_finish: false }] }), /summit_finish/);
});

test("authored routes validate existing stage route shapes without mutation", () => {
  const r = route();
  r.climbs = [{ name: "Paterhelling", category: "4", crest_km: 200, length_km: 1, avg_gradient: 8, summit_finish: false }];
  const before = structuredClone(r);
  assert.equal(validateAuthoredRoute(r), true);
  assert.deepEqual(r, before);
});

test("authored route rejects missing fields, invalid numbers and out-of-route features", () => {
  for (const key of Object.keys(route())) { const r = route(); delete r[key]; assert.throws(() => validateAuthoredRoute(r), new RegExp(key)); }
  for (const [key, value] of [["profile_type", "bad"], ["finale_type", null], ["distance_km", NaN], ["distance_km", -1], ["elevation_gain_m", -1], ["climbs", {}], ["segments", []]]) assert.throws(() => validateAuthoredRoute({ ...route(), [key]: value }), new RegExp(key));
  assert.throws(() => validateAuthoredRoute({ ...route(), sectors: [{ ...route().sectors[0], start_km: 259 }] }), /sectors/);
  assert.throws(() => validateAuthoredRoute({ ...route(), sprints: [{ name: "Finish", km: 261, kind: "finish" }] }), /sprints/);
  assert.throws(() => validateAuthoredRoute({ ...route(), climbs: [{ name: "Hill", category: "4", crest_km: 1, length_km: 2, avg_gradient: 5, summit_finish: false }] }), /climbs/);
  assert.throws(() => validateAuthoredRoute({ ...route(), climbs: [{ name: "Hill", category: "4", crest_km: 200, length_km: 2, avg_gradient: 5, summit_finish: true }] }), /summit_finish/);
});
