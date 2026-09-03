// #4148: styrer om updateRiderValues (economyEngine.js) skriver
// prize_earnings_bonus via ÉT bulk-RPC-kald (bulk_update_rider_prize_earnings_bonus)
// i stedet for ét PATCH pr. rytter. Bor i app_config (samme mønster som
// autoPrizeFlag.js/raceEngineFlag.js) → flippes runtime uden re-deploy.
//
// Fail-safe: fejl/fravær → false (uændret per-rytter-adfærd, ingen utilsigtet
// omlægning af skrivestien). Default OFF ved merge — orkestratoren tænder den
// eksplicit efter at have set kald-tallet falde i loggen (⏱ rider-values-linjen).
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RIDER_VALUES_BULK_WRITE_FLAG_KEY = "rider_values_bulk_write_enabled";

export async function isRiderValuesBulkWriteEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RIDER_VALUES_BULK_WRITE_FLAG_KEY), opts);
}
