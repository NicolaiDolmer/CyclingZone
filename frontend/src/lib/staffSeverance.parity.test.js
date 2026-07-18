import test from "node:test";
import assert from "node:assert/strict";
import {
  STAFF_RELEASE_SEASON_WEEKS as BE_WEEKS,
  STAFF_RELEASE_SEVERANCE_WEEKS as BE_FACTOR,
  staffWeeklyWage as beWeeklyWage,
  staffReleaseSeverance as beSeverance,
} from "../../../backend/lib/facilityConstants.js";
import {
  STAFF_RELEASE_SEASON_WEEKS as FE_WEEKS,
  STAFF_RELEASE_SEVERANCE_WEEKS as FE_FACTOR,
  staffWeeklyWage as feWeeklyWage,
  staffReleaseSeverance as feSeverance,
} from "./staffSeverance.js";

// #2649 co-SSOT-guard (samme disciplin som clubMock.parity.test.js): frontend
// regner severance-forhåndsvisningen ud selv (ingen quote-roundtrip), så en drift
// mellem de to formler ville vise ét beløb i dialogen og trække et andet ved
// bekræftelse — denne test fanger det ved næste ændring af enten side.
test("frontend staffSeverance-konstanter/formel matcher backend (co-SSOT)", () => {
  assert.equal(FE_WEEKS, BE_WEEKS);
  assert.equal(FE_FACTOR, BE_FACTOR);
  for (const salary of [0, 100, 2_600, 8_000, 22_000, 22_001, 100_000]) {
    assert.equal(feWeeklyWage(salary), beWeeklyWage(salary), `weeklyWage(${salary})`);
    assert.equal(feSeverance(salary), beSeverance(salary), `severance(${salary})`);
  }
});
