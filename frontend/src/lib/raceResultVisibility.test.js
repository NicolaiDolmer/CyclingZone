// frontend/src/lib/raceResultVisibility.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { raceHasReportableResults, raceIsInProgress } from "./raceResultVisibility.js";

test("raceHasReportableResults: completed løb → true", () => {
  assert.equal(raceHasReportableResults({ status: "completed", stages_completed: 21, stages: 21 }), true);
  // Endagsløb: status flippet til completed, stages_completed matcher.
  assert.equal(raceHasReportableResults({ status: "completed", stages_completed: 1, stages: 1 }), true);
});

test("raceHasReportableResults: igangværende etapeløb (status stadig 'scheduled') → true (#3333)", () => {
  // Vuelta Ibérica-shapen: 14 af 21 etaper kørt, status forbliver 'scheduled'.
  assert.equal(raceHasReportableResults({ status: "scheduled", stages_completed: 14, stages: 21 }), true);
});

test("raceHasReportableResults: endnu ikke startet løb → false", () => {
  assert.equal(raceHasReportableResults({ status: "scheduled", stages_completed: 0, stages: 6 }), false);
  assert.equal(raceHasReportableResults({ status: "scheduled", stages_completed: null, stages: 6 }), false);
});

test("raceHasReportableResults: defensiv på null/undefined race", () => {
  assert.equal(raceHasReportableResults(null), false);
  assert.equal(raceHasReportableResults(undefined), false);
  assert.equal(raceHasReportableResults({}), false);
});

test("raceIsInProgress: kun true for løb med kørte MEN ikke alle etaper", () => {
  assert.equal(raceIsInProgress({ status: "scheduled", stages_completed: 14, stages: 21 }), true);
  assert.equal(raceIsInProgress({ status: "scheduled", stages_completed: 0, stages: 21 }), false);
  // Alle etaper kørt men status ikke flippet endnu — deriveRaceStatus regner det for completed, ikke live.
  assert.equal(raceIsInProgress({ status: "scheduled", stages_completed: 21, stages: 21 }), false);
  assert.equal(raceIsInProgress({ status: "completed", stages_completed: 21, stages: 21 }), false);
});

test("raceIsInProgress: endagsløb er aldrig 'live' (atomisk scheduled→completed)", () => {
  assert.equal(raceIsInProgress({ status: "scheduled", stages_completed: 0, stages: 1 }), false);
  assert.equal(raceIsInProgress({ status: "completed", stages_completed: 1, stages: 1 }), false);
});
