import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTypeCeilingBands,
  buildVerdict,
  ratingFromAbilities,
} from "./scoutingReport.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { ratingForRole } from "./weights/displayRecipes.js";

const CAPS = {
  climbing: 80, time_trial: 60, flat: 55, tempo: 70, sprint: 40, acceleration: 45,
  punch: 65, endurance: 72, recovery: 68, durability: 66, descending: 58,
  cobblestone: 35, aggression: 50,
};
const NOW = Object.fromEntries(Object.entries(CAPS).map(([k, v]) => [k, v - 15]));

// #3666: ankrene RATING_ALPHA/O_ELITE/O_MIN findes ikke længere — modellen er
// absolut og har ingen populations-ankre at holde i sync. Sync-guarden mod
// frontend er flyttet til drift-vagten i abilityRegistryGuards.test.js, som
// sammenligner den GENEREREDE frontend-fil byte for byte med generator-outputtet.
// Det er en stærkere garanti end tre håndholdte tal der skulle huskes to steder
// — og præcis den slags kopi der allerede havde drevet ubemærket (spec §1.5).
test("ratingFromAbilities ER visnings-opskriften, ikke en model ved siden af", () => {
  for (const key of RIDER_TYPE_KEYS) {
    assert.equal(ratingFromAbilities(CAPS, key), ratingForRole(CAPS, key));
    assert.equal(ratingFromAbilities(NOW, key), ratingForRole(NOW, key));
  }
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

test("loft-bånd: gulv fra dårlig spejder (#2244) gør fuldt-scoutet-bredden ≥ topspejder", () => {
  const width = (scout) => {
    const b = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level: 3, riderId: "r1", teamId: "t1", scout });
    return b[0].ceilHi - b[0].ceilLo;
  };
  assert.ok(width({ overall: 40 }) >= width({ overall: 99 }), "overall 40 skal give ≥ bånd end overall 99 ved fuldt niveau");
});

test("loft-bånd: default-scout (uden hyret spejder) matcher eksplicit overall 40", () => {
  const withDefault = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level: 3, riderId: "r1", teamId: "t1" });
  const withExplicit = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level: 3, riderId: "r1", teamId: "t1", scout: { overall: 40 } });
  assert.deepEqual(withDefault, withExplicit);
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

// #3666: tærsklerne 2/3/8 er MÅLT, ikke valgt — heltalssøgning der bedst
// reproducerer dagens fordeling af domme over hele bestanden efter at
// gap-medianen falder fra 38 til 26 point. De øvrige verdict-tests bruger gaps
// i sikker afstand fra grænserne og ville derfor bestå med både de gamle og de
// nye tal. Denne tester præcis grænserne, så en fremtidig ændring er et bevidst
// valg og ikke en afrunding.
const verdictAt = (gap, age = 21) =>
  buildVerdict({ age, own: true, level: 3, maxLevel: 3, bestNow: 40, bestCeilMid: 40 + gap }).headlineKey;

test("verdict: gap-tærsklerne ligger på 2, 3 og 8 (målt, ikke valgt)", () => {
  // 8 = grænsen for stort loft-gap hos en ung rytter
  assert.equal(verdictAt(8), "keep_and_develop");
  assert.equal(verdictAt(7), "monitor");
  // 3 = grænsen for "hold øje"
  assert.equal(verdictAt(3, 27), "monitor");
  assert.equal(verdictAt(2, 27), "solid_contributor");
  // 2 = grænsen for "tæt på sit loft" hos en ældre rytter
  assert.equal(verdictAt(1, 33), "past_peak");
  assert.equal(verdictAt(2, 33), "solid_contributor");
});

test("verdict: near_ceiling-faktoren følger samme grænse som past_peak", () => {
  const paa = buildVerdict({ age: 27, own: true, level: 3, maxLevel: 3, bestNow: 40, bestCeilMid: 41 });
  assert.ok(paa.factorKeys.includes("near_ceiling"), "gap 1 er under tærsklen 2");
  const over = buildVerdict({ age: 27, own: true, level: 3, maxLevel: 3, bestNow: 40, bestCeilMid: 42 });
  assert.ok(!over.factorKeys.includes("near_ceiling"), "gap 2 er PÅ tærsklen og tæller ikke");
});
