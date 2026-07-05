// Wave A1 (#1441 Fase 3) — testbare handlers for klub-facilitets-/staff-routes.
// api.js-routes er tynde wrappers (requireAuth + team-resolve + res.status(...).json(...));
// al route-logik ligger her så den kan unit-testes (api.js selv er ikke unit-testbar —
// eksisterende konvention er source-contract-tests, se loanAmountValidation.routes.test.js).
// Ingen forretningslogik: delegerer til facilityService og mapper domænefejl → HTTP-status.
import { FACILITIES_ENABLED, FACILITY_TRACKS, FACILITY_TIER_UPKEEP } from "./facilityConstants.js";
import { getUpgradePrice, effectiveBonus } from "./facilityEngine.js";
import { generateStaffCandidates } from "./staffCandidates.js";
import {
  purchaseFacilityUpgrade as defaultPurchase,
  hireStaff as defaultHire,
  fireStaff as defaultFire,
} from "./facilityService.js";

const DEFAULT_FLAGS = Object.freeze({ facilitiesEnabled: FACILITIES_ENABLED });

// Domænefejl → HTTP-status. facilities_disabled er altid 403; resten 400 med
// mindre ruten har en specifik override (409 role_occupied, 404 no_active_staff).
function statusForError(error, overrides = {}) {
  if (error === "facilities_disabled") return 403;
  return overrides[error] ?? 400;
}

// Aktiv sæson (id + nummer). Frisk DB / ingen aktiv sæson → { null, 1 }
// (samme fallback-idiom som resolveCurrentSeasonNumber i api.js).
export async function resolveActiveSeason(supabaseClient) {
  const { data, error } = await supabaseClient
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`facilityRoutes: could not resolve active season: ${error.message}`);
  return { seasonId: data?.id ?? null, seasonNumber: data?.number ?? 1 };
}

// GET /api/club/facilities — alle 5 spor med tier (manglende row = 0),
// upgrade-pris (null ved max), tier-upkeep, aktiv staff og effektiv bonus.
export async function getClubFacilitiesHandler({ teamId }, supabaseClient, { flags = DEFAULT_FLAGS } = {}) {
  if (!flags.facilitiesEnabled) return { status: 403, body: { error: "facilities_disabled" } };

  const { data: facilityRows, error: facilityError } = await supabaseClient
    .from("team_facilities")
    .select("track, tier")
    .eq("team_id", teamId);
  if (facilityError) throw new Error(`facilityRoutes: could not load facilities for ${teamId}: ${facilityError.message}`);

  const { data: staffRows, error: staffError } = await supabaseClient
    .from("team_staff")
    .select("name, role, tier, salary")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (staffError) throw new Error(`facilityRoutes: could not load staff for ${teamId}: ${staffError.message}`);

  const tierByTrack = new Map((facilityRows ?? []).map((r) => [r.track, r.tier]));
  const staffByRole = new Map((staffRows ?? []).map((s) => [s.role, s]));

  const facilities = FACILITY_TRACKS.map((track) => {
    const tier = tierByTrack.get(track) ?? 0;
    const staff = staffByRole.get(track) ?? null;
    return {
      track,
      tier,
      upgradePrice: getUpgradePrice(tier),
      tierUpkeep: FACILITY_TIER_UPKEEP[tier] ?? 0,
      staff: staff ? { name: staff.name, tier: staff.tier, salary: staff.salary } : null,
      effectiveBonus: effectiveBonus(track, tier, staff?.tier ?? null),
    };
  });

  return { status: 200, body: { facilities } };
}

// POST /api/club/facilities/upgrade — body { track }.
export async function postFacilityUpgradeHandler(
  { teamId, track, seasonId, seasonNumber },
  supabaseClient,
  { flags = DEFAULT_FLAGS, purchaseFacilityUpgrade = defaultPurchase } = {}
) {
  const result = await purchaseFacilityUpgrade({ teamId, track, seasonId, seasonNumber }, supabaseClient, flags);
  if (!result.ok) return { status: statusForError(result.error), body: { error: result.error } };
  return { status: 200, body: result };
}

// GET /api/club/staff/candidates?role=... — deterministiske kandidater for
// holdets NUVÆRENDE facilitets-tier på sporet.
export async function getStaffCandidatesHandler(
  { teamId, role, seasonNumber },
  supabaseClient,
  { flags = DEFAULT_FLAGS } = {}
) {
  if (!flags.facilitiesEnabled) return { status: 403, body: { error: "facilities_disabled" } };
  if (!FACILITY_TRACKS.includes(role)) return { status: 400, body: { error: "invalid_role" } };

  const { data, error } = await supabaseClient
    .from("team_facilities")
    .select("tier")
    .eq("team_id", teamId)
    .eq("track", role)
    .maybeSingle();
  if (error) throw new Error(`facilityRoutes: could not load facility tier for ${teamId}/${role}: ${error.message}`);
  const facilityTier = data?.tier ?? 0;

  const candidates = generateStaffCandidates({ teamId, seasonNumber, role, facilityTier });
  return { status: 200, body: { role, facilityTier, candidates } };
}

// POST /api/club/staff/hire — body { role, candidateName }. role_occupied → 409.
export async function postStaffHireHandler(
  { teamId, role, candidateName, seasonId, seasonNumber },
  supabaseClient,
  { flags = DEFAULT_FLAGS, hireStaff = defaultHire } = {}
) {
  const result = await hireStaff({ teamId, role, candidateName, seasonId, seasonNumber }, supabaseClient, flags);
  if (!result.ok) return { status: statusForError(result.error, { role_occupied: 409 }), body: { error: result.error } };
  return { status: 200, body: result };
}

// POST /api/club/staff/fire — body { role }. no_active_staff → 404.
export async function postStaffFireHandler(
  { teamId, role, seasonId, seasonNumber },
  supabaseClient,
  { flags = DEFAULT_FLAGS, fireStaff = defaultFire } = {}
) {
  const result = await fireStaff({ teamId, role, seasonId, seasonNumber }, supabaseClient, flags);
  if (!result.ok) return { status: statusForError(result.error, { no_active_staff: 404 }), body: { error: result.error } };
  return { status: 200, body: result };
}
