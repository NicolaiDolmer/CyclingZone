import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTypeCeilingBands,
  buildVerdict,
  ratingFromAbilities,
  RATING_ALPHA,
  RATING_O_ELITE,
  RATING_O_MIN,
} from "./scoutingReport.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";

const CAPS = {
  climbing: 80, time_trial: 60, flat: 55, tempo: 70, sprint: 40, acceleration: 45,
  punch: 65, endurance: 72, recovery: 68, durability: 66, descending: 58,
  cobblestone: 35, aggression: 50,
};
const NOW = Object.fromEntries(Object.entries(CAPS).map(([k, v]) => [k, v - 15]));

test("ankre matcher frontend riderRating.js (manuel sync-guard)", () => {
  assert.equal(RATING_ALPHA, 0.5);
  assert.equal(RATING_O_ELITE, 67.38);
  assert.equal(RATING_O_MIN, 2.04);
});

test("ratingFromAbilities: heltal i [1,99], stiger med evner", () => {
  const lo = ratingFromAbilities(NOW, "climber");
  const hi = ratingFromAbilities(CAPS, "climber");
  assert.ok(Number.isInteger(lo) && Number.isInteger(hi));
  assert.ok(lo >= 1 && hi <= 99 && hi > lo);
});

test("loft-bånd: alle typer, heltal, clamp [1,99], ceilLo >= now, lo <= hi", () => {
  const bands = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level: 1, riderId: "r1", teamId: "t1" });
  assert.equal(bands.length, RIDER_TYPE_KEYS.length);
  for (const b of bands) {
    assert.ok(Number.isInteger(b.now) && Number.isInteger(b.ceilLo) && Number.isInteger(b.ceilHi), b.key);
    assert.ok(b.ceilLo >= b.now, `${b.key}: ceilLo ${b.ceilLo} < now ${b.now}`);
    assert.ok(b.ceilHi >= b.ceilLo && b.ceilHi <= 99 && b.ceilLo >= 1, b.key);
  }
});

test("loft-bånd indsnævres med level, men lukker aldrig helt", () => {
  const width = (level) => {
    const b = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level, riderId: "r1", teamId: "t1" });
    return b[0].ceilHi - b[0].ceilLo;
  };
  assert.ok(width(1) >= width(2) && width(2) >= width(3), "bredde skal falde med level");
  assert.ok(width(3) >= 2, "selv fuldt scoutet har et bånd");
});

test("loft-bånd er deterministiske og varierer på tværs af managere (seed)", () => {
  const args = { nowAbilities: NOW, caps: CAPS, level: 1, riderId: "r1" };
  assert.deepEqual(
    buildTypeCeilingBands({ ...args, teamId: "tA" }),
    buildTypeCeilingBands({ ...args, teamId: "tA" }),
  );
  const centers = new Set(
    ["tA", "tB", "tC", "tD"].map((t) => {
      const b = buildTypeCeilingBands({ ...args, teamId: t })[0];
      return `${b.ceilLo}-${b.ceilHi}`;
    })
  );
  assert.ok(centers.size > 1, "forventede varierende bånd på tværs af managere");
});

test("loft-bånd lækker aldrig rå cap-værdier (kun key/now/ceilLo/ceilHi)", () => {
  const bands = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level: 1, riderId: "r1", teamId: "t1" });
  for (const b of bands) {
    assert.deepEqual(Object.keys(b).sort(), ["ceilHi", "ceilLo", "key", "now"]);
  }
});

test("verdict: ungt talent m. stort loft-gap → keep_and_develop (egen) / bid (fremmed)", () => {
  const own = buildVerdict({ age: 19, own: true, level: 3, maxLevel: 3, bestNow: 55, bestCeilMid: 80 });
  assert.equal(own.headlineKey, "keep_and_develop");
  assert.equal(own.confidence, "high");
  assert.equal(own.factorKeys.length, 4);
  const other = buildVerdict({ age: 19, own: false, level: 1, maxLevel: 3, bestNow: 55, bestCeilMid: 80 });
  assert.equal(other.headlineKey, "bid_worth_considering");
  assert.equal(other.confidence, "low");
});

test("verdict: gammel rytter forbi peak → past_peak + decline_risk-faktor", () => {
  const v = buildVerdict({ age: 33, own: false, level: 1, maxLevel: 3, bestNow: 70, bestCeilMid: 71 });
  assert.equal(v.headlineKey, "past_peak");
  assert.ok(v.factorKeys.includes("decline_risk"));
});

test("verdict: moderat gap → monitor; lille gap → solid_contributor", () => {
  assert.equal(buildVerdict({ age: 26, own: false, level: 2, maxLevel: 3, bestNow: 60, bestCeilMid: 68 }).headlineKey, "monitor");
  assert.equal(buildVerdict({ age: 26, own: false, level: 2, maxLevel: 3, bestNow: 60, bestCeilMid: 62 }).headlineKey, "solid_contributor");
});

test("verdict: value_gap-faktor kun ved positivt gap", () => {
  const withGap = buildVerdict({ age: 21, own: false, level: 2, maxLevel: 3, bestNow: 50, bestCeilMid: 70, valueGap: 10000 });
  assert.ok(withGap.factorKeys.includes("value_gap"));
  const noGap = buildVerdict({ age: 21, own: false, level: 2, maxLevel: 3, bestNow: 50, bestCeilMid: 70, valueGap: 0 });
  assert.ok(!noGap.factorKeys.includes("value_gap"));
});
