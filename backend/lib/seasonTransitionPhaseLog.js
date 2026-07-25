// #2921 · Maskinelt spor af en sæson-transition, også når den fejler halvvejs.
// ============================================================================
// FØR: admin_log fik først en `season_transition`-række NÅR transitionen var
// færdig. Fejlede den halvvejs (eller døde processen), fandtes der intet
// maskinelt spor af at den overhovedet var startet — operatøren kunne kun gætte
// ud fra DB-tilstanden hvor langt den nåede. Railways proxy lukker desuden
// forbindelsen efter 5 minutter uden datatransfer, så et "fejl"-svar i browseren
// kan dække over en server der arbejder videre.
//
// EFTER: tre ankre skrives til admin_log omkring transitionen:
//   · started   — FØR første write. Beviser at kørslen begyndte.
//   · completed — efter sidste fase, med hele fase-listen.
//   · failed    — hvis en fase kaster, med fase-listen indtil da + fejlen.
// Sammen giver de: fase-navn, start, slut og fejl.
//
// ── Hvorfor action_type = manual_override og ikke en ny type ─────────────────
// `admin_log.action_type` har en CHECK-whitelist i databasen; en ny værdi
// (fx 'season_transition_started') ville kræve en migration, og en ikke-
// applyet migration ville få ALLE fase-INSERTs til at fejle netop når sporet
// skal bruges. Samtidig må rækkerne IKKE bruge 'season_transition':
// dailySeasonCountCheck tæller præcis den type som sit cron-loop-værn
// (incidenten 2026-05-21), og drejebogens verifikation forventer PRÆCIS ÉN ny
// season_transition-række pr. skifte. Vi genbruger derfor MANUAL_OVERRIDE med
// en `meta.source`-diskriminator — nøjagtig samme mønster som #1346's
// force-override-log i routes/api.js.
//
// ── Fail-safe ───────────────────────────────────────────────────────────────
// Logning er observability, ikke forretningslogik: logTransitionPhaseSafe
// kaster ALDRIG. En fejlende log-skrivning må under ingen omstændigheder vælte
// selve transitionen.

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";

export const TRANSITION_PHASE_LOG_SOURCE = "season_transition_phase";

export const TRANSITION_PHASE_STATUS = Object.freeze({
  STARTED: "started",
  COMPLETED: "completed",
  FAILED: "failed",
});

// Loft over hvor mange fase-entries vi lægger i meta. Transitionen har ~20
// faser; loftet er en ren sikkerhedsventil mod en uventet lang liste.
const MAX_PHASES_IN_META = 100;

function summarizePhases(log) {
  if (!Array.isArray(log)) return [];
  return log.slice(0, MAX_PHASES_IN_META).map((entry) => {
    const summary = { phase: entry?.phase ?? "unknown" };
    // De additive faser fanger selv deres fejl og lægger { error } i loggen —
    // dem vil vi eksplicit kunne se i admin_log uden at grave i server-loggen.
    if (entry?.error) summary.error = String(entry.error).slice(0, 500);
    return summary;
  });
}

function buildDescription({ status, fromNumber, toNumber, error, log }) {
  const route = `${fromNumber ?? "?"} → ${toNumber ?? "?"}`;
  if (status === TRANSITION_PHASE_STATUS.STARTED) {
    return `Sæson-transition STARTET: ${route}`;
  }
  if (status === TRANSITION_PHASE_STATUS.COMPLETED) {
    return `Sæson-transition FÆRDIG: ${route} (${summarizePhases(log).length} faser)`;
  }
  const lastPhase = Array.isArray(log) && log.length ? log[log.length - 1]?.phase : null;
  const detail = String(error || "unknown failure").slice(0, 300);
  const where = lastPhase ? ` (sidste fase: ${lastPhase})` : "";
  return `Sæson-transition FEJLEDE: ${route}${where}: ${detail}`;
}

/**
 * Skriv ét transition-anker til admin_log. Kaster ALDRIG.
 *
 * @returns {Promise<{ logged: boolean, id?: string, reason?: string }>}
 */
export async function logTransitionPhaseSafe({
  supabase,
  status,
  fromSeasonId = null,
  toSeasonId = null,
  fromNumber = null,
  toNumber = null,
  adminUserId = null,
  transitionAtIso = null,
  log = [],
  error = null,
} = {}) {
  try {
    const { data, error: insertError } = await supabase
      .from("admin_log")
      .insert({
        action_type: ADMIN_ACTION_TYPE.MANUAL_OVERRIDE,
        admin_user_id: adminUserId,
        description: buildDescription({ status, fromNumber, toNumber, error, log }),
        target_team_id: null,
        meta: {
          source: TRANSITION_PHASE_LOG_SOURCE,
          status,
          from_season_id: fromSeasonId,
          from_season_number: fromNumber,
          to_season_id: toSeasonId,
          to_season_number: toNumber,
          transition_at: transitionAtIso,
          logged_at: new Date().toISOString(),
          phases: summarizePhases(log),
          ...(error ? { error: String(error).slice(0, 1000) } : {}),
        },
      })
      .select("id")
      .single();
    if (insertError) {
      // best-effort: se modul-headeren — observability må aldrig vælte transitionen.
      console.error(`⚠️  admin_log fase-log (${status}) fejlede: ${insertError.message}`);
      return { logged: false, reason: insertError.message };
    }
    return { logged: true, id: data?.id };
  } catch (err) {
    // best-effort: samme disciplin — vi sluger bevidst, men aldrig tavst.
    console.error(`⚠️  admin_log fase-log (${status}) kastede: ${err?.message || err}`);
    return { logged: false, reason: err?.message || String(err) };
  }
}
