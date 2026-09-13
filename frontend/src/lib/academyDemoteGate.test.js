// #5145 — UI-gaten for nedrykning til akademiet.
//
// Testen importerer backendens EGNE konstanter (ACADEMY.MAX_AGE,
// GRADUATION.GRADUATE_AGE) og pinner frontendens kopi mod dem, i stedet for at
// gentage 21/22 som literaler her. Havde vi skrevet tallene af, ville denne fil
// være den fjerde håndholdte kopi af den samme regel — præcis det anti-mønster
// academyPromoteContract.test.js blev skrevet for at undgå.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACADEMY_DEMOTE_MAX_AGE,
  ACADEMY_GRADUATE_AGE,
  canDemoteToAcademy,
  isDemoteBlockedByAge,
} from "./academyDemoteGate.js";
import { ACADEMY } from "../../../backend/lib/academyFlag.js";
import { GRADUATION } from "../../../backend/lib/academyGraduation.js";

// Sæson-referenceåret (LAUNCH_REFERENCE_YEAR + season - 1). Et konkret år, så
// alderen i testen er nem at læse: fødselsår = SEASON_YEAR - alder.
const SEASON_YEAR = 2027;
const born = (age) => `${SEASON_YEAR - age}-05-14`;

test("frontendens grænse ER backendens: MAX_AGE / GRADUATE_AGE, ikke en kopi der kan drifte", () => {
  assert.equal(ACADEMY_DEMOTE_MAX_AGE, ACADEMY.MAX_AGE, "sidste tilladte alder skal spejle ACADEMY.MAX_AGE");
  assert.equal(ACADEMY_GRADUATE_AGE, GRADUATION.GRADUATE_AGE, "graduerings-alderen skal spejle GRADUATION.GRADUATE_AGE");
  assert.equal(ACADEMY_GRADUATE_AGE, ACADEMY_DEMOTE_MAX_AGE + 1, "akademiet slutter sæsonen efter den sidste tilladte alder");
});

test("canDemoteToAcademy: 16-21 er tilladt, 22 og opefter er ikke", () => {
  for (let age = ACADEMY.MIN_AGE; age <= ACADEMY_DEMOTE_MAX_AGE; age++) {
    assert.equal(canDemoteToAcademy(born(age), SEASON_YEAR), true, `alder ${age} skal være tilladt`);
  }
  for (const age of [ACADEMY_GRADUATE_AGE, 23, 25, 31]) {
    assert.equal(canDemoteToAcademy(born(age), SEASON_YEAR), false, `alder ${age} skal være spærret`);
  }
});

test("#5145-regressionen: en 22-årig var tilladt under den gamle U23-gate, men er det ikke længere", () => {
  // Den gamle gate var isU23 = alder < 23. 22 var altså inde — og landede rytteren
  // i akademiet OVER gradueringsalderen uden graduerings-vindue (#5133).
  assert.equal(canDemoteToAcademy(born(22), SEASON_YEAR), false);
  assert.equal(canDemoteToAcademy(born(21), SEASON_YEAR), true, "21 må IKKE være røget med i strammingen");
});

test("canDemoteToAcademy: ukendt fødselsdato eller ukendt sæson-år lukker gaten (null-over-gæt)", () => {
  assert.equal(canDemoteToAcademy(null, SEASON_YEAR), false);
  assert.equal(canDemoteToAcademy(undefined, SEASON_YEAR), false);
  assert.equal(canDemoteToAcademy("", SEASON_YEAR), false);
  assert.equal(canDemoteToAcademy(born(19), null), false, "uden sæson-år må UI'et ikke åbne en gate backend holder lukket");
  assert.equal(canDemoteToAcademy(born(19), undefined), false);
});

test("isDemoteBlockedByAge er SAND kun ved præcis gradueringsalderen — forklaringen vises ikke for 25-årige", () => {
  assert.equal(isDemoteBlockedByAge(born(ACADEMY_GRADUATE_AGE), SEASON_YEAR), true);
  for (const age of [20, 21, 23, 24, 30]) {
    assert.equal(isDemoteBlockedByAge(born(age), SEASON_YEAR), false, `alder ${age} skal ikke udløse forklaringen`);
  }
  assert.equal(isDemoteBlockedByAge(null, SEASON_YEAR), false);
  assert.equal(isDemoteBlockedByAge(born(22), null), false, "uden sæson-år kender vi ikke alderen — ingen påstand");
});

test("gaten er sæson-drevet, ikke wall-clock: samme rytter skifter status ved sæsonskift", () => {
  const birthdate = "2006-05-14";
  assert.equal(canDemoteToAcademy(birthdate, 2027), true, "sæson-alder 21 i S2");
  assert.equal(canDemoteToAcademy(birthdate, 2028), false, "sæson-alder 22 i S3 — nu spærret");
  assert.equal(isDemoteBlockedByAge(birthdate, 2028), true, "og netop dér skal forklaringen vises");
});
