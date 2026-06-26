import test from "node:test";
import assert from "node:assert/strict";
import { toggleRider, validateSelectionClient } from "./raceSelectionLogic.js";

test("toggleRider: tilføjer/fjerner og respekterer max + rydder roller for fjernet rytter", () => {
  const s0 = { riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null };
  const s1 = toggleRider(s0, "a", 8);
  assert.deepEqual(s1.riderIds, ["a"]);
  const s2 = toggleRider({ ...s1, captainId: "a" }, "a", 8);
  assert.deepEqual(s2.riderIds, []);
  assert.equal(s2.captainId, null, "rolle ryddes når rytteren fravælges");
  const full = { riderIds: ["a", "b", "c", "d", "e", "f", "g", "h"], captainId: "a", sprintCaptainId: null, hunterId: null };
  assert.equal(toggleRider(full, "i", 8), full, "max nået → uændret state");
});

test("validateSelectionClient: spejl af backend-koderne (#1906 fuld opstilling)", () => {
  // Fuld trup (8 på {6,8}) + kaptajn → ingen fejl.
  const ok = validateSelectionClient({ riderIds: ["a","b","c","d","e","f","g","h"], captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 });
  assert.deepEqual(ok, []);
  // Delvis trup (6 af 8 pladser) → wrong_size.
  assert.ok(validateSelectionClient({ riderIds: ["a","b","c","d","e","f"], captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 }).includes("selection_wrong_size"));
  // For få raske ryttere (kun 5 til 8 pladser) → insufficient (afmeld/hent fri-agenter).
  assert.ok(validateSelectionClient({ riderIds: ["a","b","c","d","e"], captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 5 }).includes("selection_insufficient_riders"));
  assert.ok(validateSelectionClient({ riderIds: ["a","b","c","d","e","f","g","h"], captainId: null, sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 }).includes("selection_captain_required"));
  assert.ok(validateSelectionClient({ riderIds: ["a","b","c","d","e","f","g","h"], captainId: "a", sprintCaptainId: "a", hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 }).includes("selection_role_overlap"));
});
