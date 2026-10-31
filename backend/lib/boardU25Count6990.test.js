// #6990 · min_u25_riders tæller kun SENIORTRUPPENS ryttere med sæsonalder <= 25 (UCI-reglen,
// riderSeasonAge.isU25ForSeason; bestyrelsen ser kun seniortruppen, #5898 ejer-valg B).
// Udledningen sker af fødselsdato; is_u25-flaget er kun fallback. Junior- og U23-truppen
// tælles ikke med.

import test from "node:test";
import assert from "node:assert/strict";

import {
  countU25RidersForBoard,
  evaluateGoal,
  evaluateGoalProgress,
  isRiderU25ForBoard,
} from "./boardGoals.js";
import { seasonReferenceYear } from "./riderSeasonAge.js";

const SEASON = 4;
const REF = seasonReferenceYear(SEASON);

// Fødselsår relativt til sæsonens referenceår, så testen ikke hænger på kalenderen.
function rider(ageInSeason, isU25Flag, extra = {}) {
  return { id: `r${ageInSeason}-${isU25Flag}`, birthdate: `${REF - ageInSeason}-06-15`, is_u25: isU25Flag, squad: "senior", is_academy: false, ...extra };
}

const goal = { type: "min_u25_riders", target: 6 };

test("seniorryttere under 23 med forkert is_u25=false tælles stadig som U25", () => {
  const riders = [
    rider(19, false), rider(20, false), rider(21, false), rider(22, false), // under 23, forkert flag
    rider(23, true), rider(24, true), rider(25, true),                      // 23-25
    rider(27, false),                                                       // senior
  ];
  assert.equal(countU25RidersForBoard(riders, SEASON), 7);
  assert.equal(evaluateGoal(goal, null, { riders }, { seasonNumber: SEASON }), true);
});

test("en 26-årig tæller ikke, selv hvis flaget fejlagtigt siger true", () => {
  assert.equal(isRiderU25ForBoard(rider(26, true), SEASON), false);
  assert.equal(isRiderU25ForBoard(rider(25, false), SEASON), true);
});

test("uden sæsonnummer eller fødselsdato falder tælleren tilbage på is_u25-flaget", () => {
  assert.equal(isRiderU25ForBoard({ is_u25: true }, SEASON), true);
  assert.equal(isRiderU25ForBoard({ birthdate: rider(20, false).birthdate, is_u25: false }, null), false);
});

test("evaluateGoalProgress viser det rigtige antal og status", () => {
  const riders = [rider(18, false), rider(19, false), rider(20, false), rider(22, false), rider(24, true)];
  const progress = evaluateGoalProgress(goal, null, { riders }, { seasonNumber: SEASON });
  assert.equal(progress.actual, 5);
  assert.notEqual(progress.met, true);
});

test("junior- og U23-truppens ryttere tælles ikke med, uanset alder", () => {
  const riders = [
    rider(19, true, { squad: "junior", is_academy: true }),
    rider(21, true, { squad: "u23", is_academy: true }),
    rider(22, true, { squad: "u23", is_academy: true }),
    rider(23, true),
    rider(25, true),
    rider(26, true),
  ];
  assert.equal(countU25RidersForBoard(riders, SEASON), 2);
  assert.equal(evaluateGoal({ type: "min_u25_riders", target: 3 }, null, { riders }, { seasonNumber: SEASON }), false);
  assert.equal(evaluateGoalProgress(goal, null, { riders }, { seasonNumber: SEASON }).actual, 2);
});

test("19-, 23- og 25-årig seniorrytter tæller; 26-årig gør ikke", () => {
  assert.equal(isRiderU25ForBoard(rider(19, false), SEASON), true);
  assert.equal(isRiderU25ForBoard(rider(23, false), SEASON), true);
  assert.equal(isRiderU25ForBoard(rider(25, false), SEASON), true);
  assert.equal(isRiderU25ForBoard(rider(26, false), SEASON), false);
});
