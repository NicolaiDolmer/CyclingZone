// backend/lib/engine/v4/mechanics/effortCost.test.ts
// Kontrakt-tests + property-test (fast-check, 200 runs, seeded) for M12
// (effort-styring). SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-
// intra-stage-design.md §4 M12; opgave-brief: "effortFatigueMultiplier-
// moensteret fra raceRoles.js genimplementeres RENT i v4".
//
// Testene laaser HENSIGTEN (retning + bounded stoerrelse), ikke implementations-
// detaljer: protect koster MERE end normal, save koster MINDRE end normal,
// ALDRIG omvendt fortegn, og applyEffortToDemand aendrer aldrig fortegn paa
// demand (0 -> 0, positiv -> positiv, aldrig negativ).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { applyEffortToDemand, EFFORT_COST_TUNING, effortDemandMultiplier } from "./effortCost.ts";
import type { EffortLevel } from "../types.ts";

test("effortDemandMultiplier: protect > normal > save (raceRoles FATIGUE_MULTIPLIER-anker: 1.2 / 1.0 / 0.7)", () => {
  const protect = effortDemandMultiplier("protect");
  const normal = effortDemandMultiplier("normal");
  const save = effortDemandMultiplier("save");
  assert.ok(protect > normal, `protect (${protect}) skal koste MERE end normal (${normal})`);
  assert.ok(normal > save, `normal (${normal}) skal koste MERE end save (${save})`);
  assert.equal(protect, EFFORT_COST_TUNING.demandMultiplierProtect);
  assert.equal(normal, EFFORT_COST_TUNING.demandMultiplierNormal);
  assert.equal(save, EFFORT_COST_TUNING.demandMultiplierSave);
});

test("effortDemandMultiplier: normal er neutral (multiplikator 1) med default-tuning", () => {
  assert.equal(effortDemandMultiplier("normal"), 1);
});

test("effortDemandMultiplier: ren funktion — samme effort giver ALTID samme multiplikator", () => {
  const levels: EffortLevel[] = ["protect", "normal", "save"];
  for (const level of levels) {
    const a = effortDemandMultiplier(level);
    const b = effortDemandMultiplier(level);
    assert.equal(a, b);
  }
});

test("effortDemandMultiplier: custom tuning respekteres (ikke hardkodet til default-konstanterne)", () => {
  const customTuning = { demandMultiplierProtect: 2, demandMultiplierNormal: 1, demandMultiplierSave: 0.1 };
  assert.equal(effortDemandMultiplier("protect", customTuning), 2);
  assert.equal(effortDemandMultiplier("save", customTuning), 0.1);
});

test("applyEffortToDemand: skalerer demand, aendrer ALDRIG fortegn (0 -> 0, positiv -> positiv)", () => {
  assert.equal(applyEffortToDemand(0, "protect"), 0);
  assert.equal(applyEffortToDemand(0, "save"), 0);
  assert.ok(applyEffortToDemand(0.5, "protect") > 0);
  assert.ok(applyEffortToDemand(0.5, "save") > 0);
});

test("applyEffortToDemand: negativ demand clampes forsvarsmaessigt til 0 foer skalering", () => {
  assert.equal(applyEffortToDemand(-5, "protect"), 0);
  assert.equal(applyEffortToDemand(-5, "normal"), 0);
});

test("applyEffortToDemand: protect >= normal >= save for samme positive demand (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(fc.float({ min: 0, max: 5, noNaN: true }), (demand) => {
      const protect = applyEffortToDemand(demand, "protect");
      const normal = applyEffortToDemand(demand, "normal");
      const save = applyEffortToDemand(demand, "save");
      assert.ok(protect >= normal - 1e-9, `protect (${protect}) < normal (${normal}) ved demand=${demand}`);
      assert.ok(normal >= save - 1e-9, `normal (${normal}) < save (${save}) ved demand=${demand}`);
      assert.ok(protect >= 0 && normal >= 0 && save >= 0);
    }),
    { numRuns: 200, seed: 4030 },
  );
});

test("determinisme: gentagne kald med samme input giver byte-identisk resultat", () => {
  const a = applyEffortToDemand(0.42, "protect");
  const b = applyEffortToDemand(0.42, "protect");
  assert.equal(a, b);
});
