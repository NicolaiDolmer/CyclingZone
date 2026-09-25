// #5741: kill-switch for AKADEMI-DRIFT specifikt ved S3→S4-skiftet 27/9
// (ejer-beslutning 25/9 kl. 13:30: ingen ungdomsdrift ved dette ene skifte).
// Bor i app_config (samme mønster som raceFinalizeResumableFlag.js) →
// flippes runtime uden re-deploy.
//
// Fail-safe: MODSAT de fleste stage-flag i denne mappe (som fail-safer til
// false/off). Her betyder true "drift opkræves som i dag" — det er den
// eksisterende, ikke-flag-gatede adfærd (se economyEngine.js trin 4, som
// ALTID opkrævede indtil #5741). En manglende nøgle eller en fejlet læsning
// må ALDRIG stille et hold gratis akademi-drift ved et uheld, så fail-safe
// er TRUE (drift opkræves), ikke false. Kun en eksplicit "off" (eller
// boolean false) i app_config slukker for opkrævningen.
//
// Denne nøgle er IKKE ACADEMY.FLAG_KEY (academyFlag.js, isAcademyEnabled) og
// påvirker intet andet i akademiet (intake, træning, m.m.) — kun
// sæsonskiftets akademi-drift-post.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ACADEMY_DRIFT_ENABLED_FLAG_KEY = "academy_drift_enabled";

export async function isAcademyDriftEnabled(supabase, opts = {}) {
  const raw = await readFlagStage(supabase, ACADEMY_DRIFT_ENABLED_FLAG_KEY);
  if (raw === null) return true; // fail-safe: nøgle mangler/læsning fejlede -> drift opkræves som i dag
  return evaluateFlagStage(raw, opts);
}
