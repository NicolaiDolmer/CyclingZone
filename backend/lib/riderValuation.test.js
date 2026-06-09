import test from "node:test";
import assert from "node:assert/strict";

import {
  ABILITY_KEYS,
  blendedOutput,
  meanAbilityScore,
  outputScore,
  predictBaseValue,
  riderOverall,
  riderSpecialty,
} from "./riderValuation.js";

const abilities = (val = 50, extra = {}) => {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = val;
  return { ...a, ...extra };
};

test("outputScore averages the positive type-weights (flat abilities → that value)", () => {
  // Alle abilities = 50 → vægtet snit = 50 uanset type.
  assert.equal(outputScore(abilities(50), "gc"), 50);
  assert.equal(outputScore(abilities(50), "sprinter"), 50);
});

test("outputScore rewards a rider strong in their speciale", () => {
  // gc vægter climbing/time_trial/tempo/recovery højt.
  const strongGc = outputScore(abilities(40, { climbing: 90, time_trial: 90, tempo: 90, recovery: 90 }), "gc");
  const weakGc = outputScore(abilities(40), "gc");
  assert.ok(strongGc > weakGc, `stærk gc (${strongGc}) skal slå svag (${weakGc})`);
});

test("outputScore falls back to mean of abilities for unknown type", () => {
  assert.equal(outputScore(abilities(60), null), 60);
  assert.equal(outputScore(abilities(60), "ikke-en-type"), 60);
});

test("predictBaseValue = exp(a + b·output + offset[type])", () => {
  const model = { a: Math.log(1000), b: 0, offset: {} };
  // b=0 → output irrelevant → exp(a) = 1000.
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 1000);
});

test("predictBaseValue applies the type-offset", () => {
  const model = { a: Math.log(1000), b: 0, offset: { gc: Math.log(2) } };
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 2000);
  // Type uden offset → neutral (offset 0).
  assert.equal(predictBaseValue({ primary_type: "sprinter" }, abilities(50), model), 1000);
});

test("predictBaseValue rises with output when b>0", () => {
  const model = { a: 0, b: 0.05, offset: {} };
  const lo = predictBaseValue({ primary_type: "gc" }, abilities(40), model);
  const hi = predictBaseValue({ primary_type: "gc" }, abilities(80), model);
  assert.ok(hi > lo, `højere output skal give højere værdi (${hi} > ${lo})`);
});

test("predictBaseValue returns null when abilities are missing", () => {
  const model = { a: 1, b: 0.1, offset: {} };
  assert.equal(predictBaseValue({ primary_type: "gc" }, {}, model), null);
  assert.equal(predictBaseValue({ primary_type: "gc" }, null, model), null);
});

test("predictBaseValue returns null without a usable model", () => {
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(), null), null);
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(), { offset: {} }), null);
});

test("predictBaseValue has no floor (worst riders can be small)", () => {
  // Lav a + lav output → lille værdi, ingen klamp opad til et gulv.
  const model = { a: Math.log(800), b: 0, offset: {} };
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 800);
});

test("riderSpecialty returns the top ability", () => {
  assert.equal(riderSpecialty(abilities(40, { climbing: 95 })), "climbing");
  assert.equal(riderSpecialty(abilities(40, { sprint: 88 })), "sprint");
});

test("riderOverall is the mean of abilities, clamped 0-99", () => {
  assert.equal(riderOverall(abilities(50)), 50);
  const high = riderOverall(abilities(99));
  assert.ok(high >= 0 && high <= 99);
});

test("meanAbilityScore er det uafrundede snit af alle abilities", () => {
  assert.equal(meanAbilityScore(abilities(50)), 50);
  // 13 evner på 40 + climbing 95 → 615/14 (uafrundet, modsat riderOverall).
  assert.equal(meanAbilityScore(abilities(40, { climbing: 95 })), 615 / 14);
});

test("blendedOutput: alpha=1 → ren speciale-score, alpha=0 → snit af alt, 0.5 → midt imellem", () => {
  const ab = abilities(40, { cobblestone: 90, flat: 90, endurance: 90, punch: 90 });
  const spec = outputScore(ab, "brostensrytter");
  const mean = meanAbilityScore(ab);
  assert.equal(blendedOutput(ab, "brostensrytter", 1), spec);
  assert.equal(blendedOutput(ab, "brostensrytter", 0), mean);
  assert.equal(blendedOutput(ab, "brostensrytter", 0.5), (spec + mean) / 2);
});

test("predictBaseValue v2-model (uden alpha/c) er uændret", () => {
  const model = { a: Math.log(1000), b: 0, offset: { gc: Math.log(2) } };
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 2000);
});

test("predictBaseValue v3: kvadratisk led (c>0) strækker toppen relativt mere", () => {
  const base = { a: 0, b: 0.05, offset: {} };
  const quad = { ...base, c: 0.001 };
  const liftLo = predictBaseValue({ primary_type: "gc" }, abilities(40), quad)
    / predictBaseValue({ primary_type: "gc" }, abilities(40), base);
  const liftHi = predictBaseValue({ primary_type: "gc" }, abilities(90), quad)
    / predictBaseValue({ primary_type: "gc" }, abilities(90), base);
  assert.ok(liftHi > liftLo, `c>0 skal løfte toppen relativt mere (${liftHi} > ${liftLo})`);
});

test("v3 med alpha<1 værdsætter alsidighed: bred elite slår smal specialist", () => {
  // "Pogacar-profil": elite i ALT. "MvdP-profil": uslåelig på specialet, hul i klatring.
  const broad = abilities(85, { climbing: 96, tempo: 99, endurance: 99 });
  const narrow = abilities(55, { cobblestone: 95, flat: 92, endurance: 93, punch: 86, climbing: 45 });
  const model = { alpha: 0.5, a: 0, b: 0.1, c: 0.0005, offset: {} };
  const vBroad = predictBaseValue({ primary_type: "gc" }, broad, model);
  const vNarrow = predictBaseValue({ primary_type: "brostensrytter" }, narrow, model);
  assert.ok(vBroad > vNarrow, `bred elite (${vBroad}) skal slå smal specialist (${vNarrow})`);
});
