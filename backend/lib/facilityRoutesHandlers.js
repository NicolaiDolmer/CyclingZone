// Wave A1 (#1441 Fase 3) — testbare handlers for klub-facilitets-/staff-routes.
// api.js-routes er tynde wrappers (requireAuth + team-resolve + res.status(...).json(...));
// al route-logik ligger her så den kan unit-testes (api.js selv er ikke unit-testbar —
// eksisterende konvention er source-contract-tests, se loanAmountValidation.routes.test.js).
// Ingen forretningslogik: delegerer til facilityService og mapper domænefejl → HTTP-status.
import {
  FACILITIES_ENABLED,
  FACILITY_TRACKS,
  FACILITY_TIER_UPKEEP,
  EFFECT_LIVE_BY_TRACK,
  MAX_FACILITY_TIER,
} from "./facilityConstants.js";
import { getUpgradePrice, effectiveBonus } from "./facilityEngine.js";
import { generateStaffCandidates } from "./staffCandidates.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";
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
    .select("id, name, role, tier, salary")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (staffError) throw new Error(`facilityRoutes: could not load staff for ${teamId}: ${staffError.message}`);

  const tierByTrack = new Map((facilityRows ?? []).map((r) => [r.track, r.tier]));
  const staffByRole = new Map((staffRows ?? []).map((s) => [s.role, s]));

  const facilities = FACILITY_TRACKS.map((track) => {
    const tier = tierByTrack.get(track) ?? 0;
    const staff = staffByRole.get(track) ?? null;
    const upgradePrice = getUpgradePrice(tier);
    // #2216 A4: overall afledes på læsning fra (role,tier,name) — deterministisk,
    // så vi ikke behøver et join for facilitets-oversigten (fuld profil = /club/staff/:id).
    const staffOut = staff
      ? {
          id: staff.id,
          name: staff.name,
          tier: staff.tier,
          salary: staff.salary,
          overall: deriveStaffAbilities({ role: staff.role, tier: staff.tier, name: staff.name }).overall,
        }
      : null;
    return {
      track,
      tier,
      upgradePrice,
      tierUpkeep: FACILITY_TIER_UPKEEP[tier] ?? 0,
      staff: staffOut,
      // #2216 A4 (Task 6): display-magnitude = base × staffEffectFactor(staff) — ability-
      // drevet (overall), IKKE tier-skalaren. staffOut bærer overall (eller null = gulv).
      effectiveBonus: effectiveBonus(track, tier, staffOut),
      effectLive: EFFECT_LIVE_BY_TRACK[track] ?? false,
      // #2311 (Slice 2): tier-preview før køb — hvad NÆSTE tier giver, samme staff
      // holdt konstant (spejler kilden effectiveBonus bruger). null ved max tier
      // (ingen "undefined"-preview i UI).
      nextTierBonus: tier >= MAX_FACILITY_TIER ? null : effectiveBonus(track, tier + 1, staffOut),
    };
  });

  // #2220 A4b: sæson-omkostnings-resume til UI-headeren (upkeep + payroll vs. balance).
  const { data: teamRow, error: teamErr } = await supabaseClient
    .from("teams").select("balance").eq("id", teamId).maybeSingle();
  if (teamErr) throw new Error(`facilityRoutes: could not load balance for ${teamId}: ${teamErr.message}`);
  const totalUpkeep = facilities.reduce((sum, f) => sum + (f.tierUpkeep ?? 0), 0);
  const totalPayroll = (staffRows ?? []).reduce((sum, s) => sum + (s.salary ?? 0), 0);
  const seasonCost = { totalUpkeep, totalPayroll, balance: teamRow?.balance ?? 0 };

  return { status: 200, body: { facilities, seasonCost } };
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

// GET /api/club/staff/:id — fuld evne-profil for en EJET staff.
// Ejerskab håndhæves ved at kræve staff.team_id === teamId (teamId er allerede
// resolvet fra req.team.id). Ukendt/ikke-ejet → 404. Ability-row mangler
// (fx staff ansat før A4) → afledes on-the-fly (self-heal, deterministisk).
export async function getStaffProfileHandler({ teamId, staffId }, supabaseClient, { flags = DEFAULT_FLAGS } = {}) {
  if (!flags.facilitiesEnabled) return { status: 403, body: { error: "facilities_disabled" } };

  const { data: staff, error: staffError } = await supabaseClient
    .from("team_staff")
    .select("id, team_id, role, tier, salary, name")
    .eq("id", staffId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (staffError) throw new Error(`facilityRoutes: could not load staff ${staffId}: ${staffError.message}`);
  if (!staff) return { status: 404, body: { error: "staff_not_found" } };

  const { data: abilityRow, error: abilityError } = await supabaseClient
    .from("staff_derived_abilities")
    .select("overall, dimensions, levels, role_skills")
    .eq("staff_id", staffId)
    .maybeSingle();
  if (abilityError) throw new Error(`facilityRoutes: could not load abilities for ${staffId}: ${abilityError.message}`);

  const abilities = abilityRow
    ? {
        overall: abilityRow.overall,
        dimensions: abilityRow.dimensions ?? {},
        levels: abilityRow.levels ?? {},
        roleSkills: abilityRow.role_skills ?? {},
      }
    : (() => {
        const p = deriveStaffAbilities({ role: staff.role, tier: staff.tier, name: staff.name });
        return { overall: p.overall, dimensions: p.dimensions, levels: p.levels, roleSkills: p.roleSkills };
      })();

  return {
    status: 200,
    body: { role: staff.role, tier: staff.tier, salary: staff.salary, name: staff.name, abilities },
  };
}
