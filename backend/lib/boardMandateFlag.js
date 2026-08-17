// #3514: kill-switch for mandat-modellen. Mønster kopieret fra
// raceDayEngineFlag.js / dailyTrainingFlag.js.
//
// OFF (default) = BIT-FOR-BIT nuværende adfærd: `board_profiles` og de 3
// satisfaction-tal er stadig sandheden; `board_relations`, `board_mandates` og
// `board_vision_milestones` læses ikke af nogen kodesti.
//
// Flaget bor i app_config, så det kan flippes runtime UDEN re-deploy, fail-safe:
// fejl/fravær → false (ingen utilsigtet aktivering). Kill-switchen er rollback,
// ikke beta-gate (ejer-politik, spec §"Fase 2"): flippet 23/8 gælder ALLE.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const BOARD_MANDATE_MODEL_FLAG_KEY = "board_mandate_model_enabled";

export async function isBoardMandateModelEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, BOARD_MANDATE_MODEL_FLAG_KEY), opts);
}
