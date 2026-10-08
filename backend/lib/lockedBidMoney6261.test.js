// #6261-#6264: route-handlerne skal sende det låste beløb videre, så UI'et kan
// sige "låst i auktionsbud" i stedet for en generisk fejl. Selve gaten testes i
// facilityService.test.js (anlæg/ansættelse/fratrædelse) og academyIntake.test.js
// (akademi-signing).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const { postFacilityUpgradeHandler, postStaffHireHandler, postStaffReleaseHandler } =
  await import("./facilityRoutesHandlers.js");

const locked = { ok: false, error: "insufficient_available_balance", locked: 40, available: 10 };
const ENABLED = { facilitiesEnabled: true };
const ARGS = { teamId: "team-1", seasonId: "s1", seasonNumber: 1 };

test("upgrade-handler: insufficient_available_balance giver 400 med locked/available", async () => {
  const res = await postFacilityUpgradeHandler({ ...ARGS, track: "training" }, {}, {
    flags: ENABLED, purchaseFacilityUpgrade: async () => locked,
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "insufficient_available_balance", locked: 40, available: 10 });
});

test("hire-handler: insufficient_available_balance giver 400 med locked/available", async () => {
  const res = await postStaffHireHandler({ ...ARGS, role: "training", candidateName: "X" }, {}, {
    flags: ENABLED, hireStaff: async () => locked,
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "insufficient_available_balance", locked: 40, available: 10 });
});

test("release-handler: insufficient_available_balance bærer locked/available + severance", async () => {
  const res = await postStaffReleaseHandler({ ...ARGS, staffId: "st1" }, {}, {
    flags: ENABLED, releaseStaff: async () => ({ ...locked, severance: 5, balance: 50 }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: "insufficient_available_balance", locked: 40, available: 10, severance: 5, balance: 50,
  });
});

test("handlers: uden locked-felter er body uændret (insufficient_funds)", async () => {
  const res = await postFacilityUpgradeHandler({ ...ARGS, track: "training" }, {}, {
    flags: ENABLED, purchaseFacilityUpgrade: async () => ({ ok: false, error: "insufficient_funds" }),
  });
  assert.deepEqual(res.body, { error: "insufficient_funds" });
});
