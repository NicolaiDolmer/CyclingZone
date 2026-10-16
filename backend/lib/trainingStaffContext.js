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
//   • BEST-EFFORT ved VEDVARENDE fejl (fx skema-drift): en sådan fejl må ikke
//     blokere alle holds træning → fang + Sentry + neutral kontekst.
//   • #6596: en FORBIGÅENDE fejl (Supabase 502/503/504, Cloudflare-fejlside,
//     netværk, statement-timeout) giver ALDRIG neutral kontekst. Holdet ville ellers
//     afregnes uden den betalte facilitets-/trænerbonus, og dagen kan ikke køres om.
//     I stedet kastes TrainingStaffContextRetryError: dailyTrainingEngine sletter
//     reservationen i sin phase-1-catch, og næste sweep tager holdet igen (samme vej
//     som `plans load`-fejl; idempotent via run-rækkens unikke nøgle).
//   • Self-heal (samme mønster som getStaffProfileHandler): mangler ability-rækken
//     (staff ansat før A4-migrationen) afledes profilen deterministisk on-the-fly.
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";
import { normalizeLevelBands } from "./staffAbilityConstants.js";
import { captureException } from "./sentry.js";
import { isTransientSupabaseError, normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

const NEUTRAL = Object.freeze({ facilityTier: 0, staff: null });

// HTTP-status fra postgrest-svaret der betyder "gateway/netværk, prøv igen".
// 0 = fetch fejlede helt (postgrest-js' netværks-fallback). Supplerer
// isTransientSupabaseError, som kun ser på beskeden/koden.
const TRANSIENT_HTTP_STATUS = new Set([0, 502, 503, 504, 520, 521, 522, 523, 524]);

// Kastes ved forbigående load-fejl. Beskeden er kort (HTML-fejlsider er kogt ned
// via normalizeSupabaseErrorMessage) og ASCII, så sweep-loggen forbliver én linje.
export class TrainingStaffContextRetryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TrainingStaffContextRetryError";
    this.retryable = true;
  }
}

function shortMessage(error) {
  const raw = typeof error === "string" ? error : (error?.message ?? "");
  return normalizeSupabaseErrorMessage(String(raw)) || "unknown error";
}

// Bygger load-fejlen for ét postgrest-svar og markerer om den er forbigående.
function loadError(label, res) {
  const err = new Error(`${label}: ${shortMessage(res.error)}`);
  err.transient = isTransientSupabaseError(res.error) || TRANSIENT_HTTP_STATUS.has(res.status);
  return err;
}

/**
 * Load trænings-facilitets-kontekst for ét hold.
 * @param {object} supabase — service-role client
 * @param {string} teamId
 * @returns {Promise<{ facilityTier: number, staff: object|null }>}
 * @throws {TrainingStaffContextRetryError} ved forbigående DB-/gateway-fejl (#6596).
 */
export async function loadTrainingStaffContext(supabase, teamId) {
  try {
    const [facRes, staffRes] = await Promise.all([
      supabase.from("team_facilities").select("track, tier").eq("team_id", teamId).eq("track", "training"),
      supabase.from("team_staff").select("id, name, role, tier, status").eq("team_id", teamId).eq("role", "training").eq("status", "active"),
    ]);
    if (facRes.error) throw loadError("team_facilities load", facRes);
    if (staffRes.error) throw loadError("team_staff load", staffRes);

    const facilityTier = facRes.data?.[0]?.tier ?? 0;
    // #3489: op til MAX_STAFF_SLOTS_PER_ROLE (2) aktive trænings-staff nu (fx en
    // U23- + en senior-træner). Motorens dagsbonus er stadig ÉN team-bred
    // multiplikator (spec §2.2) — den bruger den STÆRKESTE (højeste overall) af
    // dem, samme "bedste-af-flere"-valg som scoutAssignmentService.loadScout.
    // ÆGTE per-rytter-routing (U23-ryttere trænes af U23-træneren, senior-
    // ryttere af senior-træneren) er bevidst UDENFOR denne slice — se
    // opfølgnings-punkt i PR-beskrivelsen for #3489.
    const staffRows = staffRes.data ?? [];
    if (facilityTier <= 0 && staffRows.length === 0) return NEUTRAL;

    let staff = null;
    if (staffRows.length > 0) {
      const abilityRes = await supabase
        .from("staff_derived_abilities")
        .select("staff_id, overall, dimensions, levels")
        .in("staff_id", staffRows.map((r) => r.id));
      if (abilityRes.error) throw loadError("staff_derived_abilities load", abilityRes);
      const abilityByStaffId = new Map((abilityRes.data ?? []).map((a) => [a.staff_id, a]));
      const profiles = staffRows.map((staffRow) =>
        abilityByStaffId.get(staffRow.id)
          ?? deriveStaffAbilities({ role: staffRow.role, tier: staffRow.tier, name: staffRow.name })
      );
      const ab = profiles.reduce((best, p) => ((p.overall ?? 0) > (best.overall ?? 0) ? p : best));
      staff = {
        overall: ab.overall,
        dimensions: ab.dimensions ?? {},
        // #2529: graceful læsning — DB-rækker fra FØR u23-migrationen kan stadig
        // have youth/junior-nøgler i vinduet mellem merge og ejer-apply.
        levels: normalizeLevelBands(ab.levels ?? {}),
      };
    }
    return { facilityTier, staff };
  } catch (err) {
    const message = shortMessage(err);
    // #6596: egne load-fejl bærer klassifikationen; uventede kast (fx en afvist
    // fetch) klassificeres ud fra beskeden.
    const transient = typeof err?.transient === "boolean" ? err.transient : isTransientSupabaseError(err);
    if (transient) {
      // Ingen neutral kontekst: kast, så holdet tages igen ved næste sweep.
      // Sweepen logger selv "team retained for retry" med denne korte besked.
      console.warn(`  ⚠️ trainingStaffContext load failed for team ${teamId} (transient, retry on next sweep): ${message}`);
      throw new TrainingStaffContextRetryError(
        `trainingStaffContext load (team ${teamId}): ${message} - refusing to tick without facility/staff bonus, retry on next sweep`,
        { cause: err },
      );
    }
    // Vedvarende fejl: best-effort adfærd (neutral kontekst, ingen crash) MEN ikke
    // tavs: en persistent fejl her deaktiverer den betalte facilitets-/staff-bonus
    // for ALLE hold usynligt (#2395). Capture så det opdages; NEUTRAL bevarer
    // træningsdagen.
    console.error(`  ⚠️ trainingStaffContext load failed for team ${teamId} (continuing without bonus): ${message}`);
    captureException(err, { tags: { lib: "trainingStaffContext" }, extra: { teamId } });
    return NEUTRAL;
  }
}
