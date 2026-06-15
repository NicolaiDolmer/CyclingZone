import test from "node:test";
import assert from "node:assert/strict";

import { abilityRankSensitivity, breakawayParticipationGapByAggression, SENSITIVITY_DELTA } from "./raceSensitivity.js";
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

test("breakawayParticipationGapByAggression: høj-aggression deltager mere i udbrud (#1122)", () => {
  const field = [];
  for (let i = 0; i < 60; i++) {
    const abilities = {};
    for (const k of ABILITY_KEYS) abilities[k] = 50;
    abilities.aggression = i < 30 ? 15 : 90; // halvdelen lav, halvdelen høj aggression
    field.push({ id: `r${i}`, overall: 50, abilities });
  }
  const gap = breakawayParticipationGapByAggression({ field, profileType: "mountain", demandVector: DEMAND_VECTORS.mountain, races: 120, fieldSize: 40, seed: 2026 });
  assert.ok(gap > 0, `høj-aggression skal deltage mere i udbrud, gap=${gap}`);
});

test("breakawayParticipationGapByAggression er deterministisk", () => {
  const field = [];
  for (let i = 0; i < 60; i++) {
    const abilities = {};
    for (const k of ABILITY_KEYS) abilities[k] = 40 + (i % 50);
    field.push({ id: `r${i}`, overall: 50, abilities });
  }
  const a = breakawayParticipationGapByAggression({ field, profileType: "mountain", demandVector: DEMAND_VECTORS.mountain, races: 60, fieldSize: 40, seed: 2026 });
  const b = breakawayParticipationGapByAggression({ field, profileType: "mountain", demandVector: DEMAND_VECTORS.mountain, races: 60, fieldSize: 40, seed: 2026 });
  assert.equal(a, b);
});
