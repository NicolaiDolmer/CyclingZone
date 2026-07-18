// #2627 — akademi-intake-udløb-flag. Bor i app_config (key/value) → flippes
// runtime UDEN re-deploy. Fail-safe: fejl/fravær → false (ingen utilsigtet
// udløb af åbne tilbud). Spejler autoEntryGeneratorFlag.js.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const INTAKE_OFFER_EXPIRY_FLAG_KEY = "intake_offer_expiry_enabled";

export async function isIntakeOfferExpiryEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, INTAKE_OFFER_EXPIRY_FLAG_KEY), opts);
}
