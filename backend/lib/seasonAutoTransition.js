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

  const { data: window, error: windowError } = await supabase
    .from("transfer_windows")
    .select("id, season_id, status, closes_at, closed_at, final_whistle_sent_at, squad_enforcement_completed_at")
    .eq("status", "closed")
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
