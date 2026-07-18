import test from "node:test";
import assert from "node:assert/strict";
import { toggleRider, validateSelectionClient, pickFallbackCaptain } from "./raceSelectionLogic.js";

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

// #2637: requireFull=false — en skadet rytter skal altid kunne fjernes fra en allerede
// gemt/auto-udtaget trup, selv når det efterlader en delvis trup. Backend tillader en
// delvis trup for ethvert efterfølgende gem (ejer 28/6, afløser #1906); requireFull=true
// forbliver default så en FØRSTEGANGS-udtagelse stadig guides mod en fuld trup.
test("validateSelectionClient: requireFull=false tillader en delvis trup (#2637, fjernelse af skadet rytter)", () => {
  const partial = validateSelectionClient({
    riderIds: ["a", "b", "c", "d", "e"], captainId: "a", sprintCaptainId: null, hunterId: null,
    size: { min: 6, max: 8 }, availableCount: 10, requireFull: false,
  });
  assert.ok(!partial.includes("selection_wrong_size"), "delvis trup er OK når requireFull=false");
  assert.ok(!partial.includes("selection_insufficient_riders"));
  // Stadig over feltstørrelsen → afvist uanset requireFull.
  const overMax = validateSelectionClient({
    riderIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"], captainId: "a", sprintCaptainId: null, hunterId: null,
    size: { min: 6, max: 8 }, availableCount: 10, requireFull: false,
  });
  assert.ok(overMax.includes("selection_wrong_size"), "over feltstørrelsen afvises stadig");
  // requireFull udeladt (default true) → uændret #1906-adfærd.
  const defaultBehavior = validateSelectionClient({
    riderIds: ["a", "b", "c", "d", "e"], captainId: "a", sprintCaptainId: null, hunterId: null,
    size: { min: 6, max: 8 }, availableCount: 10,
  });
  assert.ok(defaultBehavior.includes("selection_wrong_size"), "default (requireFull=true) kræver stadig fuld trup");
});

test("pickFallbackCaptain: vælger højest suitability, ekskl. sprint/jæger (#2028)", () => {
  const suit = { a: 40, b: 90, c: 70, d: 95 };
  const suitabilityOf = (id) => suit[id];
  // d højest (95) men er jæger → ekskluderes; b næsthøjest (90) bliver kaptajn.
  assert.equal(pickFallbackCaptain({ riderIds: ["a", "b", "c", "d"], sprintId: null, hunterId: "d", suitabilityOf }), "b");
});

test("pickFallbackCaptain: tiebreak rider_id asc ved lige suitability (deterministisk)", () => {
  assert.equal(pickFallbackCaptain({ riderIds: ["c", "a", "b"], suitabilityOf: () => 50 }), "a");
});

test("pickFallbackCaptain: alle kandidater har anden rolle → fald tilbage til hele feltet", () => {
  const suit = { a: 30, b: 80 };
  assert.equal(pickFallbackCaptain({ riderIds: ["a", "b"], sprintId: "a", hunterId: "b", suitabilityOf: (id) => suit[id] }), "b");
});

test("pickFallbackCaptain: tom trup → null; manglende suitability → deterministisk (id asc)", () => {
  assert.equal(pickFallbackCaptain({ riderIds: [], suitabilityOf: () => 0 }), null);
  assert.equal(pickFallbackCaptain({ riderIds: ["b", "a"], suitabilityOf: () => undefined }), "a");
});
