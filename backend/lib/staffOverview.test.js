// #2450 — tests for personale-oversigt på tværs af hold (staffOverviewHandlers.js).
// Samme mønster som facilityRoutes.test.js: rene handlers → {status, body} mod en
// minimal supabase-query-mock. api.js-wiring bevises af source-contract-testen
// nederst (samme princip som CLUB_ROUTES i facilityRoutes.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { getStaffDirectoryHandler, getStaffPublicProfileHandler } = await import("./staffOverviewHandlers.js");
const { deriveStaffAbilities, topSpecialization } = await import("./staffAbilityDerivation.js");

const ENABLED = { facilitiesEnabled: true };

const TEAM_A = { id: "team-a", name: "Alpha CC", division: 2, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false };
const TEAM_B = { id: "team-b", name: "Beta Racing", division: 1, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false };
const TEAM_AI = { id: "team-ai", name: "AI Squad", division: 3, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false };
const TEAM_FROZEN = { id: "team-frozen", name: "Frozen FC", division: 3, is_ai: false, is_bank: false, is_frozen: true, is_test_account: false };

function staffRow(id, team, overrides = {}) {
  return {
    id, team_id: team.id, role: "training", tier: 3, salary: 30_000, name: "Sofie Lindqvist",
    teams: team, ...overrides,
  };
}

function createDirectorySupabase(rows) {
  return {
    from(table) {
      if (table !== "team_staff") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, "status");
            assert.equal(val, "active");
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      };
    },
  };
}

test("GET staff directory: kun rigtige hold (ikke-AI/bank/frosne/test) uden includeAi", async () => {
  const rows = [staffRow("s1", TEAM_A), staffRow("s2", TEAM_AI), staffRow("s3", TEAM_FROZEN)];
  const supabase = createDirectorySupabase(rows);
  const { status, body } = await getStaffDirectoryHandler({ includeAi: false }, supabase, { flags: ENABLED });
  assert.equal(status, 200);
  assert.deepEqual(body.staff.map((s) => s.id), ["s1"]);
});

test("GET staff directory: includeAi=true tilføjer AI-hold (frosne/test forbliver skjult)", async () => {
  const rows = [staffRow("s1", TEAM_A), staffRow("s2", TEAM_AI), staffRow("s3", TEAM_FROZEN)];
  const supabase = createDirectorySupabase(rows);
  const { status, body } = await getStaffDirectoryHandler({ includeAi: true }, supabase, { flags: ENABLED });
  assert.equal(status, 200);
  assert.deepEqual(body.staff.map((s) => s.id).sort(), ["s1", "s2"]);
});

test("GET staff directory: candidate-niveau shape — overall/topSpecialization/tier/salary, ALDRIG dimensions/levels/roleSkills", async () => {
  const rows = [staffRow("s1", TEAM_A, { tier: 4, salary: 55_000, name: "Iker Zabaleta" })];
  const supabase = createDirectorySupabase(rows);
  const { body } = await getStaffDirectoryHandler({}, supabase, { flags: ENABLED });
  const row = body.staff[0];
  const derived = deriveStaffAbilities({ role: "training", tier: 4, name: "Iker Zabaleta" });
  assert.equal(row.overall, derived.overall);
  assert.equal(row.topSpecialization, topSpecialization(derived));
  assert.equal(row.tier, 4);
  assert.equal(row.salary, 55_000);
  assert.equal(row.teamId, "team-a");
  assert.equal(row.teamName, "Alpha CC");
  assert.equal(row.division, 2);
  assert.equal("dimensions" in row, false);
  assert.equal("levels" in row, false);
  assert.equal("roleSkills" in row, false);
});

test("GET staff directory: hold på tværs af flere spilledes staff vises samlet (bevis for at RLS-owner-policy nødvendiggør service-role-route, #2450)", async () => {
  const rows = [staffRow("s1", TEAM_A), staffRow("s2", TEAM_B)];
  const supabase = createDirectorySupabase(rows);
  const { body } = await getStaffDirectoryHandler({}, supabase, { flags: ENABLED });
  assert.deepEqual(body.staff.map((s) => s.teamId).sort(), ["team-a", "team-b"]);
});

