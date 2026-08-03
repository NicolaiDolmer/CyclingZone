// Alunta subscription-reconcile cron-flag (#2736). Bor i app_config (key/value)
// -> flippes runtime UDEN re-deploy. Fail-safe: fejl/fravær -> false (ingen
// utilsigtet automatisk skrivning til den betalende kundes subscription-række
// før ejeren har set en manuel dry-run mod den ægte Alunta-kontrakt).
//
// Spejler autoPrizeFlag.js/raceEngineFlag.js præcist: ét DB-opslag pr. kald
// (reconcilen er en daglig cron-handling, så det er gratis).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ALUNTA_RECONCILE_FLAG_KEY = "alunta_reconcile_enabled";

export async function isAluntaReconcileEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, ALUNTA_RECONCILE_FLAG_KEY), opts);
}
