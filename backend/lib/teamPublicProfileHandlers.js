// #2601 — offentlig, saniteret holdside-visning af ET ANDET holds staff + faciliteter
// (konkurrence-transparens). Samme princip som staffOverviewHandlers.js (#2450):
// team_staff/team_facilities RLS begrænser authenticated SELECT til egne rækker
// (database/2026-07-05-facilities-staff-foundation.sql), så tværs-af-hold-visning
// kræver en service-role-route. Denne fil er BEVIDST strammere end den øvrige
// staff-oversigt: INGEN løn, INGEN kontrakt-felter, INGEN opgraderings-økonomi —
// kun navn/rolle/tier for staff og track/tier for faciliteter (arkitekt-beslutning
// på #2601, se PR-beskrivelsen). Sammenlign med getStaffDirectoryHandler, som
// eksponerer salary — den kontrakt er UÆNDRET; DENNE route er en strammere,
// dedikeret sanitering til holdsiden.
import { FACILITIES_ENABLED, FACILITY_TRACKS, EFFECT_LIVE_BY_TRACK } from "./facilityConstants.js";
import { effectiveBonus } from "./facilityEngine.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

const DEFAULT_FLAGS = Object.freeze({ facilitiesEnabled: FACILITIES_ENABLED });

// GET /api/teams/:id/public-profile — saniteret staff + faciliteter for VILKÅRLIGT
// hold (ejer- eller andres). Ingen løn/kontrakt/opgraderings-økonomi i responsen.
export async function getTeamPublicProfileHandler(
  { teamId },
  supabaseClient,
  { flags = DEFAULT_FLAGS } = {}
) {
  if (!flags.facilitiesEnabled) return { status: 403, body: { error: "facilities_disabled" } };
  if (!teamId) return { status: 404, body: { error: "team_not_found" } };

  const { data: teamRow, error: teamError } = await supabaseClient
    .from("teams")
    .select("id")
    .eq("id", teamId)
    .maybeSingle();
  if (teamError) throw new Error(`teamPublicProfile: could not load team ${teamId}: ${teamError.message}`);
  if (!teamRow) return { status: 404, body: { error: "team_not_found" } };

  const { data: staffRows, error: staffError } = await supabaseClient
    .from("team_staff")
    .select("id, role, tier, name")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (staffError) throw new Error(`teamPublicProfile: could not load staff for ${teamId}: ${staffError.message}`);

  const { data: facilityRows, error: facilityError } = await supabaseClient
    .from("team_facilities")
    .select("track, tier")
    .eq("team_id", teamId);
  if (facilityError) throw new Error(`teamPublicProfile: could not load facilities for ${teamId}: ${facilityError.message}`);

  const staffByRole = new Map((staffRows ?? []).map((s) => [s.role, s]));
  const tierByTrack = new Map((facilityRows ?? []).map((r) => [r.track, r.tier]));

  const staff = (staffRows ?? []).map((s) => ({ id: s.id, name: s.name, role: s.role, tier: s.tier }));

  const facilities = FACILITY_TRACKS.map((track) => {
    const tier = tierByTrack.get(track) ?? 0;
    const staffRow = staffByRole.get(track) ?? null;
    // overall bruges KUN internt til at beregne effectiveBonus (spejler
    // facilityRoutesHandlers.getClubFacilitiesHandler) — eksponeres aldrig i responsen.
    const internalStaffOut = staffRow
      ? { overall: deriveStaffAbilities({ role: staffRow.role, tier: staffRow.tier, name: staffRow.name }).overall }
      : null;
    return {
      track,
      tier,
      staff: staffRow ? { id: staffRow.id, name: staffRow.name, tier: staffRow.tier } : null,
      effectiveBonus: effectiveBonus(track, tier, internalStaffOut),
      effectLive: EFFECT_LIVE_BY_TRACK[track] ?? false,
    };
  });

  return { status: 200, body: { staff, facilities } };
}
