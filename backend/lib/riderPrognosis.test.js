import test from "node:test";
import assert from "node:assert/strict";

import {
  prognoseAbilityEndpoint,
  prognoseAbilities,
  prognoseAbilityBands,
  PROGNOSIS_ENVELOPES,
} from "./riderPrognosis.js";
import { peakAgeForType, ROLE_CLASS_RATE } from "./riderProgression.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";

// Rytter med luft til alle 15 synlige evner (langt under ethvert rolle-tag,
// så vækst aldrig er nul af en tilfældighed).
const NOW = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 20 + (i % 5) * 3]));

test("prognoseAbilityEndpoint er deterministisk (samme input → samme output)", () => {
  const args = {
    current: 30, cap: 80, age: 18, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.5, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  };
  assert.equal(prognoseAbilityEndpoint(args), prognoseAbilityEndpoint({ ...args }));
});

test("prognoseAbilityEndpoint: gap 0 giver ingen vækst", () => {
  const v = prognoseAbilityEndpoint({
    current: 70, cap: 70, age: 18, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.89, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  assert.equal(v, 70);
});

test("prognoseAbilityEndpoint: dedikeret envelope når mindst lige så langt som spredt", () => {
  const base = {
    current: 30, cap: 90, age: 17, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.6,
  };
  const spredt = prognoseAbilityEndpoint({ ...base, envelope: PROGNOSIS_ENVELOPES.spredt });
  const dedikeret = prognoseAbilityEndpoint({ ...base, envelope: PROGNOSIS_ENVELOPES.dedikeret });
  assert.ok(dedikeret >= spredt, `dedikeret (${dedikeret}) skal nå mindst lige så langt som spredt (${spredt})`);
});

test("prognoseAbilityEndpoint: clamp [0,99]", () => {
  const v = prognoseAbilityEndpoint({
    current: 98, cap: 99, age: 16, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.89, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  assert.ok(v >= 0 && v <= 99);
});

test("prognoseAbilities: post-peak-rytter giver endpoint = nuværende evne (ingen vækst efter peak)", () => {
  const type = "climber";
  const peakAge = peakAgeForType(type);
  const out = prognoseAbilities({
    nowAbilities: NOW, age: peakAge + 3, primaryType: type, secondaryType: null,
    potentiale: 6, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  for (const [ability, endpoint] of Object.entries(out)) {
    assert.equal(endpoint, Math.round(Math.max(0, Math.min(99, NOW[ability]))), `${ability}: post-peak skal stå stille`);
  }
});

test("prognoseAbilities er deterministisk", () => {
  const args = {
    nowAbilities: NOW, age: 19, primaryType: "sprinter", secondaryType: "puncheur",
    potentiale: 4, envelope: PROGNOSIS_ENVELOPES.spredt,
  };
  assert.deepEqual(prognoseAbilities(args), prognoseAbilities({ ...args }));
});

test("prognoseAbilityBands: lo <= hi for alle evner, heltal", () => {
  const bands = prognoseAbilityBands({
    nowAbilities: NOW, age: 19, primaryType: "gc", secondaryType: "climber",
    potLo: 2.5, potHi: 5.5,
  });
  for (const [ability, b] of Object.entries(bands)) {
    assert.ok(Number.isInteger(b.lo) && Number.isInteger(b.hi), ability);
    assert.ok(b.lo <= b.hi, `${ability}: lo ${b.lo} > hi ${b.hi}`);
  }
});

test("prognoseAbilityBands: post-peak-rytter giver bånd = nuværende evne (lo == hi == now)", () => {
  const type = "rouleur";
  const peakAge = peakAgeForType(type);
  const bands = prognoseAbilityBands({
    nowAbilities: NOW, age: peakAge + 5, primaryType: type, secondaryType: null,
    potLo: 1, potHi: 6,
  });
  for (const [ability, b] of Object.entries(bands)) {
    const now = Math.round(Math.max(0, Math.min(99, NOW[ability])));
    assert.equal(b.lo, now, `${ability} lo`);
    assert.equal(b.hi, now, `${ability} hi`);
  }
});

test("prognoseAbilityBands er deterministisk på tværs af to kald", () => {
  const args = {
    nowAbilities: NOW, age: 20, primaryType: "baroudeur", secondaryType: "tt",
    potLo: 3, potHi: 5,
  };
  assert.deepEqual(prognoseAbilityBands(args), prognoseAbilityBands({ ...args }));
});

test("PROGNOSIS_ENVELOPES: dedikeret > spredt (definitionen af de to træningsstile)", () => {
  assert.ok(PROGNOSIS_ENVELOPES.dedikeret > PROGNOSIS_ENVELOPES.spredt);
});