test("GET staff directory: flag off → 403 facilities_disabled", async () => {
  const supabase = createDirectorySupabase([]);
  const { status, body } = await getStaffDirectoryHandler({});
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
  void supabase;
});

// ── GET /api/staff/:id/public ────────────────────────────────────────────────

function createPublicSupabase({ staff = null } = {}) {
  return {
    from(table) {
      if (table !== "team_staff") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, "id");
            return { maybeSingle: () => Promise.resolve({ data: staff && staff.id === val ? staff : null, error: null }) };
          },
        }),
      };
    },
  };
}

test("GET staff public profile: aktiv staff → 200 med candidate-niveau (ingen fuld evne-matrix)", async () => {
  const staff = { id: "s1", team_id: "team-a", role: "scouting", tier: 3, salary: 28_000, name: "Rune Kristoffersen", status: "active", teams: { id: "team-a", name: "Alpha CC", division: 2 } };
  const supabase = createPublicSupabase({ staff });
  const { status, body } = await getStaffPublicProfileHandler({ staffId: "s1" }, supabase, { flags: ENABLED });
  assert.equal(status, 200);
  const derived = deriveStaffAbilities({ role: "scouting", tier: 3, name: "Rune Kristoffersen" });
  assert.equal(body.overall, derived.overall);
  assert.equal(body.topSpecialization, topSpecialization(derived));
  assert.equal(body.teamName, "Alpha CC");
  assert.equal("dimensions" in body, false);
});

test("GET staff public profile: fyret staff (status != active) → 404", async () => {
  const staff = { id: "s1", team_id: "team-a", role: "scouting", tier: 3, salary: 28_000, name: "X", status: "fired", teams: null };
  const supabase = createPublicSupabase({ staff });
  const { status, body } = await getStaffPublicProfileHandler({ staffId: "s1" }, supabase, { flags: ENABLED });
  assert.equal(status, 404);
  assert.equal(body.error, "staff_not_found");
});

test("GET staff public profile: ukendt staff-id → 404", async () => {
  const supabase = createPublicSupabase({ staff: null });
  const { status, body } = await getStaffPublicProfileHandler({ staffId: "nope" }, supabase, { flags: ENABLED });
  assert.equal(status, 404);
  assert.equal(body.error, "staff_not_found");
});

test("GET staff public profile: flag off → 403 facilities_disabled", async () => {
  const supabase = createPublicSupabase({});
  const { status, body } = await getStaffPublicProfileHandler({ staffId: "x" }, supabase);
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

// ── Source-contract: api.js wirer de nye ruter tyndt (samme mønster som
// CLUB_ROUTES i facilityRoutes.test.js) ─────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

const STAFF_OVERVIEW_ROUTES = [
  ['router.get("/staff/directory"', "getStaffDirectoryHandler"],
  ['router.get("/staff/:id/public"', "getStaffPublicProfileHandler"],
];

for (const [marker, handler] of STAFF_OVERVIEW_ROUTES) {
  test(`api.js: ${marker.split('"')[1]} har requireAuth + No-team-guard + delegerer til ${handler}`, () => {
    const start = apiSource.indexOf(marker);
    assert.notEqual(start, -1, `route ${marker} findes ikke i api.js`);
    const end = apiSource.indexOf("router.", start + marker.length);
    const block = apiSource.slice(start, end === -1 ? apiSource.length : end);
    assert.match(block, /requireAuth/, "route skal bruge requireAuth");
    assert.match(block, /if \(!req\.team\?\.id\) return res\.status\(404\)\.json\(\{ error: "No team" \}\)/, "route skal have No-team-guard (404, samme konvention som klub-staff-routes)");
    assert.ok(block.includes(handler), `route skal delegere til ${handler}`);
  });
}
