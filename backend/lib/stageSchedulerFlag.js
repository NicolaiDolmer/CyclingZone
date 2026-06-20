// Stage-scheduler cron-flag (WS1 Fase 3). Bor i app_config (key/value) → flippes
// runtime UDEN re-deploy. Fail-safe: fejl/fravær → false (ingen utilsigtet automatisk
// etape-afvikling).
//
// Spejler autoPrizeFlag.js / raceEngineFlag.js præcist: ét DB-opslag pr. kald
// (stage-scheduler-sweep er en cron-handling), returnerer ALTID boolean via
// evaluateFlagStage (off/beta/on tre-tilstand, bagudkompatibel med boolean).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const STAGE_SCHEDULER_FLAG_KEY = "stage_scheduler_enabled";

export async function isStageSchedulerEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, STAGE_SCHEDULER_FLAG_KEY), opts);
}
