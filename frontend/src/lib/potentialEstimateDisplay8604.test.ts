// #8604: trend-prognosens mærker i prognosisView. Uden mærkerne er læsningen som før.
import test from "node:test";
import assert from "node:assert/strict";

import { prognosisTitleKey, prognosisViewOf } from "./potentialEstimateDisplay.ts";

test("trend-mærkerne læses, ukendte værdier og bånd ignoreres", () => {
  assert.deepEqual(
    prognosisViewOf({ prognosisView: { hidden: false, value: 72, basis: "trend", learning: true, horizon: "year", band: { lo: 1, hi: 99 } } }),
    { hidden: false, value: 72, basis: "trend", learning: true, horizon: "year" },
  );
  assert.deepEqual(
    prognosisViewOf({ prognosisView: { hidden: false, value: 72, basis: "plan", learning: "yes", horizon: "top" } }),
    { hidden: false, value: 72 },
  );
});

test("tooltip-teksten følger tilstanden; den gamle prognose beholder sin", () => {
  assert.equal(prognosisTitleKey({ hidden: false, value: 61 }), "riders:potentialNumber.prognosisTitle");
  assert.equal(prognosisTitleKey({ hidden: false, value: 61, basis: "trend" }), "riders:potentialNumber.prognosisTrendTitle");
  assert.equal(prognosisTitleKey({ hidden: false, value: 61, basis: "trend", learning: true }), "riders:potentialNumber.prognosisLearningTitle");
  assert.equal(prognosisTitleKey({ hidden: false, value: 61, basis: "trend", horizon: "year" }), "riders:potentialNumber.prognosisYearTitle");
  assert.equal(prognosisTitleKey({ hidden: true, reason: "pastPeak" }), "riders:potentialNumber.prognosisPastPeakTitle");
  assert.equal(prognosisTitleKey({ hidden: true, reason: "noEstimate" }), "riders:potentialNumber.prognosisNoEstimateTitle");
});
