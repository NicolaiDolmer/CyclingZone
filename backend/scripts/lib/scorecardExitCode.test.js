// #3009 forward-guard: låser kontrakten for gateExitCode fast, så "HEADLINE FAIL
// men exit 0"-bugget (moneySupplyScorecard.js, inflationScorecard.js,
// scripts/sponsorChoiceScorecard.js) ikke kan genopstå ubemærket i noget script
// der bruger denne fælles hjælper.
import test from "node:test";
import assert from "node:assert/strict";

import { gateExitCode } from "./scorecardExitCode.js";

test("gateExitCode: PASS (allPass=true) giver exit-kode 0", () => {
  assert.equal(gateExitCode(true), 0);
});

test("gateExitCode: FAIL (allPass=false) giver ikke-nul exit-kode", () => {
  assert.notEqual(gateExitCode(false), 0);
  assert.equal(gateExitCode(false), 1);
});

test("gateExitCode: FAIL + --advisory undertrykker exit-koden (report-only)", () => {
  assert.equal(gateExitCode(false, { advisory: true }), 0);
});

test("gateExitCode: PASS + --advisory er stadig 0", () => {
  assert.equal(gateExitCode(true, { advisory: true }), 0);
});

test("gateExitCode: default-arg (ingen options) opfører sig som advisory=false", () => {
  assert.equal(gateExitCode(false), 1);
  assert.equal(gateExitCode(true), 0);
});
