// Auto-kalender-flag (#1704 wiring). Bor i app_config (key/value) → flippes runtime
// UDEN re-deploy. Fail-safe: fejl/fravær → false, så seasonTransition.transitionToNextSeason
// IKKE auto-genererer en sæson-kalender før en buggy run kan verificeres (2026-05-21-
// incident-disciplin: forever-loops gates altid OFF som default).
//
// Gælder KUN forever-transitionerne. Den eksplicitte launch-relaunch
// (relaunchOrchestrator) materialiserer kalenderen direkte uden dette flag.
//
// Spejler autoPrizeFlag.js præcist: ét DB-opslag pr. kald (sæson-transition er en
// sjælden handling), returnerer ALTID boolean via evaluateFlagStage (off/beta/on
// tre-tilstand, bagudkompatibel med boolean).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const AUTO_CALENDAR_FLAG_KEY = "auto_calendar_enabled";

export async function isAutoCalendarEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, AUTO_CALENDAR_FLAG_KEY), opts);
}
