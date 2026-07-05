import test from "node:test";
import assert from "node:assert/strict";
import { FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP, STAFF_SALARY_BY_TIER, FACILITY_BASE_EFFECT } from "../../../backend/lib/facilityConstants.js";
import { __constants } from "./clubMock.js"; // eksportér et __constants-objekt til testen

test("clubMock-konstanter matcher backend (co-SSOT)", () => {
  assert.deepEqual(__constants.PRICE, { ...FACILITY_TIER_PRICE });
  assert.deepEqual(__constants.UPKEEP, { ...FACILITY_TIER_UPKEEP });
  assert.deepEqual(__constants.SALARY, { ...STAFF_SALARY_BY_TIER });
  for (const track of Object.keys(FACILITY_BASE_EFFECT)) {
    assert.deepEqual(__constants.BASE_EFFECT[track], { ...FACILITY_BASE_EFFECT[track] });
  }
});
