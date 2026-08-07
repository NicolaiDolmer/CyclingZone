// Flag for løbsdags-motoren (#3459 fase 2a: D1 løbsdags-gate + D3 recalibrerede
// restitutions-konstanter + D4 AI kører samme motor). Mønster kopieret fra
// dailyTrainingFlag.js/raceEngineFlag.js.
//
// OFF (default) = BIT-FOR-BIT nuværende adfærd: dailyTrainingEngine.js kender ikke
// løbskalenderen, riderCondition.js's recovery-konstanter er uændrede (base 4/frac
// 0.13), og trainingSweep.js filtrerer stadig is_ai=false (aiRecoverySweep.js
// kører videre som i dag).
//
// race_day_engine_enabled bor i app_config (key/value-tabellen), så den kan flippes
// runtime UDEN re-deploy — fail-safe: fejl/fravær → false (ingen utilsigtet
// aktivering). Planlagt flip: ejer/orkestrator ved sæsonskiftet 23/8 (#3459).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_DAY_ENGINE_FLAG_KEY = "race_day_engine_enabled";

export async function isRaceDayEngineEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_DAY_ENGINE_FLAG_KEY), opts);
}
