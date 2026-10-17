// #6666 (ejer 16/10): akademi-faciliteten åbner SAMMEN med optag 2.0. Køb og effekt
// følger app_config-flaget academy_intake_pull_enabled — klubsiden, holdsiden og
// købs-handleren skal være enige, og der kan ikke ansættes en akademichef (ingen effekt).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  getClubFacilitiesHandler,
  postFacilityUpgradeHandler,
  getStaffCandidatesHandler,
  postStaffHireHandler,
} = await import("./facilityRoutesHandlers.js");
const { getTeamPublicProfileHandler } = await import("./teamPublicProfileHandlers.js");
const { isTrackEffectLive, MAX_STAFF_SLOTS_PER_ROLE } = await import("./facilityConstants.js");
const { candidatesForTier } = await import("./academyIntakeProfile.ts");

const TEAM_ID = "team-1";
const FLAG_KEY = "academy_intake_pull_enabled";

// Generisk fake: select/eq-kæder filtrerer rækker; await giver listen, maybeSingle den første.
function fakeDb(tables) {
  return {
    from(table) {
      const filters = [];
      const run = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const q = {
        select() { return q; },
        eq(col, val) { filters.push([col, val]); return q; },
        maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
      };
      return q;
    },
  };
}

function db({ flag = null, academyTier = 2 } = {}) {
  return fakeDb({
    app_config: flag == null ? [] : [{ key: FLAG_KEY, value: flag }],
    teams: [{ id: TEAM_ID, balance: 500_000 }],
    team_facilities: [
      { team_id: TEAM_ID, track: "training", tier: 1 },
      { team_id: TEAM_ID, track: "academy", tier: academyTier },
    ],
    team_staff: [],
  });
}

const ENABLED = { facilitiesEnabled: true };

test("isTrackEffectLive: akademiet følger flaget, øvrige spor følger den kompilerede tabel", () => {
  assert.equal(isTrackEffectLive("academy"), false);
  assert.equal(isTrackEffectLive("academy", { academyIntakePullEnabled: true }), true);
  assert.equal(isTrackEffectLive("training"), true);
  assert.equal(isTrackEffectLive("commercial", { academyIntakePullEnabled: true }), false);
});

test("GET club facilities: flag slukket → akademiet er 'kommer snart', ingen staff-plads", async () => {
  const { status, body } = await getClubFacilitiesHandler({ teamId: TEAM_ID }, db(), { flags: ENABLED });
  assert.equal(status, 200);
  const academy = body.facilities.find((f) => f.track === "academy");
  const training = body.facilities.find((f) => f.track === "training");
  assert.equal(academy.effectLive, false);
  assert.equal(academy.staffSlotsMax, 0);
  assert.equal(training.effectLive, true);
  assert.equal(training.staffSlotsMax, MAX_STAFF_SLOTS_PER_ROLE);
});

test("GET club facilities: flag tændt (app_config 'on') → akademiet er live med kuldstørrelse som effekt", async () => {
  const { body } = await getClubFacilitiesHandler({ teamId: TEAM_ID }, db({ flag: "on", academyTier: 2 }), { flags: ENABLED });
  const academy = body.facilities.find((f) => f.track === "academy");
  assert.equal(academy.effectLive, true);
  assert.equal(academy.effectiveBonus, candidatesForTier(2));
  assert.equal(academy.nextTierBonus, candidatesForTier(3));
});

test("GET club facilities: 'beta' tænder ikke akademiet (flaget er globalt, ingen viewer-gate)", async () => {
  const { body } = await getClubFacilitiesHandler({ teamId: TEAM_ID }, db({ flag: "beta" }), { flags: ENABLED });
  assert.equal(body.facilities.find((f) => f.track === "academy").effectLive, false);
});

test("GET club facilities: injiceret flag vinder over app_config", async () => {
  const { body } = await getClubFacilitiesHandler(
    { teamId: TEAM_ID }, db({ flag: "on" }), { flags: { ...ENABLED, academyIntakePullEnabled: false } });
  assert.equal(body.facilities.find((f) => f.track === "academy").effectLive, false);
});

test("POST upgrade academy: flag slukket → 403 facility_track_unavailable, intet køb", async () => {
  let called = false;
  const purchaseFacilityUpgrade = async () => { called = true; return { ok: true }; };
  const res = await postFacilityUpgradeHandler(
    { teamId: TEAM_ID, track: "academy", seasonId: "s", seasonNumber: 3 }, db(), { flags: ENABLED, purchaseFacilityUpgrade });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "facility_track_unavailable");
  assert.equal(called, false);
});

test("POST upgrade academy: flag tændt → købet går til facilityService med eksisterende priser", async () => {
  let args = null;
  const purchaseFacilityUpgrade = async (a) => { args = a; return { ok: true, track: a.track, newTier: 3 }; };
  const res = await postFacilityUpgradeHandler(
    { teamId: TEAM_ID, track: "academy", seasonId: "s", seasonNumber: 3 }, db({ flag: "on" }), { flags: ENABLED, purchaseFacilityUpgrade });
  assert.equal(res.status, 200);
  assert.equal(args.track, "academy");
});

test("POST upgrade training: uberørt af akademi-flaget", async () => {
  let called = false;
  const purchaseFacilityUpgrade = async () => { called = true; return { ok: true }; };
  const res = await postFacilityUpgradeHandler(
    { teamId: TEAM_ID, track: "training", seasonId: "s", seasonNumber: 3 }, db(), { flags: ENABLED, purchaseFacilityUpgrade });
  assert.equal(res.status, 200);
  assert.equal(called, true);
});

test("Akademichef: kandidater og ansættelse afvises (ingen effekt = ingen løn)", async () => {
  const cand = await getStaffCandidatesHandler({ teamId: TEAM_ID, role: "academy", seasonNumber: 3 }, db({ flag: "on" }), { flags: ENABLED });
  assert.equal(cand.status, 400);
  assert.equal(cand.body.error, "staff_role_unavailable");

  let called = false;
  const hireStaff = async () => { called = true; return { ok: true }; };
  const hire = await postStaffHireHandler(
    { teamId: TEAM_ID, role: "academy", candidateName: "X", seasonId: "s", seasonNumber: 3 }, db({ flag: "on" }), { flags: ENABLED, hireStaff });
  assert.equal(hire.status, 400);
  assert.equal(hire.body.error, "staff_role_unavailable");
  assert.equal(called, false);
});

test("Holdsiden: akademiets live-status følger samme flag som klubsiden", async () => {
  const off = await getTeamPublicProfileHandler({ teamId: TEAM_ID }, db(), { flags: ENABLED });
  const on = await getTeamPublicProfileHandler({ teamId: TEAM_ID }, db({ flag: true }), { flags: ENABLED });
  assert.equal(off.body.facilities.find((f) => f.track === "academy").effectLive, false);
  const academyOn = on.body.facilities.find((f) => f.track === "academy");
  assert.equal(academyOn.effectLive, true);
  assert.equal(academyOn.effectiveBonus, candidatesForTier(2));
});
