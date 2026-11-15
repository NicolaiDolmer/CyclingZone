// #6490 trin b1, b2 og c: kontakten for den nye læsevej for træningshistorikken.
//
// Tændt: træningssiden, GET /training og peak-signalet får rytterne fra kvitteringerne
// (training_rider_ticks) via database/2026-11-15-6490-training-history-runs.sql i stedet for
// kopien i training_day_runs.report.riders. Indholdet er det samme; kopien skrives stadig.
//
// Virker KUN når app_config-rækken har værdien "on". Alt andet (rækken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket, og så læses kopien præcis som før.
// Kontakten vælger kilden til motorens input (peak-signalet), så der findes ingen beta-tilstand.

import { readFlagStage } from "./featureStage.js";

export const TRAINING_HISTORY_FROM_TICKS_6490_FLAG_KEY = "training_history_from_ticks_6490";

/** Træningssiden og GET /training: ét hold, fra en dato. */
export const TRAINING_HISTORY_RUNS_RPC = "training_history_runs";
/** Peak-signalet: flere hold, et datointerval, kun rider_id/status/focus. Kun service_role. */
export const TRAINING_RUNS_FROM_TICKS_RPC = "training_runs_from_ticks_6490";

/** Kun den eksakte streng "on" tænder. */
export function evaluateTrainingHistoryFromTicksFlag(value) {
  return value === "on";
}

/**
 * Fejl i opslaget = slukket (readFlagStage giver null ved fejl).
 * `fresh: true` springer cachen over (motorens input læses aldrig fra en gammel værdi).
 */
export async function isTrainingHistoryFromTicksEnabled(supabase, { fresh = false } = {}) {
  return evaluateTrainingHistoryFromTicksFlag(
    await readFlagStage(supabase, TRAINING_HISTORY_FROM_TICKS_6490_FLAG_KEY, { fresh }),
  );
}
