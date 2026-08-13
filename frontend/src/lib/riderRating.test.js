import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAT_KEYS, riderStatRating,
  riderOverallRating, riderTypeRating,
} from "./riderRating.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "./generated/displayRecipes.js";

test("riderStatRating: snit af alle 15 evner, afrundet (#1009/#1529)", () => {
  const rider = {};
  STAT_KEYS.forEach((k, i) => {
    rider[k] = 60 + (i % 3); // 60/61/62-mønster
  });
  const expected = Math.round(
    STAT_KEYS.reduce((sum, k) => sum + rider[k], 0) / STAT_KEYS.length,
  );
  assert.equal(riderStatRating(rider), expected);
});

test("riderStatRating: manglende/ikke-numeriske evner ignoreres i snittet", () => {
  const rider = { climbing: 80, sprint: 70, time_trial: null, flat: "abc" };
  assert.equal(riderStatRating(rider), 75);
});

test("riderStatRating: ingen evner -> 0 (sorterer nederst)", () => {
  assert.equal(riderStatRating({}), 0);
  assert.equal(riderStatRating(null), 0);
  assert.equal(riderStatRating(undefined), 0);
});

test("riderStatRating: klampes til 0-99", () => {
  const maxed = Object.fromEntries(STAT_KEYS.map((k) => [k, 150]));
  assert.equal(riderStatRating(maxed), 99);
  const negative = Object.fromEntries(STAT_KEYS.map((k) => [k, -5]));
  assert.equal(riderStatRating(negative), 0);
});

test("STAT_KEYS: 15 unikke CZ-evne-noegler (#1529)", () => {
  assert.equal(STAT_KEYS.length, 15);
  assert.equal(new Set(STAT_KEYS).size, 15);
  for (const k of STAT_KEYS) assert.match(k, /^[a-z][a-z_]+$/);
});

// --- riderOverallRating (1-99, type-bevidst) — EPIC #2000 Slice 2 / #2006 ---

// ============================================================================
// #3666 — DEN NYE MODEL
// ============================================================================
// Ankrene (RATING_ALPHA / O_ELITE / O_MIN) og riderBlendedOutput findes ikke
// længere: modellen er absolut og har ingen populations-normalisering. Testene
// nedenfor måler den kontrakt der ERSTATTEDE dem.

test("ejerens regel: 13 i alle evner der tæller for rollen → rating 13", () => {
  // Ordret mandat 13/8: "Hvis en bakkerytter har 13 i alle stats der bliver
  // vurderet for at være bakkerytter, så skal hans rating være 13. Simpelt as
  // that." Det er hele grundlaget for modellen — hvis denne test falder, er
  // spillet tilbage ved en skala spilleren ikke kan regne efter.
  const rider = {};
  for (const k of STAT_KEYS) rider[k] = 13;
  for (const role of DISPLAY_RECIPE_KEYS) {
    assert.equal(riderTypeRating(rider, role), 13, `rolle ${role} gav ikke 13`);
  }
});

test("riderTypeRating ER opskriften — ingen model ved siden af", () => {
  const rider = {};
  STAT_KEYS.forEach((k, i) => { rider[k] = 20 + (i * 3) % 60; });
  for (const role of DISPLAY_RECIPE_KEYS) {
    assert.equal(riderTypeRating(rider, role), ratingForRole(rider, role));
  }
});

test("riderOverallRating er ratingen for rytterens EGEN rolle", () => {
  const rider = { primary_type: "sprinter" };
  STAT_KEYS.forEach((k, i) => { rider[k] = 30 + (i * 7) % 40; });
  assert.equal(riderOverallRating(rider), ratingForRole(rider, "sprinter"));
});

test("bunden er 0, ikke 1 — nul-ryttere findes i prod og skal vise 0", () => {
  // Målt read-only mod prod 13/8: 2 levende ryttere har rolle-rating præcis 0.
  // Den gamle skala kunne ikke producere 0 (den normaliserede til [1,99]), og
  // derfor stod der falsy-gates rundt om i visningen. De er skiftet til
  // Number.isFinite, så de to ryttere ikke skjules som "ingen data".
  const nul = {};
  for (const k of STAT_KEYS) nul[k] = 0;
  assert.equal(riderTypeRating(nul, "climber"), 0);
});

test("ukendt eller manglende rolle giver null, ikke et opdigtet tal", () => {
  const rider = {};
  for (const k of STAT_KEYS) rider[k] = 50;
  assert.equal(riderTypeRating(rider, "findes-ikke"), null);
  assert.equal(riderTypeRating(rider, null), null);
  assert.equal(riderOverallRating({ ...rider }), null, "ingen primary_type → null");
});

test("evner der mangler på rækken trækker ikke snittet mod 0", () => {
  // De tæller hverken i tæller eller nævner. En delvist udfyldt række må ikke
  // se ud som en svag rytter.
  const fuld = {}; for (const k of STAT_KEYS) fuld[k] = 40;
  const delvis = { climbing: 40, tempo: 40 }; // kun to af climber-opskriftens evner
  assert.equal(riderTypeRating(delvis, "climber"), riderTypeRating(fuld, "climber"));
});

test("rollen betyder noget: en spurter-profil rates højest som sprinter", () => {
  const spurter = {};
  for (const k of STAT_KEYS) spurter[k] = 20;
  spurter.sprint = 90; spurter.acceleration = 85; spurter.flat = 70; spurter.positioning = 65;
  assert.ok(riderTypeRating(spurter, "sprinter") > riderTypeRating(spurter, "climber"));
});

test("alle 8 roller giver et gyldigt tal i [0,99] for en rytter med evner", () => {
  const rider = {};
  STAT_KEYS.forEach((k, i) => { rider[k] = 25 + (i * 5) % 50; });
  for (const role of DISPLAY_RECIPE_KEYS) {
    const r = riderTypeRating(rider, role);
    assert.ok(Number.isInteger(r) && r >= 0 && r <= 99, `rolle ${role} gav ${r}`);
  }
});
