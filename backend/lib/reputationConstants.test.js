// CodeQL #356 (js/prototype-pollution-utility): enhedstests for
// buildConstants/setAtPath — dot-path-overrides til kalibrerings-harnessen
// (backend/scripts/reputation-calibration.js). Se reputationConstants.js
// linje ~232 for selve implementeringen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  W_CLASS,
  FLOOR_CREDITS,
  SOFT_CAP,
  defaultConstantsBundle,
  buildConstants,
} from "./reputationConstants.js";

test("buildConstants: dot-path-override sætter én nøgle uden at røre andre", () => {
  const bundle = buildConstants({ "W_CLASS.ProSeries": 0.35 });
  assert.equal(bundle.W_CLASS.ProSeries, 0.35);
  assert.equal(bundle.W_CLASS.Class1, W_CLASS.Class1);
  assert.equal(bundle.SOFT_CAP, SOFT_CAP);
});

test("buildConstants: nestet dot-path-override (FLOOR_CREDITS.<base>.<klasse>)", () => {
  const bundle = buildConstants({ "FLOOR_CREDITS.one_day.Class1": 9 });
  assert.equal(bundle.FLOOR_CREDITS.one_day.Class1, 9);
  // Søskende-nøgler i samme base er uændrede.
  assert.equal(bundle.FLOOR_CREDITS.one_day.Monuments, FLOOR_CREDITS.one_day.Monuments);
  assert.equal(bundle.FLOOR_CREDITS.gc.Class1, FLOOR_CREDITS.gc.Class1);
});

test("buildConstants: top-niveau-override (helt tal-felt, fx SOFT_CAP)", () => {
  const bundle = buildConstants({ SOFT_CAP: 80 });
  assert.equal(bundle.SOFT_CAP, 80);
});

test("buildConstants: liste-override erstatter HELE arrayet (NO_FLOOR_CREDIT_CLASSES)", () => {
  const bundle = buildConstants({ NO_FLOOR_CREDIT_CLASSES: ["Class1", "Class2"] });
  assert.deepEqual(bundle.NO_FLOOR_CREDIT_CLASSES, ["Class1", "Class2"]);
});

test("buildConstants: originale frosne exports og modulets defaults er uændrede efter overrides", () => {
  buildConstants({ "W_CLASS.ProSeries": 0.99, SOFT_CAP: 999 });
  assert.equal(W_CLASS.ProSeries, 0.25);
  assert.equal(SOFT_CAP, 74);
  assert.equal(Object.isFrozen(W_CLASS), true);
  // defaultConstantsBundle() giver stadig en frisk kopi uafhængig af tidligere kald.
  const fresh = defaultConstantsBundle();
  assert.equal(fresh.W_CLASS.ProSeries, 0.25);
  assert.equal(fresh.SOFT_CAP, 74);
});

test("buildConstants: uden overrides er bundlen identisk med default-bundlen (spread-/læsbarhed uændret)", () => {
  const bundle = buildConstants();
  assert.deepEqual(bundle, defaultConstantsBundle());
  // Bundlen skal stadig kunne spredes/kopieres som et almindeligt objekt.
  const copy = { ...bundle };
  assert.equal(copy.SOFT_CAP, SOFT_CAP);
});

test("buildConstants: \"__proto__.polluted\" kaster og forurener ALDRIG Object.prototype", () => {
  assert.throws(
    () => buildConstants({ "__proto__.polluted": "pwned" }),
    /forbudte segment "__proto__"/,
  );
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  // En helt ny, urelateret bundle må heller ikke bære den forurenede nøgle.
  const bundle = defaultConstantsBundle();
  assert.equal(bundle.polluted, undefined);
});

test("buildConstants: bar top-niveau \"__proto__\" kaster (uden understi)", () => {
  // Computed key (["__proto__"]) — literalt `{ __proto__: ... }` sætter
  // objektets EGEN prototype (Annex B) i stedet for at oprette en almindelig
  // egen-property, og ville derfor slet ikke ramme setAtPath.
  const overrides = { ["__proto__"]: "pwned" };
  assert.equal(Object.hasOwn(overrides, "__proto__"), true);
  assert.throws(
    () => buildConstants(overrides),
    /forbudte segment "__proto__"/,
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test("buildConstants: \"constructor.prototype.polluted\" kaster og forurener ALDRIG Object.prototype", () => {
  assert.throws(
    () => buildConstants({ "constructor.prototype.polluted": "pwned" }),
    /forbudte segment "constructor"/,
  );
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test("buildConstants: forbudt segment midt i en ellers gyldig sti kaster også", () => {
  assert.throws(
    () => buildConstants({ "W_CLASS.__proto__.polluted": "pwned" }),
    /forbudte segment "__proto__"/,
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test("buildConstants: ukendt top-niveau-sti kaster (dokumenteret tastefejl-beskyttelse)", () => {
  assert.throws(
    () => buildConstants({ "W_CLAS.ProSeries": 0.35 }),
    /ukendt konstant "W_CLAS"/,
  );
  assert.throws(
    () => buildConstants({ TYPO_SOFT_CAP: 80 }),
    /ukendt konstant "TYPO_SOFT_CAP"/,
  );
});
