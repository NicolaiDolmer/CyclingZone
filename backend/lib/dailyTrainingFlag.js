// Flag for dagligt trænings-tick (#1305). Mønster kopieret fra raceEngineFlag.js.
// OFF = ingen ticks/sweeps; programmer kan stadig sættes (intent-capture før relaunch).
//
// daily_training_enabled bor i app_config (key/value-tabellen), så den kan flippes
// runtime UDEN re-deploy — fail-safe: fejl/fravær → false (ingen utilsigtet aktivering).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const DAILY_TRAINING_FLAG_KEY = "daily_training_enabled";

export async function isDailyTrainingEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, DAILY_TRAINING_FLAG_KEY), opts);
}
