import { test } from "node:test";
import assert from "node:assert/strict";
import { ABILITY_KEYS, ABILITY_SHORT, topAbilityKey } from "./abilities.js";

// #2000 — topAbilityKey driver type-label-fallbacken på rytterprofilen når
// riders.primary_type mangler. Den erstatter den gamle PCM-stat_*-afledning, så
// rytterprofilen ikke længere læser legacy-kolonner til visning.

test("topAbilityKey vælger den højeste evne", () => {
  const abilities = { climbing: 40, sprint: 82, flat: 55 };
  assert.equal(topAbilityKey(abilities), "sprint");
});

test("topAbilityKey bryder uafgjort mod den første evne i ABILITY_KEYS-rækkefølge", () => {
  // climbing kommer før time_trial i ABILITY_KEYS → climbing vinder ved lige værdi.
  const abilities = { time_trial: 70, climbing: 70 };
  assert.equal(topAbilityKey(abilities), "climbing");
});

test("topAbilityKey returnerer null for null/undefined", () => {
  assert.equal(topAbilityKey(null), null);
  assert.equal(topAbilityKey(undefined), null);
});

test("topAbilityKey returnerer null når ingen numeriske værdier findes", () => {
  assert.equal(topAbilityKey({ climbing: null, sprint: undefined, foo: "bar" }), null);
});

test("topAbilityKey ignorerer ikke-numeriske felter", () => {
  const abilities = { rider_id: "abc", formula_version: 3, climbing: 20, sprint: 5 };
  // formula_version er metadata på rækken, men numerisk — vi itererer kun ABILITY_KEYS,
  // så den tælles aldrig med.
  assert.equal(topAbilityKey(abilities), "climbing");
});

test("topAbilityKey håndterer en alle-nul-række (vælger første evne)", () => {
  const abilities = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 0]));
  assert.equal(topAbilityKey(abilities), ABILITY_KEYS[0]);
});

test("hver ABILITY_KEY har en kort label (parity-guard)", () => {
  for (const key of ABILITY_KEYS) {
    assert.equal(typeof ABILITY_SHORT[key], "string", `ABILITY_SHORT mangler ${key}`);
  }
});
