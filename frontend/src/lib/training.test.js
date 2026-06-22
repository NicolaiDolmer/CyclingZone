import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_FOCUS_ABILITIES, TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES,
  TRAINING_SETBACK_PCT, isValidFocus, isValidIntensity, injuryDaysLeft,
  isRiderInjured, flattenCondition, CONDITION_SELECT,
} from "./training.js";

test("fokus-nøgler matcher abilities-mappens nøgler", () => {
  assert.deepEqual(TRAINING_FOCUS_KEYS, Object.keys(TRAINING_FOCUS_ABILITIES));
  assert.equal(TRAINING_FOCUS_KEYS.length, 6);
});

test("hvert fokus peger på mindst én evne", () => {
  for (const k of TRAINING_FOCUS_KEYS) {
    assert.ok(Array.isArray(TRAINING_FOCUS_ABILITIES[k]) && TRAINING_FOCUS_ABILITIES[k].length > 0, k);
  }
});

test("intensiteter inkluderer rest + setback-procenter er konsistente", () => {
  assert.deepEqual(TRAINING_INTENSITIES, ["rest", "easy", "normal", "hard"]);
  assert.equal(TRAINING_SETBACK_PCT.easy, 0);
  assert.ok(TRAINING_SETBACK_PCT.hard > TRAINING_SETBACK_PCT.normal);
  assert.ok(TRAINING_SETBACK_PCT.normal > TRAINING_SETBACK_PCT.easy);
});

test("validatorer afviser ukendte værdier + accepterer rest", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nope"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(isValidIntensity("rest"));
  assert.ok(!isValidIntensity("extreme"));
});

// injuryDaysLeft tests
test("injuryDaysLeft returnerer 0 ved null", () => {
  assert.equal(injuryDaysLeft(null), 0);
  assert.equal(injuryDaysLeft(undefined), 0);
});

test("injuryDaysLeft returnerer 0 når rask (fortid, dagen efter sidste skadedag)", () => {
  // injured_until = den SIDSTE skadede dag (inklusiv, jf. backend injured_until >= tickDate).
  // Dagen EFTER (i morgen er rytteren rask) => 0 dage tilbage.
  const today = new Date("2026-06-12T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-11", today), 0);
});

// #1672: På den SIDSTE skadedag (today == injured_until) er rytteren STADIG skadet
// (backend: injured_until >= tickDate => kan ikke træne). UI skal vise "1 dag tilbage",
// ikke "0 dage tilbage". Den gamle strict >0-logik gav fejlagtigt 0.
test("injuryDaysLeft returnerer 1 på sidste skadedag (#1672 — ikke 0)", () => {
  const today = new Date("2026-06-25T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-25", today), 1);
});

// #1672: injured_until lagres som DATE-kolonne => PostgREST returnerer ren dato-streng.
// Reproducér mod en kendt slutdato 3 kalenderdage frem fra dags dato.
test("injuryDaysLeft tæller inklusiv sidste skadedag (DATE-streng)", () => {
  // 22/6 i dag, sidste skadedag 25/6 => skadet 22, 23, 24, 25 = 4 dage tilbage.
  const today = new Date("2026-06-22T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-25", today), 4);
});

test("injuryDaysLeft returnerer 2 når sidste skadedag er i morgen", () => {
  // 22/6 i dag, sidste skadedag 23/6 => skadet 22 + 23 = 2 dage tilbage.
  const today = new Date("2026-06-22T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-23", today), 2);
});

// Robust på tværs af klokkeslæt: ren DATE-streng + vilkårligt klokkeslæt på today
// må ikke trække en dag af pga. tidszone/normalisering.
test("injuryDaysLeft er stabil hen over dagen (ingen tidszone-off-by-one)", () => {
  for (const hh of ["00:30", "08:00", "23:30"]) {
    assert.equal(injuryDaysLeft("2026-06-25", new Date(`2026-06-22T${hh}:00`)), 4, `kl. ${hh}`);
  }
});

// isRiderInjured tests (#1531 — skade-badge)
test("isRiderInjured er false ved null/undefined/fortid", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  assert.equal(isRiderInjured(null, today), false);
  assert.equal(isRiderInjured(undefined, today), false);
  assert.equal(isRiderInjured("2026-06-11T00:00:00Z", today), false);
});

test("isRiderInjured er true når injured_until er i fremtiden", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  assert.equal(isRiderInjured("2026-06-15T00:00:00Z", today), true);
});

// flattenCondition tests (#1531 — løft injured_until op fra embed)
test("flattenCondition løfter injured_until op fra objekt-embed", () => {
  const r = { id: "x", rider_condition: { injured_until: "2026-06-15" } };
  const out = flattenCondition(r);
  assert.equal(out.injured_until, "2026-06-15");
  assert.equal(out.rider_condition, undefined);
});

test("flattenCondition løfter injured_until op fra array-embed", () => {
  const r = { id: "x", rider_condition: [{ injured_until: "2026-06-15" }] };
  assert.equal(flattenCondition(r).injured_until, "2026-06-15");
});

test("flattenCondition tåler manglende/null embed (ingen skade-rad)", () => {
  assert.equal(flattenCondition({ id: "x" }).injured_until, undefined);
  assert.equal(flattenCondition({ id: "x", rider_condition: null }).injured_until, undefined);
  assert.equal(flattenCondition(null), null);
});

test("CONDITION_SELECT embedder kun injured_until (ikke form/fatigue)", () => {
  assert.equal(CONDITION_SELECT, "rider_condition(injured_until)");
});
