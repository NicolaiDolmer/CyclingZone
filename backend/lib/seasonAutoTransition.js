/**
 * Slice 09 — Auto-transition cron
 * =========================================
 * Fyrer transitionToNextSeason automatisk, når den manuelle skifte-gate ville
 * lade admin skifte: kildesæsonen er afsluttet (season-end kørt) og
 * assessTransitionReadiness er grøn.
 *
 * #6784 — cron'en læser IKKE transfer_windows. Markedet er altid åbent
 * (docs/TRANSFER_MARKET_RULES.md, "Transfervinduet er afskaffet"), og ingen
 * kode skriver vinduets final-whistle- og squad-enforcement-markører længere,
 * så den gamle "fuldt-wrapped vindue"-trigger kunne aldrig fyre. Kontrakten er
 * nu den samme som POST /api/admin/season-transition:
 *   1. Kildesæson = resolveTransitionSourceSeason (nyeste 'active', ellers
 *      nyeste 'completed').
 *   2. Kildesæsonen skal have status='completed'. Cron'en kører aldrig
 *      season-end selv og skifter aldrig en aktiv sæson — heller ikke sæson 0,
 *      der ikke har et season-end-skridt (det skifte er manuelt).
 *   3. assessTransitionReadiness skal være grøn (alle kritiske checks).
 *   4. Min-interval-guard mod transition-loop (admin_log).
 *
 * Idempotens: efter et skifte findes en ny 'active' sæson, så resolveren
 * vælger den, og trin 2 stopper (season_status_active). transitionToNextSeason
 * er selv idempotent per fase og validerer at næste sæson findes.
 *
 * NB: denne cron kører kun når SEASON_AUTO_TRANSITION_ENABLED=true i
 * economyConstants.js — pt. false (#1155, ejer-beslutning 2026-06-08):
 * sæson-skift er en bevidst manuel admin-handling. #6784 tænder den ikke.
 */

import { resolveTransitionSourceSeason, transitionToNextSeason } from "./seasonTransition.js";
import { assessTransitionReadiness } from "./seasonTransitionReadiness.js";
import { ADMIN_ACTION_TYPE } from "./economyConstants.js";

// #WS1 Task 2.2: hård prævention mod transition-loop. Auto-cron'en må maks fyre
// én transition per dette antal timer, læst fra admin_log (samme kilde som
// dailySeasonCountCheck-loop-guarden, men FORHINDRER frem for kun at alerte).
export const MIN_TRANSITION_INTERVAL_HOURS = 12;

export async function processSeasonAutoTransitionCron({
  supabase,
  now = new Date(),
  transitionFn = transitionToNextSeason,
  assessReadiness = assessTransitionReadiness,
  resolveSourceSeason = resolveTransitionSourceSeason,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const season = await resolveSourceSeason({ supabase });
  if (!season) return { transitioned: false, reason: "no_source_season" };

  // Kun en afsluttet sæson (season-end kørt af admin) må skiftes automatisk.
  if (season.status !== "completed") {
    return { transitioned: false, reason: `season_status_${season.status}` };
  }

  // #WS1 Task 2.1: samme readiness-gate som det manuelle endpoint.
  // assessTransitionReadiness returnerer { ready, checks, failed_critical } — afled
  // en reason fra det første fejlede kritiske check så afbruddet er sporbart.
  const readiness = await assessReadiness({ supabase, fromSeasonId: season.id });
  if (!readiness.ready) {
    const cause = readiness.failed_critical?.[0] ?? "unknown";
    return { transitioned: false, reason: `not_ready_${cause}` };
  }

  // #WS1 Task 2.2: min-interval-guard. Hvis en SEASON_TRANSITION allerede er logget
  // i admin_log inden for de seneste MIN_TRANSITION_INTERVAL_HOURS, afbryd — dette
  // forhindrer 0→1→2→3→4-loopet (2026-05-21) strukturelt, ikke kun via alert.
  const guardSince = new Date(
    now.getTime() - MIN_TRANSITION_INTERVAL_HOURS * 3600 * 1000
  ).toISOString();
  const { count: recent, error: guardError } = await supabase
    .from("admin_log")
    .select("id", { count: "exact", head: true })
    .eq("action_type", ADMIN_ACTION_TYPE.SEASON_TRANSITION)
    .gte("created_at", guardSince);
  if (guardError) throw new Error(`admin_log guard: ${guardError.message}`);
  if ((recent ?? 0) > 0) {
    return { transitioned: false, reason: "recent_transition_guard" };
  }

  const result = await transitionFn({
    supabase,
    fromSeasonId: season.id,
    transitionAt: now,
    adminUserId: null,
  });

  return {
    transitioned: true,
    fromSeason: season.number,
    toSeason: season.number + 1,
    log: result.log ?? null,
  };
}
