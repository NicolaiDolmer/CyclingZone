// #2601 — tests for offentlig holdside-visning (teamPublicProfileHandlers.js).
// Samme mønster som staffOverview.test.js: rene handlers → {status, body} mod en
// minimal supabase-query-mock, + source-contract-test for api.js-wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { getTeamPublicProfileHandler } = await import("./teamPublicProfileHandlers.js");
const { FACILITY_TRACKS } = await import("./facilityConstants.js");

const ENABLED = { facilitiesEnabled: true };

function createSupabase({ teamExists = true, staffRows = [], facilityRows = [] } = {}) {
  return {
    from(table) {
      if (table === "teams") {
        return {
          select: () => ({
            eq: (col, val) => {
              assert.equal(col, "id");
              return { maybeSingle: () => Promise.resolve({ data: teamExists ? { id: val } : null, error: null }) };
            },
          }),
        };
      }
      if (table === "team_staff") {
        return {
          select: () => ({
            eq: (col1, val1) => {
              assert.equal(col1, "team_id");
              void val1;
              return {
                eq: (col2, val2) => {
                  assert.equal(col2, "status");
                  assert.equal(val2, "active");
                  return Promise.resolve({ data: staffRows, error: null });
                },
              };
            },
          }),
        };
      }
      if (table === "team_facilities") {
        return {
          select: () => ({
            eq: (col) => {
              assert.equal(col, "team_id");
              return Promise.resolve({ data: facilityRows, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("GET team public-profile: flag off → 403 facilities_disabled", async () => {
  const supabase = createSupabase();
  const { status, body } = await getTeamPublicProfileHandler({ teamId: "team-a" }, supabase);
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

test("GET team public-profile: ukendt hold → 404 team_not_found", async () => {
  const supabase = createSupabase({ teamExists: false });
  const { status, body } = await getTeamPublicProfileHandler({ teamId: "nope" }, supabase, { flags: ENABLED });
  assert.equal(status, 404);
  assert.equal(body.error, "team_not_found");
});

test("GET team public-profile: mangler teamId → 404 team_not_found (uden DB-kald)", async () => {
  const { status, body } = await getTeamPublicProfileHandler({ teamId: undefined }, createSupabase(), { flags: ENABLED });
  assert.equal(status, 404);
  assert.equal(body.error, "team_not_found");
});

test("GET team public-profile: faciliteter dækker ALLE spor, manglende row = tier 0", async () => {
  const supabase = createSupabase({ facilityRows: [{ track: "training", tier: 3 }] });
  const { status, body } = await getTeamPublicProfileHandler({ teamId: "team-a" }, supabase, { flags: ENABLED });
  assert.equal(status, 200);
  assert.deepEqual(body.facilities.map((f) => f.track), FACILITY_TRACKS);
  const training = body.facilities.find((f) => f.track === "training");
  const scouting = body.facilities.find((f) => f.track === "scouting");
  assert.equal(training.tier, 3);
  assert.equal(scouting.tier, 0);
});

test("GET team public-profile: SANITERING — staff har ALDRIG salary/kontrakt-felter", async () => {
  const staffRows = [{ id: "s1", role: "training", tier: 4, salary: 55_000, name: "Iker Zabaleta" }];
  const supabase = createSupabase({ staffRows });
  const { body } = await getTeamPublicProfileHandler({ teamId: "team-a" }, supabase, { flags: ENABLED });

  const row = body.staff[0];
  assert.equal(row.name, "Iker Zabaleta");
  assert.equal(row.role, "training");
  assert.equal(row.tier, 4);
  assert.equal("salary" in row, false, "top-level staff må ALDRIG eksponere løn");
  assert.equal("hired_season" in row, false);
  assert.equal("fired_season" in row, false);
  assert.equal("dimensions" in row, false);
  assert.equal("levels" in row, false);
  assert.equal("roleSkills" in row, false);

  const facilityStaff = body.facilities.find((f) => f.track === "training").staff;
  assert.equal(facilityStaff.name, "Iker Zabaleta");
  assert.equal(facilityStaff.tier, 4);
  assert.equal("salary" in facilityStaff, false, "facilitets-tilknyttet staff må ALDRIG eksponere løn");
  assert.equal("overall" in facilityStaff, false, "overall bruges kun internt til effectiveBonus, eksponeres ikke");
});

test("GET team public-profile: SANITERING — faciliteter har ALDRIG opgraderings-økonomi", async () => {
  const facilityRows = [{ track: "training", tier: 2 }];
  const supabase = createSupabase({ facilityRows });
  const { body } = await getTeamPublicProfileHandler({ teamId: "team-a" }, supabase, { flags: ENABLED });

  const row = body.facilities.find((f) => f.track === "training");
  assert.equal(row.tier, 2);
  assert.equal(typeof row.effectiveBonus, "number");
  assert.equal(typeof row.effectLive, "boolean");
  assert.equal("upgradePrice" in row, false, "må ALDRIG eksponere opgraderings-pris");
  assert.equal("nextTierBonus" in row, false, "må ALDRIG eksponere næste-tier-preview");
  assert.equal("tierUpkeep" in row, false, "må ALDRIG eksponere upkeep-økonomi");
  assert.equal("seasonCost" in body, false, "må ALDRIG eksponere sæson-økonomi (upkeep/payroll/balance)");
});

// ── Source-contract: api.js wirer ruten tyndt (samme mønster som
// STAFF_OVERVIEW_ROUTES i staffOverview.test.js) ────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

test('api.js: GET /teams/:id/public-profile har requireAuth + No-team-guard + delegerer til getTeamPublicProfileHandler', () => {
  const marker = 'router.get("/teams/:id/public-profile"';
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route ${marker} findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  const block = apiSource.slice(start, end === -1 ? apiSource.length : end);
  assert.match(block, /requireAuth/, "route skal bruge requireAuth");
  assert.match(block, /if \(!req\.team\?\.id\) return res\.status\(404\)\.json\(\{ error: "No team" \}\)/, "route skal have No-team-guard");
  assert.ok(block.includes("getTeamPublicProfileHandler"), "route skal delegere til getTeamPublicProfileHandler");
});
