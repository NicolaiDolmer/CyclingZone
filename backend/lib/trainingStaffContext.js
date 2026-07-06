// Plan B (#1441 pre-flip engine-slice) — loader for holdets trænings-facilitets-kontekst.
//
// Henter det ENE datasæt trænings-motoren (dailyTrainingEngine) skal bruge for at
// anvende facilitets-magnitude + staff-specialisering pr. tick:
//   { facilityTier, staff } hvor staff = { overall, dimensions, levels } | null.
//
// Design-valg (dokumenteret i PR):
//   • DATA-DREVET, ikke flag-gated: rækker i team_facilities/team_staff findes kun for
//     hold der har købt (kun muligt når facilities_enabled ELLER admin-testgaten, A4b).
//     Intet køb → { facilityTier: 0, staff: null } → multiplikator PRÆCIS 1.0.
//     Dermed kan ejeren teste effekten som admin på prod FØR flip.
//   • BEST-EFFORT: en fejl her må ALDRIG vælte en træningsdag (clubben er en
//     forstærkning, ikke en forudsætning) → fang + warn + neutral kontekst.
//   • Self-heal (samme mønster som getStaffProfileHandler): mangler ability-rækken
//     (staff ansat før A4-migrationen) afledes profilen deterministisk on-the-fly.
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

const NEUTRAL = Object.freeze({ facilityTier: 0, staff: null });

/**
 * Load trænings-facilitets-kontekst for ét hold.
 * @param {object} supabase — service-role client
 * @param {string} teamId
 * @returns {Promise<{ facilityTier: number, staff: object|null }>}
 */
export async function loadTrainingStaffContext(supabase, teamId) {
  try {
    const [facRes, staffRes] = await Promise.all([
      supabase.from("team_facilities").select("track, tier").eq("team_id", teamId).eq("track", "training"),
      supabase.from("team_staff").select("id, name, role, tier, status").eq("team_id", teamId).eq("role", "training").eq("status", "active"),
    ]);
    if (facRes.error) throw new Error(`team_facilities load: ${facRes.error.message}`);
    if (staffRes.error) throw new Error(`team_staff load: ${staffRes.error.message}`);

    const facilityTier = facRes.data?.[0]?.tier ?? 0;
    const staffRow = staffRes.data?.[0] ?? null;
    if (facilityTier <= 0 && !staffRow) return NEUTRAL;

    let staff = null;
    if (staffRow) {
      const { data: abilityRows, error: abilityError } = await supabase
        .from("staff_derived_abilities")
        .select("staff_id, overall, dimensions, levels")
        .eq("staff_id", staffRow.id);
      if (abilityError) throw new Error(`staff_derived_abilities load: ${abilityError.message}`);
      const ab = abilityRows?.[0]
        ?? deriveStaffAbilities({ role: staffRow.role, tier: staffRow.tier, name: staffRow.name });
      staff = {
        overall: ab.overall,
        dimensions: ab.dimensions ?? {},
        levels: ab.levels ?? {},
      };
    }
    return { facilityTier, staff };
  } catch (err) {
    console.error(`  ⚠️ trainingStaffContext load failed for team ${teamId} (continuing without bonus):`, err.message);
    return NEUTRAL;
  }
}
