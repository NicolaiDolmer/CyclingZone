// Auto-prize cron-flag (#WS1). Bor i app_config (key/value) → flippes runtime UDEN
// re-deploy. Fail-safe: fejl/fravær → false (ingen utilsigtet automatisk udbetaling).
//
// Spejler raceEngineFlag.js præcist: ét DB-opslag pr. kald (auto-prize-sweep er en
// sjælden cron-handling, så det er gratis), returnerer ALTID boolean via
// evaluateFlagStage (off/beta/on tre-tilstand, bagudkompatibel med boolean).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const AUTO_PRIZE_FLAG_KEY = "auto_prize_enabled";

export async function isAutoPrizeEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, AUTO_PRIZE_FLAG_KEY), opts);
}
