// Paritets-guard: frontendens projektion af divisions-tillægget må aldrig afvige fra
// motorens beregning (#4376). Samme mønster som salaryRateParity.test.js — de to
// codebases er separate npm-pakker og kan ikke dele et import ved build-tid, så
// ligheden håndhæves af en test i stedet for af typesystemet.
//
// Uden denne test ville en spiller kunne blive vist ét beløb i tilbuds-modalen og få et
// andet udbetalt, hvilket er præcis den fejlklasse #4345 handler om.
import { test } from "node:test";
import assert from "node:assert/strict";

import { projectDivisionAdjustment, DIVISION_ADJUSTMENT_FRACTION } from "./divisionAdjustment.js";
import {
  computeDivisionAdjustment,
  DIVISION_ADJUSTMENT_FACTOR,
  FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT,
} from "../../../backend/lib/divisionAdjustment.js";

const DIVISIONS = [1, 2, 3, 4];

test("faktoren er den samme i frontend og backend", () => {
  assert.equal(DIVISION_ADJUSTMENT_FRACTION, DIVISION_ADJUSTMENT_FACTOR);
});

test("projektionen matcher motoren for hver kombination af divisioner", () => {
  for (const signedDivision of DIVISIONS) {
    for (const targetDivision of DIVISIONS) {
      const frontend = projectDivisionAdjustment({ targetDivision, signedDivision });
      const backend = computeDivisionAdjustment({
        currentDivision: targetDivision,
        signedDivision,
        // Modalen viser altid en kommende sæson, og fra sæson 4 gælder reglen begge veje.
        seasonNumber: FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT,
      });
      assert.equal(
        frontend,
        backend,
        `D${signedDivision} → D${targetDivision}: frontend ${frontend} vs backend ${backend}`
      );
    }
  }
});

test("ukendte eller manglende divisioner giver 0 begge steder", () => {
  assert.equal(projectDivisionAdjustment({ targetDivision: 9, signedDivision: 1 }), 0);
  assert.equal(projectDivisionAdjustment({ targetDivision: 1, signedDivision: null }), 0);
  assert.equal(projectDivisionAdjustment({}), 0);
});
