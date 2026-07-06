import test from "node:test";
import assert from "node:assert/strict";
import {
  STAFF_ROLES,
  LEVEL_BANDS,
  DIMENSION_TO_ABILITIES,
  TIER_OVERALL_BAND,
  riderLevelBand,
} from "./staffAbilityConstants.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

test("STAFF_ROLES = de 5 roller", () => {
  assert.deepEqual(STAFF_ROLES, ["training", "scouting", "medical", "academy", "commercial"]);
});

test("LEVEL_BANDS = youth/junior/senior", () => {
  assert.deepEqual(LEVEL_BANDS, ["youth", "junior", "senior"]);
});

test("DIMENSION_TO_ABILITIES grupperer physical(10)/mental(2)/technical(3)", () => {
  assert.equal(DIMENSION_TO_ABILITIES.physical.length, 10);
  assert.equal(DIMENSION_TO_ABILITIES.mental.length, 2);
  assert.equal(DIMENSION_TO_ABILITIES.technical.length, 3);
});

test("drift-guard: union af DIMENSION_TO_ABILITIES == VISIBLE_ABILITIES (præcis partition)", () => {
  const union = [
    ...DIMENSION_TO_ABILITIES.physical,
    ...DIMENSION_TO_ABILITIES.mental,
    ...DIMENSION_TO_ABILITIES.technical,
  ];
  // ingen duplikater
  assert.equal(new Set(union).size, union.length, "duplikat i dimension-mapping");
  // samme mængde som VISIBLE_ABILITIES (rækkefølge-uafhængig)
  assert.deepEqual([...union].sort(), [...VISIBLE_ABILITIES].sort());
});

test("TIER_OVERALL_BAND: lo<hi pr. tier og monotont stigende 1→5", () => {
  for (const tier of [1, 2, 3, 4, 5]) {
    const band = TIER_OVERALL_BAND[tier];
    assert.ok(band && Number.isFinite(band.lo) && Number.isFinite(band.hi), `tier ${tier} mangler bånd`);
    assert.ok(band.lo < band.hi, `tier ${tier} lo skal være < hi`);
  }
  for (const tier of [2, 3, 4, 5]) {
    assert.ok(TIER_OVERALL_BAND[tier].lo > TIER_OVERALL_BAND[tier - 1].lo, `lo ikke stigende tier ${tier}`);
    assert.ok(TIER_OVERALL_BAND[tier].hi > TIER_OVERALL_BAND[tier - 1].hi, `hi ikke stigende tier ${tier}`);
  }
});

test("riderLevelBand: youth (academy && age<=21), senior (age>=26), junior ellers", () => {
  assert.equal(riderLevelBand({ is_academy: true, age: 19 }), "youth");
  assert.equal(riderLevelBand({ is_academy: true, age: 21 }), "youth");
  // academy men over 21 → ikke youth
  assert.equal(riderLevelBand({ is_academy: true, age: 22 }), "junior");
  assert.equal(riderLevelBand({ is_academy: false, age: 19 }), "junior"); // ikke-academy ung = junior
  assert.equal(riderLevelBand({ is_academy: false, age: 24 }), "junior");
  assert.equal(riderLevelBand({ is_academy: false, age: 26 }), "senior");
  assert.equal(riderLevelBand({ is_academy: false, age: 30 }), "senior");
});
