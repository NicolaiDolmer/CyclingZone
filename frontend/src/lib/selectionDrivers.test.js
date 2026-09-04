import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeChanceBand,
  tacticalDemand,
  tacticsFitBand,
  riderFitDrivers,
  TACTICAL_DEMAND,
} from "./selectionDrivers.js";

// ── escapeChanceBand: tærskler <15 low · <30 medium · else high ────────────
test("escapeChanceBand: tærskler", () => {
  assert.equal(escapeChanceBand(0), "low");
  assert.equal(escapeChanceBand(14), "low");
  assert.equal(escapeChanceBand(15), "medium");
  assert.equal(escapeChanceBand(29), "medium");
  assert.equal(escapeChanceBand(30), "high");
  assert.equal(escapeChanceBand(89), "high");
});

test("escapeChanceBand: manglende/ikke-endelig → null", () => {
  assert.equal(escapeChanceBand(null), null);
  assert.equal(escapeChanceBand(undefined), null);
  assert.equal(escapeChanceBand(NaN), null);
});

// ── tacticalDemand: SPEJLER raceStageProfileGenerator.js DEMAND_VECTORS.tactics ──
// Drift-guard (samme mønster som roleHint.test.js BREAKAWAY_STRENGTH): hvis
// backend-vægtene ændres uden at denne konstant opdateres, skal en agent der
// læser begge filer opdage uoverensstemmelsen. Værdier pr. 2026-08-04:
// flat=0, rolling=0.06, hilly=0, mountain=0.02, high_mountain=0.02, itt=0,
// ttt=0.18, cobbles=0, classic=0.04.
test("tacticalDemand: spejler DEMAND_VECTORS.tactics-vægt pr. profil", () => {
  assert.equal(tacticalDemand("flat"), "none");
  assert.equal(tacticalDemand("hilly"), "none");
  assert.equal(tacticalDemand("itt"), "none");
  assert.equal(tacticalDemand("cobbles"), "none");
  assert.equal(tacticalDemand("rolling"), "light");
  assert.equal(tacticalDemand("mountain"), "light");
  assert.equal(tacticalDemand("high_mountain"), "light");
  assert.equal(tacticalDemand("classic"), "light");
  assert.equal(tacticalDemand("ttt"), "high");
});

test("tacticalDemand: ukendt/manglende profil → none", () => {
  assert.equal(tacticalDemand("nonsense"), "none");
  assert.equal(tacticalDemand(null), "none");
  assert.equal(tacticalDemand(undefined), "none");
});

test("TACTICAL_DEMAND: nøjagtig elleve profiltyper (ingen glemt/tilføjet) (#3546: itt_hilly · #4105: gravel)", () => {
  assert.deepEqual(Object.keys(TACTICAL_DEMAND).sort(), [
    "classic", "cobbles", "flat", "gravel", "high_mountain", "hilly", "itt", "itt_hilly", "mountain", "rolling", "ttt",
  ]);
});

// ── tacticsFitBand: tærskler <30 poor · <50 average · else strong ──────────
test("tacticsFitBand: tærskler", () => {
  assert.equal(tacticsFitBand(0), "poor");
  assert.equal(tacticsFitBand(29), "poor");
  assert.equal(tacticsFitBand(30), "average");
  assert.equal(tacticsFitBand(49), "average");
  assert.equal(tacticsFitBand(50), "strong");
  assert.equal(tacticsFitBand(85), "strong");
});

test("tacticsFitBand: manglende/ikke-endelig → null", () => {
  assert.equal(tacticsFitBand(null), null);
  assert.equal(tacticsFitBand(undefined), null);
  assert.equal(tacticsFitBand(NaN), null);
});

// ── riderFitDrivers: kombinerer de to signaler, gated på relevans ──────────
test("riderFitDrivers: udbrud muligt + taktisk etape → begge signaler", () => {
  const rider = { aggression: 45, tactics: 60 };
  const lines = riderFitDrivers(rider, { profileType: "rolling", breakawayStrength: "medium" });
  assert.deepEqual(lines, [
    { kind: "escape", band: "high" },
    { kind: "tactics", band: "strong", demand: "light" },
  ]);
});

test("riderFitDrivers: udbrud IKKE muligt (breakawayStrength=none) → intet escape-signal", () => {
  const rider = { aggression: 45, tactics: 60 };
  const lines = riderFitDrivers(rider, { profileType: "rolling", breakawayStrength: "none" });
  assert.deepEqual(lines, [{ kind: "tactics", band: "strong", demand: "light" }]);
});

test("riderFitDrivers: profil uden taktik-vægt (flat) → intet taktik-signal", () => {
  const rider = { aggression: 45, tactics: 60 };
  const lines = riderFitDrivers(rider, { profileType: "flat", breakawayStrength: "high" });
  assert.deepEqual(lines, [{ kind: "escape", band: "high" }]);
});

test("riderFitDrivers: hverken udbrud eller taktik relevant → tomt array", () => {
  const rider = { aggression: 45, tactics: 60 };
  assert.deepEqual(riderFitDrivers(rider, { profileType: "itt", breakawayStrength: "none" }), []);
  assert.deepEqual(riderFitDrivers(rider, { profileType: null, breakawayStrength: null }), []);
});

test("riderFitDrivers: manglende evne-data → droppes selvom kontekst er relevant", () => {
  const rider = { aggression: null, tactics: null };
  assert.deepEqual(riderFitDrivers(rider, { profileType: "ttt", breakawayStrength: "none" }), []);
  assert.deepEqual(riderFitDrivers(rider, { profileType: "flat", breakawayStrength: "high" }), []);
});

test("riderFitDrivers: manglende rider-objekt → tomt array (defensivt)", () => {
  assert.deepEqual(riderFitDrivers(undefined, { profileType: "ttt", breakawayStrength: "high" }), []);
  assert.deepEqual(riderFitDrivers(null, { profileType: "ttt", breakawayStrength: "high" }), []);
});
