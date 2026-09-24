import { test } from "node:test";
import assert from "node:assert/strict";
import * as riderRating from "./riderRating.js";
import {
  STAT_KEYS,
  riderBestRole, riderOverallRating, riderTypeRating,
} from "./riderRating.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "./generated/displayRecipes.js";
import { isBestRoleDisplayOn, setBestRoleDisplay } from "./riderRatingMode.js";
import { DISPLAY_RECIPE_KEYS as BACKEND_RECIPE_KEYS } from "../../../backend/lib/weights/displayRecipes.js";

// #5321 — forward-guard. Rod-årsagen bag "samme rytter, to forskellige ratings"
// var at SSOT-filen eksporterede TO måder at regne en rating på: den vægtede
// rolle-opskrift og et uvægtet snit over alle evner (`riderStatRating`). Den
// sidste blev brugt ét sted og gav dér et andet tal for samme rytter. Listen
// under er derfor udtømmende, ikke vejledende: en ny rating-funktion her skal
// fælde testen, så beslutningen om at have to mål bliver taget bevidst og med
// hver sin etiket i UI'et.
// #5435: riderBestRole er IKKE en ny rating-formel — den er samme opskrift
// (ratingForRole) med et andet rolle-VALG (max over de otte). Den er med på
// listen fordi kortet skal vise rollenavnet ved siden af tallet ("54 Bjergrytter").
test("#5321: rating-SSOT'en eksporterer ÉN beregning, ikke to", () => {
  assert.deepEqual(
    Object.keys(riderRating).sort(),
    ["STAT_KEYS", "riderBestRole", "riderOverallRating", "riderTypeRating"].sort(),
  );
});

// 15 → 17 ved #5268 (teamwork + leadership). Antallet er pinnet frem for afledt:
// en evne der forsvinder ved et uheld skal fælde bygningen, ikke bare give et
// mindre tal. Se docs/HOWTO_ADD_ABILITY.md §4b for de øvrige steder tallet står.
test("STAT_KEYS: 17 unikke CZ-evne-noegler (#1529, #5268)", () => {
  assert.equal(STAT_KEYS.length, 17);
  assert.equal(new Set(STAT_KEYS).size, 17);
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

// ============================================================================
// #5435 (D-049) — bedste rolle nu (model A), bag kontakten
// ============================================================================

// Kører en test med kontakten i en bestemt stilling og sætter den tilbage.
function withMode(on, fn) {
  const before = isBestRoleDisplayOn();
  setBestRoleDisplay(on);
  try { fn(); } finally { setBestRoleDisplay(before); }
}

function climberProfile() {
  const r = {};
  for (const k of STAT_KEYS) r[k] = 30;
  r.climbing = 80; r.recovery = 70; r.endurance = 65;
  return r;
}

test("#5435: riderBestRole = max over de otte afrundede rolle-ratings + rollen", () => {
  const rider = climberProfile();
  const all = DISPLAY_RECIPE_KEYS.map((k) => ({ k, v: ratingForRole(rider, k) }));
  const max = Math.max(...all.map((x) => x.v));
  const first = all.find((x) => x.v === max).k;
  assert.deepEqual(riderBestRole(rider), { rating: max, role: first });
});

test("#5435: lighed → første rolle i opskrifternes faste rækkefølge (samme som backend)", () => {
  // 13 i alt giver 13 i alle otte roller — ren lighed.
  const flat = {};
  for (const k of STAT_KEYS) flat[k] = 13;
  assert.deepEqual(riderBestRole(flat), { rating: 13, role: DISPLAY_RECIPE_KEYS[0] });
  // Tie-reglen afhænger af rækkefølgen; den skal være bit-identisk med backendens
  // (riderValueRefresh.bestRoleForAbilities itererer backendens liste).
  assert.deepEqual([...DISPLAY_RECIPE_KEYS], [...BACKEND_RECIPE_KEYS]);
});

test("#5435: ingen evner → cachede riders.best_role/best_role_rating, ellers null", () => {
  assert.deepEqual(riderBestRole({}), { rating: null, role: null });
  assert.deepEqual(
    riderBestRole({ best_role: "climber", best_role_rating: 54 }),
    { rating: 54, role: "climber" },
  );
  // Ugyldig cache (ukendt rolle) vises ikke.
  assert.deepEqual(riderBestRole({ best_role: "nope", best_role_rating: 54 }), { rating: null, role: null });
  // Nul er en gyldig rating, ikke "ingen data".
  assert.deepEqual(riderBestRole({ best_role: "gc", best_role_rating: 0 }), { rating: 0, role: "gc" });
});

test("#5435: live evner vinder over en halende cache", () => {
  const rider = { ...climberProfile(), best_role: "sprinter", best_role_rating: 12 };
  const live = riderBestRole(climberProfile());
  assert.deepEqual(riderBestRole(rider), live);
});

test("#5435: kontakt OFF → riderOverallRating er uændret egen rolle", () => {
  withMode(false, () => {
    const rider = { ...climberProfile(), primary_type: "sprinter" };
    assert.equal(riderOverallRating(rider), ratingForRole(rider, "sprinter"));
    assert.equal(riderOverallRating({ ...climberProfile() }), null, "ingen primary_type → null");
  });
});

test("#5435: kontakt ON → riderOverallRating = bedste rolle nu, og kan kun hæve tallet", () => {
  withMode(true, () => {
    const rider = { ...climberProfile(), primary_type: "sprinter" };
    const best = riderBestRole(rider);
    assert.equal(riderOverallRating(rider), best.rating);
    assert.ok(best.rating >= ratingForRole(rider, "sprinter"), "ejer-regel 17/9: aldrig lavere end egen rolle");
    // primary_type er ikke længere nødvendig for at vise et tal.
    assert.equal(riderOverallRating(climberProfile()), best.rating);
  });
});
