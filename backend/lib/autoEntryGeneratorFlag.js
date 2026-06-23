// Race Hub Fase 0b: proaktiv entry-generator-flag. Bor i app_config (key/value) →
// flippes runtime UDEN re-deploy. Fail-safe: fejl/fravær → false (ingen utilsigtet
// auto-generering). Spejler autoCalendarFlag.js. Seedet "off" i
// database/2026-06-23-race-withdrawals.sql.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const AUTO_ENTRY_GENERATOR_FLAG_KEY = "auto_entry_generator_enabled";

export async function isAutoEntryGeneratorEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, AUTO_ENTRY_GENERATOR_FLAG_KEY), opts);
}
