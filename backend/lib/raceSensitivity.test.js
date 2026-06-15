import test from "node:test";
import assert from "node:assert/strict";

import { abilityRankSensitivity, SENSITIVITY_DELTA } from "./raceSensitivity.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

// Minimal deterministic field: 60 riders, every ability seeded by index so the
// pool has spread. `overall` is required by the probe (median-overall selection).
function makeField(n = 60) {
  const field = [];
  for (let i = 0; i < n; i++) {
    const abilities = {};
    for (const k of ABILITY_KEYS) abilities[k] = 30 + ((i * 7 + k.length) % 60); // 30..89 spread
    field.push({ id: `r${i}`, overall: 40 + (i % 50), abilities });
  }
  return field;
}

test("abilityRankSensitivity er deterministisk (samme felt+seed → samme tal)", () => {
  const field = makeField();
  const a = abilityRankSensitivity({ field, profileType: "flat", demandVector: DEMAND_VECTORS.flat, ability: "sprint", seed: 2026, samples: 40, fieldSize: 30 });
  const b = abilityRankSensitivity({ field, profileType: "flat", demandVector: DEMAND_VECTORS.flat, ability: "sprint", seed: 2026, samples: 40, fieldSize: 30 });
  assert.equal(a, b);
});

test("en demand-vægtet evne giver positiv rank-gevinst (sprint på flad)", () => {
  const field = makeField();
  const gain = abilityRankSensitivity({ field, profileType: "flat", demandVector: DEMAND_VECTORS.flat, ability: "sprint", seed: 2026, samples: 80, fieldSize: 40 });
  assert.ok(gain > 0.05, `sprint på flad burde rykke placeringen, fik ${gain}`);
});

test("en ikke-vægtet evne giver ≈0 rank-gevinst (climbing på flad)", () => {
  const field = makeField();
  const gain = abilityRankSensitivity({ field, profileType: "flat", demandVector: DEMAND_VECTORS.flat, ability: "climbing", seed: 2026, samples: 80, fieldSize: 40 });
  assert.ok(Math.abs(gain) < 0.05, `climbing burde være dødt på flad, fik ${gain}`);
});

test("SENSITIVITY_DELTA er en fornuftig perturbation", () => {
  assert.ok(SENSITIVITY_DELTA >= 8 && SENSITIVITY_DELTA <= 20);
});
