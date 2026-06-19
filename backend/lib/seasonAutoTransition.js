/**
 * Slice 09 — Auto-transition cron
 * =========================================
 * Fyrer transitionToNextSeason automatisk når et sæson-vindue er
 * fuldt-wrapped: status=closed, final_whistle_sent_at sat, squad enforcement done.
 *
 * Cron-rytmen er bevidst 5-min interval — samme tempo som final whistle + squad
 * enforcement crons. Sponsor lander derfor på alle managers' konti ~5-15 min
 * efter window-close.
 *
 * Idempotens: hvis season.status='completed' (allerede transitioneret),
 * returnerer cron uden at gøre noget. transitionToNextSeason er selv
 * idempotent per fase (insert-if-missing, update-if-changed).
 */

import { transitionToNextSeason } from "./seasonTransition.js";

export async function processSeasonAutoTransitionCron({
  supabase,
  now = new Date(),
  transitionFn = transitionToNextSeason,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // closed_at IS NOT NULL skelner racing-windows (oprettet via transitionToNextSeason
  // med status='closed' men closed_at=null) fra deadline-windows der faktisk er blevet
  // lukket via fireAutoCloseIfDue eller admin-action. Uden dette filter ville cron'en
  // matche det nyfødte racing-window og fyre en ekstra transition hver 5-10 min
  // (sæson-loop-bug rettet 2026-05-21 efter 0→1→2→3→4-incident).
  //
  // Dette filter er LAG 1 (kode-filter) i en 3-lags forsvar-i-dybden mod racing-windows:
  //   1. KODE-FILTER  — denne `.not("closed_at","is",null)` (+ samme i squadEnforcement.js).
  //   2. DB CHECK     — 2026-05-22-transfer-window-racing-guard.sql gør det strukturelt
  //                     umuligt at sætte final_whistle_sent_at / squad_enforcement_completed_at
  //                     uden closed_at.
  //   3. KILDE-GUARD  — admin-close-endpoint'et (#544) føder aldrig et racing-window:
  //                     det sætter altid closed_at sammen med status='closed'.
  const { data: window, error: windowError } = await supabase
    .from("transfer_windows")
    .select("id, season_id, status, closes_at, closed_at, final_whistle_sent_at, squad_enforcement_completed_at")
    .eq("status", "closed")
    .not("closed_at", "is", null)
    .not("final_whistle_sent_at", "is", null)
    .not("squad_enforcement_completed_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (windowError) throw windowError;
  if (!window) return { transitioned: false, reason: "no_wrapped_window" };
  if (!window.season_id) return { transitioned: false, reason: "no_season_id" };

  // Idempotens: tjek season.status — kun 'active' skal transitioneres.
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, status")
    .eq("id", window.season_id)
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season) return { transitioned: false, reason: "season_not_found" };
  if (season.status !== "active") {
    return { transitioned: false, reason: `season_status_${season.status}` };
  }

  const result = await transitionFn({
    supabase,
    fromSeasonId: window.season_id,
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
