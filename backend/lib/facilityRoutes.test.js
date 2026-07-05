// Wave A1 (#1441 Fase 3) — route-handler-tests for /api/club/facilities + staff.
// api.js-routes er ikke unit-testbare (repo-konvention: source-contract-regex-tests);
// derfor ligger logikken i facilityRoutesHandlers.js (rene handlers → {status, body})
// og api.js wirer tyndt. Denne fil tester: shape, fejl-mapping (403/400/409/404),
// role-validering og flag-gate. Auth (401/"No team" 404) dækkes af den delte
// requireAuth-middleware + source-contract-testen nederst.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  resolveActiveSeason,
  getClubFacilitiesHandler,
  postFacilityUpgradeHandler,
  getStaffCandidatesHandler,
  postStaffHireHandler,
  postStaffFireHandler,
} = await import("./facilityRoutesHandlers.js");
const { FACILITY_TRACKS, FACILITY_TIER_UPKEEP, FACILITY_TIER_PRICE } = await import("./facilityConstants.js");
const { effectiveBonus } = await import("./facilityEngine.js");
const { generateStaffCandidates } = await import("./staffCandidates.js");

const ENABLED = { facilitiesEnabled: true };
const TEAM_ID = "team-1";

// Minimal mock: dækker de query-kæder handlerne bruger (select→eq[→eq][→maybeSingle]).
function createSupabaseMock({ facilities = [], staff = [], season = { id: "season-1", number: 3 } } = {}) {
  return {
    from(table) {
      if (table === "seasons") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: season, error: null }) }) }) };
      }
      if (table === "team_facilities") {
        return {
          select: (cols) => ({
            eq: (col, val) => {
              assert.equal(col, "team_id");
              assert.equal(val, TEAM_ID);
              if (cols === "track, tier") {
                // GET facilities: liste-query (await'es direkte).
                const p = Promise.resolve({ data: facilities, error: null });
                p.eq = (c2, track) => ({
                  maybeSingle: () => Promise.resolve({
                    data: facilities.find((f) => f.track === track) ?? null, error: null,
                  }),
                });
                return p;
              }
              // candidates: select("tier").eq(team_id).eq(track).maybeSingle()
              return {
                eq: (c2, track) => {
                  assert.equal(c2, "track");
                  return {
                    maybeSingle: () => Promise.resolve({
                      data: facilities.find((f) => f.track === track) ?? null, error: null,
                    }),
                  };
                },
              };
            },
          }),
        };
      }
      if (table === "team_staff") {
        return {
          select: () => ({
            eq: () => ({
              eq: (col, val) => {
                assert.equal(col, "status");
                assert.equal(val, "active");
                return Promise.resolve({ data: staff, error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// ── resolveActiveSeason ──────────────────────────────────────────────────────

test("resolveActiveSeason returnerer id+nummer fra aktiv sæson", async () => {
  const season = await resolveActiveSeason(createSupabaseMock({ season: { id: "s9", number: 9 } }));
  assert.deepEqual(season, { seasonId: "s9", seasonNumber: 9 });
});

test("resolveActiveSeason fallback: ingen aktiv sæson → { null, 1 }", async () => {
  const season = await resolveActiveSeason(createSupabaseMock({ season: null }));
  assert.deepEqual(season, { seasonId: null, seasonNumber: 1 });
});

// ── GET /api/club/facilities ────────────────────────────────────────────────

test("GET facilities: 5 spor, manglende rows = tier 0, upkeep + upgradePrice + effectiveBonus", async () => {
  const supabase = createSupabaseMock({
    facilities: [{ track: "training", tier: 2 }, { track: "commercial", tier: 5 }],
    staff: [{ name: "Sofie Lindqvist", role: "training", tier: 2, salary: 22_000 }],
  });
  const { status, body } = await getClubFacilitiesHandler({ teamId: TEAM_ID }, supabase, { flags: ENABLED });
  assert.equal(status, 200);
  assert.equal(body.facilities.length, FACILITY_TRACKS.length);
  assert.deepEqual(body.facilities.map((f) => f.track), [...FACILITY_TRACKS]);

  const training = body.facilities.find((f) => f.track === "training");
  assert.equal(training.tier, 2);
  assert.equal(training.upgradePrice, FACILITY_TIER_PRICE[3]);
  assert.equal(training.tierUpkeep, FACILITY_TIER_UPKEEP[2]);
  assert.deepEqual(training.staff, { name: "Sofie Lindqvist", tier: 2, salary: 22_000 });
  assert.equal(training.effectiveBonus, effectiveBonus("training", 2, 2));

  const commercial = body.facilities.find((f) => f.track === "commercial");
  assert.equal(commercial.upgradePrice, null); // max tier
  assert.equal(commercial.staff, null);
  assert.equal(commercial.effectiveBonus, effectiveBonus("commercial", 5, null)); // 50% uden staff

  const scouting = body.facilities.find((f) => f.track === "scouting");
  assert.equal(scouting.tier, 0);
  assert.equal(scouting.upgradePrice, FACILITY_TIER_PRICE[1]);
  assert.equal(scouting.tierUpkeep, 0);
  assert.equal(scouting.effectiveBonus, 0);
});

test("GET facilities: flag off → 403 facilities_disabled", async () => {
  const { status, body } = await getClubFacilitiesHandler({ teamId: TEAM_ID }, createSupabaseMock());
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

// ── POST /api/club/facilities/upgrade ───────────────────────────────────────

test("POST upgrade: happy path → 200 med service-resultat", async () => {
  const { status, body } = await postFacilityUpgradeHandler(
    { teamId: TEAM_ID, track: "training", seasonId: "s1", seasonNumber: 3 },
    createSupabaseMock(),
    {
      flags: ENABLED,
      purchaseFacilityUpgrade: async (args, _sb, flags) => {
        assert.equal(args.teamId, TEAM_ID);
        assert.equal(args.track, "training");
        assert.equal(flags.facilitiesEnabled, true);
        return { ok: true, track: "training", tier: 1, price: FACILITY_TIER_PRICE[1] };
      },
    }
  );
  assert.equal(status, 200);
  assert.equal(body.tier, 1);
});

for (const err of ["invalid_track", "max_tier", "insufficient_funds"]) {
  test(`POST upgrade: domænefejl ${err} → 400 med fejlkode`, async () => {
    const { status, body } = await postFacilityUpgradeHandler(
      { teamId: TEAM_ID, track: "training" },
      createSupabaseMock(),
      { flags: ENABLED, purchaseFacilityUpgrade: async () => ({ ok: false, error: err }) }
    );
    assert.equal(status, 400);
    assert.equal(body.error, err);
  });
}

test("POST upgrade: flag off → 403 facilities_disabled (via ægte service-gate)", async () => {
  // Default flags (FACILITIES_ENABLED=false) + ægte facilityService: gaten
  // returnerer før noget DB-kald, så en tom mock er nok.
  const { status, body } = await postFacilityUpgradeHandler(
    { teamId: TEAM_ID, track: "training" },
    createSupabaseMock()
  );
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

// ── GET /api/club/staff/candidates ──────────────────────────────────────────

test("GET candidates: ugyldig role → 400 invalid_role", async () => {
  const { status, body } = await getStaffCandidatesHandler(
    { teamId: TEAM_ID, role: "espionage", seasonNumber: 3 },
    createSupabaseMock(),
    { flags: ENABLED }
  );
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_role");
});

test("GET candidates: bruger holdets NUVÆRENDE facilitets-tier + deterministisk output", async () => {
  const supabase = createSupabaseMock({ facilities: [{ track: "training", tier: 3 }] });
  const { status, body } = await getStaffCandidatesHandler(
    { teamId: TEAM_ID, role: "training", seasonNumber: 3 },
    supabase,
    { flags: ENABLED }
  );
  assert.equal(status, 200);
  assert.equal(body.facilityTier, 3);
  assert.deepEqual(
    body.candidates,
    generateStaffCandidates({ teamId: TEAM_ID, seasonNumber: 3, role: "training", facilityTier: 3 })
  );
  assert.equal(body.candidates.length, 3);
  assert.ok(body.candidates.every((c) => c.tier >= 1 && c.tier <= 3));
});

test("GET candidates: flag off → 403 facilities_disabled", async () => {
  const { status, body } = await getStaffCandidatesHandler(
    { teamId: TEAM_ID, role: "training", seasonNumber: 3 },
    createSupabaseMock()
  );
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

// ── POST /api/club/staff/hire ───────────────────────────────────────────────

test("POST hire: role_occupied → 409", async () => {
  const { status, body } = await postStaffHireHandler(
    { teamId: TEAM_ID, role: "training", candidateName: "X" },
    createSupabaseMock(),
    { flags: ENABLED, hireStaff: async () => ({ ok: false, error: "role_occupied" }) }
  );
  assert.equal(status, 409);
  assert.equal(body.error, "role_occupied");
});

for (const err of ["invalid_candidate", "staff_tier_exceeds_facility", "insufficient_funds", "invalid_staff_tier"]) {
  test(`POST hire: domænefejl ${err} → 400`, async () => {
    const { status, body } = await postStaffHireHandler(
      { teamId: TEAM_ID, role: "training", candidateName: "X" },
      createSupabaseMock(),
      { flags: ENABLED, hireStaff: async () => ({ ok: false, error: err }) }
    );
    assert.equal(status, 400);
    assert.equal(body.error, err);
  });
}

test("POST hire: happy path → 200 med staff", async () => {
  const staff = { name: "Sofie Lindqvist", role: "training", tier: 2, salary: 22_000 };
  const { status, body } = await postStaffHireHandler(
    { teamId: TEAM_ID, role: "training", candidateName: staff.name },
    createSupabaseMock(),
    { flags: ENABLED, hireStaff: async () => ({ ok: true, staff }) }
  );
  assert.equal(status, 200);
  assert.deepEqual(body.staff, staff);
});

test("POST hire: flag off → 403 facilities_disabled (via ægte service-gate)", async () => {
  const { status, body } = await postStaffHireHandler(
    { teamId: TEAM_ID, role: "training", candidateName: "X" },
    createSupabaseMock()
  );
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

// ── POST /api/club/staff/fire ───────────────────────────────────────────────

test("POST fire: no_active_staff → 404", async () => {
  const { status, body } = await postStaffFireHandler(
    { teamId: TEAM_ID, role: "training" },
    createSupabaseMock(),
    { flags: ENABLED, fireStaff: async () => ({ ok: false, error: "no_active_staff" }) }
  );
  assert.equal(status, 404);
  assert.equal(body.error, "no_active_staff");
});

test("POST fire: happy path → 200 med severance", async () => {
  const { status, body } = await postStaffFireHandler(
    { teamId: TEAM_ID, role: "training" },
    createSupabaseMock(),
    { flags: ENABLED, fireStaff: async () => ({ ok: true, severance: 11_000 }) }
  );
  assert.equal(status, 200);
  assert.equal(body.severance, 11_000);
});

test("POST fire: flag off → 403 facilities_disabled (via ægte service-gate)", async () => {
  const { status, body } = await postStaffFireHandler(
    { teamId: TEAM_ID, role: "training" },
    createSupabaseMock()
  );
  assert.equal(status, 403);
  assert.equal(body.error, "facilities_disabled");
});

// ── Source-contract: api.js wirer routes tyndt med requireAuth + team-guard ─
// (samme mønster som loanAmountValidation.routes.test.js — beviser at auth-
// middleware + "No team"-guard sidder på hver route uden at starte Express.)

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

const CLUB_ROUTES = [
  ['router.get("/club/facilities"', "getClubFacilitiesHandler"],
  ['router.post("/club/facilities/upgrade"', "postFacilityUpgradeHandler"],
  ['router.get("/club/staff/candidates"', "getStaffCandidatesHandler"],
  ['router.post("/club/staff/hire"', "postStaffHireHandler"],
  ['router.post("/club/staff/fire"', "postStaffFireHandler"],
];

for (const [marker, handler] of CLUB_ROUTES) {
  test(`api.js: ${marker.split('"')[1]} har requireAuth + No-team-guard + delegerer til ${handler}`, () => {
    const start = apiSource.indexOf(marker);
    assert.notEqual(start, -1, `route ${marker} findes ikke i api.js`);
    const end = apiSource.indexOf("router.", start + marker.length);
    const block = apiSource.slice(start, end === -1 ? apiSource.length : end);
    assert.match(block, /requireAuth/, "route skal bruge requireAuth");
    assert.match(block, /if \(!req\.team\?\.id\) return res\.status\(404\)\.json\(\{ error: "No team" \}\)/, "route skal have No-team-guard (404, samme konvention som sponsor-routes)");
    assert.ok(block.includes(handler), `route skal delegere til ${handler}`);
  });
}
