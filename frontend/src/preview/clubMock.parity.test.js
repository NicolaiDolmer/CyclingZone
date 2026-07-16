import test from "node:test";
import assert from "node:assert/strict";
import {
  FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP, STAFF_SALARY_BY_TIER, FACILITY_BASE_EFFECT, EFFECT_LIVE_BY_TRACK,
} from "../../../backend/lib/facilityConstants.js";
import { __constants } from "./clubMock.js"; // eksportér et __constants-objekt til testen

test("clubMock-konstanter matcher backend (co-SSOT)", () => {
  assert.deepEqual(__constants.PRICE, { ...FACILITY_TIER_PRICE });
  assert.deepEqual(__constants.UPKEEP, { ...FACILITY_TIER_UPKEEP });
  assert.deepEqual(__constants.SALARY, { ...STAFF_SALARY_BY_TIER });
  for (const track of Object.keys(FACILITY_BASE_EFFECT)) {
    assert.deepEqual(__constants.BASE_EFFECT[track], { ...FACILITY_BASE_EFFECT[track] });
  }
});

// #2530: effectLive-flaget skal ALDRIG drive fra backend'ens EFFECT_LIVE_BY_TRACK —
// ellers viser ejerens preview en anden facilitets-status end prod (bidt før, jf.
// feedback_owner_must_be_able_to_test_on_preview).
test("clubMock effectLive matcher backend EFFECT_LIVE_BY_TRACK (co-SSOT)", () => {
  assert.deepEqual(__constants.EFFECT_LIVE_BY_TRACK, { ...EFFECT_LIVE_BY_TRACK });
});
