// Personale-oversigt på tværs af hold (#2450). Ejer-ønske + 2 spillere: staff skal
// være en synlig del af verdenen (hvem er ansat hvor, profil, stats), ikke kun en
// dropdown i klub-faciliteterne. #2398 dækker "stats FØR ansættelse" (kandidater,
// uændret) + sign-on/release-gebyr — DENNE fil dækker kun oversigten + profil-
// visningen af allerede ansat staff, på tværs af holdene.
//
// Synligheds-kontrakt (koordineret med #2398 + eksisterende /api/club/staff/:id):
//   - EGET staff: fuld evne-matrix (dimensions/levels/roleSkills) — UÆNDRET kontrakt,
//     leveres fortsat KUN af getStaffProfileHandler (facilityRoutesHandlers.js:167-202).
//   - ANDRES staff: candidate-niveau (overall/topSpecialization/tier/salary), SAMME
//     niveau som getStaffCandidatesHandler allerede eksponerer før ansættelse (§2398-
//     præcedens) — ALDRIG dimensions/levels/roleSkills for ikke-ejet staff.
//
// team_staff/staff_derived_abilities RLS begrænser authenticated SELECT til egne
// rækker (database/2026-07-05-facilities-staff-foundation.sql +
// 2026-07-05-staff-abilities.sql) — en tværs-af-hold-oversigt er derfor kun mulig
// via denne service-role-route (samme princip som getClubFacilitiesHandler, blot
// udvidet fra ét hold til alle). overall/topSpecialization afledes on-the-fly fra
// (role,tier,name) — deterministisk (samme mønster som facilityRoutesHandlers.js:76),
// så vi undgår et join til staff_derived_abilities for oversigten.
import { FACILITIES_ENABLED } from "./facilityConstants.js";
import { deriveStaffAbilities, topSpecialization } from "./staffAbilityDerivation.js";

const DEFAULT_FLAGS = Object.freeze({ facilitiesEnabled: FACILITIES_ENABLED });

// Population-filter (samme diskriminator som economy-overview/board/academy/
// retentionScorecard — "rigtige hold" = ikke-bank/test/frosne). is_ai er en separat
// opt-in-toggle (includeAi), samme mønster som RiderFilters.showAiToggle — AI-hold
// er en del af det synlige spil-univers (deres staff kan ses), men skjult by default
// så oversigten ikke drukner i AI-noise.
function isVisibleTeam(team, includeAi) {
  if (!team) return false;
  if (team.is_bank || team.is_frozen || team.is_test_account) return false;
  if (team.is_ai && !includeAi) return false;
  return true;
}

function toDirectoryRow(row) {
  const profile = deriveStaffAbilities({ role: row.role, tier: row.tier, name: row.name });
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    tier: row.tier,
    salary: row.salary,
    overall: profile.overall,
    topSpecialization: topSpecialization(profile),
    teamId: row.team_id,
    teamName: row.teams?.name ?? null,
    division: row.teams?.division ?? null,
    isAiTeam: !!row.teams?.is_ai,
  };
}

// GET /api/staff/directory?includeAi=1 — alt AKTIVT personale på tværs af hold.
export async function getStaffDirectoryHandler(
  { includeAi = false } = {},
  supabaseClient,
  { flags = DEFAULT_FLAGS } = {}
) {
  if (!flags.facilitiesEnabled) return { status: 403, body: { error: "facilities_disabled" } };

  const { data, error } = await supabaseClient
    .from("team_staff")
    .select("id, team_id, role, tier, salary, name, teams:team_id(id, name, division, is_ai, is_bank, is_frozen, is_test_account)")
    .eq("status", "active");
  if (error) throw new Error(`staffOverview: could not load staff directory: ${error.message}`);

  const staff = (data ?? [])
    .filter((row) => isVisibleTeam(row.teams, includeAi))
    .map(toDirectoryRow);

  return { status: 200, body: { staff } };
}

// GET /api/staff/:id/public — candidate-niveau profil for VILKÅRLIG aktiv staff
// (bruges når oversigten linker til en staff, man ikke selv ejer). Ejet staff bør
// i stedet bruge /api/club/staff/:id for den fulde evne-matrix — denne route
// afslører ALDRIG dimensions/levels/roleSkills, uanset hvem der spørger.
export async function getStaffPublicProfileHandler(
  { staffId },
  supabaseClient,
  { flags = DEFAULT_FLAGS } = {}
) {
  if (!flags.facilitiesEnabled) return { status: 403, body: { error: "facilities_disabled" } };

  const { data: staff, error } = await supabaseClient
    .from("team_staff")
    .select("id, team_id, role, tier, salary, name, status, teams:team_id(id, name, division)")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw new Error(`staffOverview: could not load staff ${staffId}: ${error.message}`);
  if (!staff || staff.status !== "active") return { status: 404, body: { error: "staff_not_found" } };

  const profile = deriveStaffAbilities({ role: staff.role, tier: staff.tier, name: staff.name });
  return {
    status: 200,
    body: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      tier: staff.tier,
      salary: staff.salary,
      overall: profile.overall,
      topSpecialization: topSpecialization(profile),
      teamId: staff.team_id,
      teamName: staff.teams?.name ?? null,
      division: staff.teams?.division ?? null,
    },
  };
}
